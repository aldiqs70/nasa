/*
 * Precompute south-pole maps and planner candidates from the LOLA terrain grids.
 *   node scripts/precompute_grid.js            (uses all CPU cores)
 * Grid: 1 km spacing, +-160 km around the pole (south polar stereographic, same as js/terrain.js).
 * For every point: height, slope, horizon (360 rays), then over 2026-2030 (2-hour steps):
 *   lit %   = mean visible fraction of the solar disc
 *   earth % = share of time the centre of Earth is above the local horizon
 *   maxLit  = 0 means never lit in five years (permanent shadow, PSR)
 *   darkH   = longest continuous darkness in 2027 (hours)
 * Every 2nd point (2 km) with slope <= 15 deg and lit >= 20 % becomes a planner candidate and keeps its horizon mask.
 */
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HALF = 160000, STEP = 1000, N = 2 * HALF / STEP;   // 320 x 320
const R = 1737400, D2R = Math.PI / 180, R2D = 180 / Math.PI;

function loadTerrain() {
  const { Terrain } = require(path.join(ROOT, 'js/terrain.js'));
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/terrain.json')));
  const bufs = meta.levels.map((L) => { const b = fs.readFileSync(path.join(ROOT, 'data/terrain', L.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); });
  return { Terrain, T: new Terrain(meta, bufs) };
}
function loadEphem(stepH) {
  const em = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/out/ephem.json')));
  const b = fs.readFileSync(path.join(ROOT, 'data/out/ephem.bin'));
  const d = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const t0 = Date.parse(em.start_utc), n = Math.floor((em.count - 1) / stepH) + 1;
  const sun = new Float64Array(n * 3), earth = new Float64Array(n * 3), sunR = new Float64Array(n), t = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * stepH * 7, sn = Math.hypot(d[a], d[a + 1], d[a + 2]);
    sun[3 * k] = d[a] / sn; sun[3 * k + 1] = d[a + 1] / sn; sun[3 * k + 2] = d[a + 2] / sn;
    sunR[k] = 0.2666 / d[a + 3];
    earth[3 * k] = d[a + 4]; earth[3 * k + 1] = d[a + 5]; earth[3 * k + 2] = d[a + 6];
    t[k] = t0 + k * stepH * 3600e3;
  }
  return { n, sun, earth, sunR, t, stepH };
}
function disc(x) { if (x <= -1) return 0; if (x >= 1) return 1; return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI; }

function work(rows) {
  const { Terrain, T } = loadTerrain();
  const E = loadEphem(2);
  const y2027a = Date.parse('2027-01-01T00:00:00Z'), y2027b = Date.parse('2028-01-01T00:00:00Z');
  const out = [];
  for (const r of rows) {
    const row = { r, h: new Int16Array(N), slope: new Uint8Array(N), lit: new Uint8Array(N), earth: new Uint8Array(N), maxLit: new Uint8Array(N), darkH: new Uint16Array(N), cand: [] };
    for (let c = 0; c < N; c++) {
      const x = -HALF + (c + 0.5) * STEP, y = HALF - (r + 0.5) * STEP;
      const [lat, lon] = Terrain.xy2ll(x, y);
      const hz = T.horizon(lat, lon, { mast: 2, rays: 360 });
      if (!hz) { row.h[c] = -32768; row.lit[c] = row.earth[c] = row.maxLit[c] = 255; continue; }
      const sl = T.slope(lat, lon, 1);
      row.h[c] = Math.round(hz.h0); row.slope[c] = sl ? Math.min(254, Math.round(sl.deg * 4)) : 255;
      const f = lat * D2R, l = lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl2 = Math.sin(l);
      const up = [cf * cl, cf * sl2, sf], ea = [-sl2, cl, 0], no = [-sf * cl, -sf * sl2, cf];
      const rk = (R + hz.h0 + 2) / 1000, P = [up[0] * rk, up[1] * rk, up[2] * rk];
      const el = hz.elev;
      const hzAt = (az) => { const t = az - 0.5; const i = Math.floor(t), w = t - i; return el[(i + 360) % 360] * (1 - w) + el[(i + 361) % 360] * w; };
      let litSum = 0, maxLit = 0, earthN = 0, run = 0, darkMax = 0;
      for (let k = 0; k < E.n; k++) {
        const s0 = E.sun[3 * k], s1 = E.sun[3 * k + 1], s2 = E.sun[3 * k + 2];
        const alt = Math.asin(s0 * up[0] + s1 * up[1] + s2 * up[2]) * R2D;
        let lit = 0;
        if (alt > -1) {
          let az = Math.atan2(s0 * ea[0] + s1 * ea[1], s0 * no[0] + s1 * no[1] + s2 * no[2]) * R2D; if (az < 0) az += 360;
          lit = disc((alt - hzAt(az)) / E.sunR[k]);
        }
        litSum += lit; if (lit > maxLit) maxLit = lit;
        const tk = E.t[k];
        if (tk >= y2027a && tk < y2027b) { if (lit < 0.01) { run += E.stepH; if (run > darkMax) darkMax = run; } else run = 0; }
        const e0 = E.earth[3 * k] - P[0], e1 = E.earth[3 * k + 1] - P[1], e2 = E.earth[3 * k + 2] - P[2], en = Math.hypot(e0, e1, e2);
        const ealt = Math.asin((e0 * up[0] + e1 * up[1] + e2 * up[2]) / en) * R2D;
        if (ealt > -1) {
          let eaz = Math.atan2(e0 * ea[0] + e1 * ea[1], e0 * no[0] + e1 * no[1] + e2 * no[2]) * R2D; if (eaz < 0) eaz += 360;
          if (ealt > hzAt(eaz)) earthN++;
        }
      }
      const litPct = 100 * litSum / E.n, earthPct = 100 * earthN / E.n;
      row.lit[c] = Math.round(litPct); row.earth[c] = Math.round(earthPct);
      row.maxLit[c] = Math.round(maxLit * 100); row.darkH[c] = Math.min(65000, darkMax);
      if (r % 2 === 0 && c % 2 === 0 && sl && sl.deg <= 15 && litPct >= 20) {
        const m = new Uint8Array(360);
        for (let b = 0; b < 360; b++) m[b] = Math.max(0, Math.min(255, Math.round((el[b] + 2) / 0.06)));
        row.cand.push({ r, c, lat, lon, h: Math.round(hz.h0), slope: +sl.deg.toFixed(1), lit: +litPct.toFixed(1), earth: +earthPct.toFixed(1), darkH: darkMax, mask: Buffer.from(m).toString('base64') });
      }
    }
    parentPort.postMessage({ type: 'row', row: { r, h: Array.from(row.h), slope: Array.from(row.slope), lit: Array.from(row.lit), earth: Array.from(row.earth), maxLit: Array.from(row.maxLit), darkH: Array.from(row.darkH), cand: row.cand } });
  }
  parentPort.postMessage({ type: 'done' });
}

