/*
 * Per-site data for the navigator (curated sites).
 *   node scripts/make_sites.js
 * For every curated site:
 *   - a fine horizon profile (0.25 deg bins) split into four distance bands, so the sky view can draw
 *     near and far terrain as separate ridgelines
 *   - a 24 km relief crop (Int16 heights) and, on a 250 m grid, the share of time the Sun and the Earth
 *     are above the local terrain horizon during 2027 (one full lunar year of seasons)
 * Output: data/sites/sites.json + data/sites/<id>.bin
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const R = 1737400, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const { Terrain } = require(path.join(ROOT, 'js/terrain.js'));
const Horizon = require(path.join(ROOT, 'nav/horizon.js'));

const SITES = [
  { id: 'shackleton-rim-b', name: 'Shackleton Rim B', ar: 'حافة شاكلتون B', lat: -89.5244, lon: 56.30993 },
  { id: 'de-gerlache-rim-1', name: 'de Gerlache Rim 1', ar: 'حافة دي جيرلاش 1', lat: -88.6834, lon: -67.9321 },
  { id: 'shoemaker-rim-a', name: 'Shoemaker Rim A', ar: 'حافة شوميكر A', lat: -88.0792, lon: 11.88866 },
  { id: 'haworth', name: 'Haworth', ar: 'هاوورث', lat: -86.7639, lon: -22.777 },
  { id: 'malapert-massif', name: 'Malapert Massif', ar: 'كتلة مالابيرت', lat: -85.9948, lon: -0.23578 },
  { id: 'leibnitz-beta', name: 'Leibnitz Beta Plateau', ar: 'هضبة لايبنتز بيتا', lat: -85.4266, lon: 31.74276 },
];
const BANDS = Horizon.BANDS, NB = Horizon.NB;
const CROP_HALF = 12000, RELIEF_RES = 80, GRID_RES = 250;
const RN = 2 * CROP_HALF / RELIEF_RES, GN = 2 * CROP_HALF / GRID_RES;

function loadTerrain() {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/terrain.json')));
  const bufs = meta.levels.map((L) => { const b = fs.readFileSync(path.join(ROOT, 'data/terrain', L.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); });
  return new Terrain(meta, bufs);
}
const bandedHorizon = (T, lat, lon, mast) => Horizon.banded(T, Terrain, lat, lon, mast);

function loadEphem(stepH, tA, tB) {
  const em = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/out/ephem.json')));
  const b = fs.readFileSync(path.join(ROOT, 'data/out/ephem.bin'));
  const d = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const t0 = Date.parse(em.start_utc), i0 = Math.round((tA - t0) / 3600e3), n = Math.floor((tB - tA) / 3600e3 / stepH);
  const sun = new Float64Array(n * 3), earth = new Float64Array(n * 3), sunR = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (i0 + k * stepH) * 7, sn = Math.hypot(d[a], d[a + 1], d[a + 2]);
    sun[3 * k] = d[a] / sn; sun[3 * k + 1] = d[a + 1] / sn; sun[3 * k + 2] = d[a + 2] / sn; sunR[k] = 0.2666 / d[a + 3];
    earth[3 * k] = d[a + 4]; earth[3 * k + 1] = d[a + 5]; earth[3 * k + 2] = d[a + 6];
  }
  return { n, sun, earth, sunR };
}
const disc = (x) => (x <= -1 ? 0 : x >= 1 ? 1 : (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI);

function gridRows(site, rows) {
  const T = loadTerrain(), E = loadEphem(4, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2028-01-01T00:00:00Z'));
  const [cx, cy] = Terrain.ll2xy(site.lat, site.lon), out = [];
  for (const r of rows) {
    const lit = new Uint8Array(GN), ear = new Uint8Array(GN);
    for (let c = 0; c < GN; c++) {
      const x = cx - CROP_HALF + (c + 0.5) * GRID_RES, y = cy + CROP_HALF - (r + 0.5) * GRID_RES;
      const [lat, lon] = Terrain.xy2ll(x, y), hz = T.horizon(lat, lon, { mast: 2, rays: 360 });
      if (!hz) { lit[c] = ear[c] = 255; continue; }
      const hf = Terrain.horizonFn(hz);
      const f = lat * D2R, l = lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
      const up = [cf * cl, cf * sl, sf], ea = [-sl, cl, 0], no = [-sf * cl, -sf * sl, cf];
      const rk = (R + hz.h0 + 2) / 1000, P = [up[0] * rk, up[1] * rk, up[2] * rk];
      let sl_ = 0, se = 0;
      for (let k = 0; k < E.n; k++) {
        const s0 = E.sun[3 * k], s1 = E.sun[3 * k + 1], s2 = E.sun[3 * k + 2];
        const alt = Math.asin(s0 * up[0] + s1 * up[1] + s2 * up[2]) * R2D;
        if (alt > -1.6) { let az = Math.atan2(s0 * ea[0] + s1 * ea[1], s0 * no[0] + s1 * no[1] + s2 * no[2]) * R2D; if (az < 0) az += 360; sl_ += disc((alt - hf(az)) / E.sunR[k]); }
        const e0 = E.earth[3 * k] - P[0], e1 = E.earth[3 * k + 1] - P[1], e2 = E.earth[3 * k + 2] - P[2], en = Math.hypot(e0, e1, e2);
        const ealt = Math.asin((e0 * up[0] + e1 * up[1] + e2 * up[2]) / en) * R2D;
        let eaz = Math.atan2(e0 * ea[0] + e1 * ea[1], e0 * no[0] + e1 * no[1] + e2 * no[2]) * R2D; if (eaz < 0) eaz += 360;
        if (ealt > hf(eaz)) se++;
      }
      lit[c] = Math.round(200 * sl_ / E.n); ear[c] = Math.round(200 * se / E.n);     // 0.5 % units
    }
    out.push({ r, lit, ear });
  }
  return out;
}

if (!isMainThread) { parentPort.postMessage(gridRows(workerData.site, workerData.rows)); }
else (async () => {
  const T = loadTerrain(), index = { crop: { halfM: CROP_HALF, reliefRes: RELIEF_RES, reliefN: RN, gridRes: GRID_RES, gridN: GN },
    horizon: { bins: NB, bandsM: BANDS, decode: 'deg = value / 100' }, layout: 'bin: Int16 heights (reliefN^2, m), then Uint8 sunlight (gridN^2, 0.5 % of 2027), then Uint8 Earth in view (gridN^2, 0.5 %)',
    source: 'LOLA LDEM_80S_80MPP_ADJ + NAIF DE421, scripts/make_sites.js', sites: [] };
  const only = process.argv[2];
  for (const s of SITES) {
    const t = Date.now(), hz = bandedHorizon(T, s.lat, s.lon, 2), sl = T.slope(s.lat, s.lon, 1);
    const [cx, cy] = Terrain.ll2xy(s.lat, s.lon);
    const rec = { ...s, x: Math.round(cx), y: Math.round(cy), h: Math.round(hz.h0), slope: +sl.deg.toFixed(1), bands: hz.prof.map((p) => Array.from(p, (v) => Math.round(v * 100))) };
    index.sites.push(rec);
    if (only === 'horizons') continue;
    const relief = new Int16Array(RN * RN);
    for (let r = 0; r < RN; r++) for (let c = 0; c < RN; c++) { const h = T.heightXY(cx - CROP_HALF + (c + 0.5) * RELIEF_RES, cy + CROP_HALF - (r + 0.5) * RELIEF_RES); relief[r * RN + c] = Number.isNaN(h) ? -32768 : Math.round(h); }
    const nW = Math.max(1, os.cpus().length), chunks = Array.from({ length: nW }, () => []);
    for (let r = 0; r < GN; r++) chunks[r % nW].push(r);
    const parts = await Promise.all(chunks.map((rows) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { site: s, rows } }); w.on('message', res); w.on('error', rej); })));
    const lit = new Uint8Array(GN * GN), ear = new Uint8Array(GN * GN);
    for (const part of parts) for (const row of part) { lit.set(row.lit, row.r * GN); ear.set(row.ear, row.r * GN); }
    fs.writeFileSync(path.join(ROOT, 'data/sites', s.id + '.bin'), Buffer.concat([Buffer.from(relief.buffer), Buffer.from(lit.buffer), Buffer.from(ear.buffer)]));
    console.log(s.id, 'h', rec.h, 'slope', rec.slope, ((Date.now() - t) / 1000).toFixed(1) + ' s');
  }
  fs.writeFileSync(path.join(ROOT, 'data/sites/sites.json'), JSON.stringify(index));
  console.log('done');
})();