if (!isMainThread) { work(workerData.rows); }
else {
  const nW = Math.max(1, os.cpus().length), t0 = Date.now();
  const H = new Int16Array(N * N), S = new Uint8Array(N * N), L = new Uint8Array(N * N), EA = new Uint8Array(N * N), ML = new Uint8Array(N * N), DK = new Uint16Array(N * N);
  const cands = []; let done = 0, rowsDone = 0;
  for (let w = 0; w < nW; w++) {
    const rows = []; for (let r = w; r < N; r += nW) rows.push(r);
    const wk = new Worker(__filename, { workerData: { rows } });
    wk.on('message', (m) => {
      if (m.type === 'row') {
        const o = m.row.r * N;
        H.set(m.row.h, o); S.set(m.row.slope, o); L.set(m.row.lit, o); EA.set(m.row.earth, o); ML.set(m.row.maxLit, o); DK.set(m.row.darkH, o);
        cands.push(...m.row.cand); rowsDone++;
        if (rowsDone % 10 === 0) console.log(`rows ${rowsDone}/${N}  ${((Date.now() - t0) / 60000).toFixed(1)} min  candidates ${cands.length}`);
      } else if (++done === nW) finish();
    });
    wk.on('error', (e) => { console.error(e); process.exit(1); });
  }
  function finish() {
    const dir = path.join(ROOT, 'data/grid'); fs.mkdirSync(dir, { recursive: true });
    const write = (name, arr) => fs.writeFileSync(path.join(dir, name), Buffer.from(arr.buffer));
    write('height.bin', H); write('slope4.bin', S); write('lit.bin', L); write('earth.bin', EA); write('maxlit.bin', ML); write('darkh.bin', DK);
    fs.writeFileSync(path.join(dir, 'grid.json'), JSON.stringify({
      res: STEP, nx: N, ny: N, xmin: -HALF, ymax: HALF, crs: '+proj=stere +lat_0=-90 +lon_0=0 +R=1737400',
      period: '2026-01-01..2030-12-31, 2-hour steps; darkness: year 2027', observer_height_m: 2, horizon_rays: 360,
      files: { height: 'height.bin (int16 m, -32768 none)', slope: 'slope4.bin (uint8 deg*4, 255 none)', lit: 'lit.bin (uint8 % of time Sun visible, disc-weighted, 255 none)',
        earth: 'earth.bin (uint8 % of time Earth centre above horizon)', maxLit: 'maxlit.bin (uint8 max % of solar disc ever visible; 0 = permanent shadow)', darkH: 'darkh.bin (uint16 longest darkness in 2027, hours)' },
      source: 'LOLA LDEM_80S_80MPP_ADJ + NAIF DE421 ephemeris, computed by scripts/precompute_grid.js' }, null, 1));
    cands.sort((a, b) => a.r - b.r || a.c - b.c);
    // candidates: json meta + packed horizon masks
    const masks = Buffer.concat(cands.map((c) => Buffer.from(c.mask, 'base64')));
    fs.writeFileSync(path.join(dir, 'cand_masks.bin'), masks);
    fs.writeFileSync(path.join(dir, 'cand.json'), JSON.stringify({ count: cands.length, mask: { bins: 360, decode: 'elev_deg = byte*0.06 - 2' },
      fields: ['lat', 'lon', 'h', 'slope', 'lit', 'earth', 'darkH'], data: cands.map((c) => [+c.lat.toFixed(5), +c.lon.toFixed(5), c.h, c.slope, c.lit, c.earth, c.darkH]) }));
    console.log('done', ((Date.now() - t0) / 60000).toFixed(1), 'min, candidates', cands.length, 'mask bytes', masks.length);
  }
}
