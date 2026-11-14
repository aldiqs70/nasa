/* Loads the ephemeris and the curated sites, builds a site from any picked point, and computes
   hour-by-hour series and landing outcomes. Geometry and the lander model are the existing engines:
   js/sunearth.js, js/planner.js, js/terrain.js. */
(function () {
  const NAV = (window.NAV = window.NAV || {});
  const DAY = 86400e3, D2R = Math.PI / 180, R_KM = 1737.4;
  const WINDOW_DAYS = 60, MAX_MISSION = 60, MAST = 2;
  NAV.PRESETS = {
    small: { capWh: 1500, loadW: 60, area: 1 },
    medium: { capWh: 5000, loadW: 200, area: 3 },
    large: { capWh: 20000, loadW: 600, area: 8 },
  };
  // The lander being flown. Presets fill it; the settings form edits it.
  NAV.lander = { preset: 'medium', capWh: 5000, loadW: 200, minSoc: 0.20, hibernate: true, sleepW: 20, wakeSoc: 0.50, panel: { mode: 'track', azimuth: 0, area: 3, efficiency: 0.30 } };
  NAV.setPreset = function (k) { const p = NAV.PRESETS[k], L = NAV.lander; L.preset = k; L.capWh = p.capWh; L.loadW = p.loadW; L.sleepW = p.loadW * 0.1; L.panel.area = p.area; };
  const landerKey = () => { const L = NAV.lander, P = L.panel; return [L.capWh, L.loadW, L.minSoc, L.hibernate, L.sleepW, L.wakeSoc, P.mode, P.azimuth, P.area, P.efficiency].join('|'); };

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  // Binary files have a base64 twin (<name>.json) for hosts that only serve text types.
  async function getBin(url) {
    const r = await fetch(url).catch(() => null);
    if (r && r.ok) return r.arrayBuffer();
    const j = await getJSON(url + '.json'), bin = atob(j.b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  NAV.getJSON = getJSON; NAV.getBin = getBin;

  function circMean(az, n) {
    let sx = 0, sy = 0;
    for (let k = 0; k < n; k++) { const a = az[k] * D2R; sx += Math.sin(a); sy += Math.cos(a); }
    return (Math.atan2(sx, sy) / D2R + 360) % 360;
  }

  // meta: { id, name, ar, lat, lon, h, slope, custom, flat }; bands: Float32Array per distance band (deg)
  NAV.buildSite = function (meta, bands) {
    const D = NAV.data, NB = bands[0].length, total = new Float32Array(NB);
    for (let i = 0; i < NB; i++) { let m = -90; for (const b of bands) if (b[i] > m) m = b[i]; total[i] = m; }
    const at = (arr, az) => { const t = (((az % 360) + 360) % 360) * NB / 360 - 0.5, i = Math.floor(t), w = t - i; return arr[(i + NB) % NB] * (1 - w) + arr[(i + 1) % NB] * w; };
    const hf = (az) => at(total, az);
    const ser = Planner.siteSeries(D.S, meta.lat, meta.lon, meta.h, hf), win = D.windowH;
    let lit = 0, comm = 0; for (let k = 0; k < win; k++) { lit += ser.lit[k]; comm += ser.comm[k]; }
    const xy = Planner.ll2xy(meta.lat, meta.lon);
    return Object.assign({}, meta, {
      x: xy[0], y: xy[1], bands, total, hf, bandAt: (b, az) => at(bands[b], az), ser,
      earthAz: circMean(ser.earthAz, win), litPct: 100 * lit / win, commPct: 100 * comm / win,
      darkH: Planner.longestRun(ser.lit, (v) => v < 0.01, 1, 0, win), gapH: Planner.longestRun(ser.comm, (v) => v === 0, 1, 0, win),
      poleKm: (90 + meta.lat) * D2R * R_KM, gen: {}, out: {},
    });
  };

  // The 60-day window can start on any day the ephemeris covers (2026 to 2030).
  function sample(t0) {
    const D = NAV.data, range = D.eph.range();
    t0 = Math.floor(t0 / DAY) * DAY;
    t0 = Math.min(Math.max(t0, range[0]), range[1] - (WINDOW_DAYS + MAX_MISSION + 2) * DAY);
    D.t0 = t0; D.S = Planner.sampleEphem(D.eph, t0, D.hours, 1);
    D.earthR = new Float32Array(D.S.n);
    for (let k = 0; k < D.S.n; k++) D.earthR[k] = Math.asin(6371 / Math.hypot(D.S.earth[3 * k], D.S.earth[3 * k + 1], D.S.earth[3 * k + 2])) / D2R;
  }
  NAV.load = async function () {
    const [em, eb, idx] = await Promise.all([getJSON('data/out/ephem.json'), getBin('data/out/ephem.bin'), getJSON('data/sites/sites.json')]);
    const eph = new SunEarth.Ephemeris(em, new Float32Array(eb));
    NAV.data = { eph, hours: (WINDOW_DAYS + MAX_MISSION) * 24, windowDays: WINDOW_DAYS, windowH: WINDOW_DAYS * 24, crop: idx.crop, sites: [], range: eph.range() };
    sample(Date.now());
    NAV.data.sites = idx.sites.map((s) => NAV.buildSite({ id: s.id, name: s.name, ar: s.ar, lat: s.lat, lon: s.lon, h: s.h, slope: s.slope }, s.bands.map((b) => Float32Array.from(b, (v) => v / 100))));
    return NAV.data;
  };
  // Move the window so it starts at t0 (ms). Every site is recomputed for the new dates.
  NAV.rewindow = function (t0) {
    const D = NAV.data; sample(t0);
    D.sites = D.sites.map((s) => { const n = NAV.buildSite({ id: s.id, name: s.name, ar: s.ar, lat: s.lat, lon: s.lon, h: s.h, slope: s.slope, custom: s.custom, flat: s.flat }, s.bands); n.near = s.near; return n; });
  };

  // ---------------------------------------------------------------- terrain, ice, rocks, long-term grids (loaded once, on demand)
  let terrainP = null, extrasP = null;
  NAV.terrain = function () {
    if (!terrainP) terrainP = (async () => {
      const meta = await getJSON('data/terrain/terrain.json');
      const bufs = await Promise.all(meta.levels.map((L) => getBin('data/terrain/' + L.file)));
      return (NAV.T3 = new Terrain(meta, bufs));
    })().catch((e) => { console.error(e); return null; });
    return terrainP;
  };
  NAV.extras = function () {
    if (!extrasP) extrasP = (async () => {
      const [ice, rocks, lit, earth] = await Promise.all([
        getJSON('data/ice/psr_ice.json').catch(() => null), RockMap.load('data/rocks/lp_south.json').catch(() => null),
        getBin('data/grid/lit.bin').catch(() => null), getBin('data/grid/earth.bin').catch(() => null)]);
      return (NAV.X = { ice, iceMap: ice ? new Planner.IceMap(ice) : null, rocks, lit: lit && new Uint8Array(lit), earth: earth && new Uint8Array(earth) });
    })();
    return extrasP;
  };
  // nearest ice-bearing shadowed regions: [{ km, p }]
  NAV.iceNear = function (site, n) {
    const X = NAV.X; if (!X || !X.iceMap || site.lat > -78) return [];
    return X.ice.psr.map((p, i) => ({ p, i, km: X.iceMap.distanceOne(i, site.x, site.y) })).sort((a, b) => a.km - b.km).slice(0, n || 1);
  };
  NAV.iceName = (p) => p.name || NAV.T('ice_region', { n: p.id });
  // 1 km long-term grids (2026-2030), % or null
  NAV.gridAt = function (arr, x, y) {
    if (!arr) return null;
    const c = Math.floor((x + 160000) / 1000), r = Math.floor((160000 - y) / 1000);
    if (c < 0 || r < 0 || c >= 320 || r >= 320) return null;
    const v = arr[r * 320 + c]; return v === 255 ? null : v;
  };

  // A site from any point on the Moon. Inside the terrain model the horizon is the real terrain;
  // elsewhere it is the smooth sphere.
  NAV.pick = async function (lat, lon, name) {
    lat = Math.max(-90, Math.min(90, lat)); lon = ((lon + 540) % 360) - 180;
    const T3 = lat < -79.5 ? await NAV.terrain() : null;
    const hz = T3 ? Horizon.banded(T3, Terrain, lat, lon, MAST) : null, sl = hz ? T3.slope(lat, lon, 1) : null;
    const use = hz || Horizon.sphere(MAST);
    return NAV.buildSite({ id: 'custom', custom: true, flat: !hz, name: name || null, lat, lon, h: Math.round(use.h0), slope: sl ? +sl.deg.toFixed(1) : null }, use.prof);
  };
  NAV.nearName = function (lat, lon) {
    const D = NAV.data, p = { lat, lon }; let best = null;
    for (const s of D.sites) { if (s.custom) continue; const km = NAV.distKm(p, s); if (!best || km < best.km) best = { km, s }; }
    return best && best.km < 30 ? best : null;
  };

  // ---------------------------------------------------------------- lander
  NAV.gen = function (site) {
    const k = landerKey();
    return site.gen[k] || (site.gen[k] = Planner.panelPower(site.ser, NAV.lander.panel));
  };
  // Outcome of landing at 00:00 UTC on each day of the window.
  NAV.outcomes = function (site, missionDays) {
    const key = landerKey() + ':' + missionDays;
    if (site.out[key]) return site.out[key];
    const L = NAV.lander, gen = NAV.gen(site), res = [];
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const i0 = d * 24, o = Planner.operate(gen, 1, L, i0, i0 + missionDays * 24);
      res.push({ cls: !o.alive ? 'lost' : o.ok ? 'ok' : 'sleep', dark: site.ser.lit[i0] < 0.5, sleepH: Math.round(o.longestSleepH), lostDay: o.alive ? null : Math.floor(o.deadHour / 24) + 1, minSoc: o.minSoc });
    }
    return (site.out[key] = res);
  };
  // Hour-by-hour lander state (1 working, 2 asleep, 3 lost) for one landing day.
  NAV.missionState = function (site, d, missionDays) {
    const key = 's' + landerKey() + ':' + missionDays + ':' + d;
    return site.out[key] || (site.out[key] = Planner.operate(NAV.gen(site), 1, NAV.lander, d * 24, d * 24 + missionDays * 24).state);
  };
  NAV.MAX_MISSION = MAX_MISSION;
  const good = (o) => o.cls === 'ok' && !o.dark;
  NAV.isGood = good;
  // How many more days the landing can slip and still be good (Infinity = to the end of the window).
  NAV.slack = function (out, d) {
    let n = 0; for (let k = d + 1; k < out.length; k++) { if (!good(out[k])) return n; n++; }
    return Infinity;
  };
  // A slipped schedule moves later, so look later first; earlier only if nothing later works.
  NAV.nearestGoodDay = function (out, d) {
    for (let k = d + 1; k < out.length; k++) if (good(out[k])) return k;
    for (let k = d - 1; k >= 0; k--) if (good(out[k])) return k;
    return -1;
  };
  NAV.distKm = function (a, b) {
    const f1 = a.lat * D2R, f2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    return R_KM * Math.acos(Math.max(-1, Math.min(1, Math.sin(f1) * Math.sin(f2) + Math.cos(f1) * Math.cos(f2) * Math.cos(dl))));
  };

  // The mission flown from landing day d: light, contact, energy, battery history, what would fix a failure,
  // and how a fixed panel compares with a tracking one.
  NAV.mission = function (site, d, missionDays) {
    const ser = site.ser, L = NAV.lander, i0 = d * 24, i1 = i0 + missionDays * 24, n = i1 - i0, gen = NAV.gen(site);
    let lit = 0, comm = 0, both = 0, E = 0;
    for (let k = i0; k < i1; k++) {
      lit += ser.lit[k]; comm += ser.comm[k]; if (ser.lit[k] > 0.5 && ser.comm[k]) both++;
      E += ser.flux[k] * ser.lit[k] * Math.max(0, Math.cos(ser.sunAlt[k] * D2R));
    }
    const b = Planner.operate(gen, 1, L, i0, i1), fix = {};
    if (!b.ok) {
      fix.capWh = Math.ceil(b.neededCapWh / 100) * 100;
      const strict = Object.assign({}, L, { hibernate: false }), scaled = (a) => gen.map((v) => v * a / L.panel.area);
      let lo = L.panel.area, hi = lo, ok = false;
      for (let k = 0; k < 7 && !ok; k++) { hi *= 2; ok = Planner.operate(scaled(hi), 1, strict, i0, i1).ok; }
      if (ok) { for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (Planner.operate(scaled(mid), 1, strict, i0, i1).ok) hi = mid; else lo = mid; } fix.area = Math.ceil(hi * 10) / 10; }
      if (L.hibernate && !b.alive && L.sleepW > 0) {
        let a = 0, c = L.sleepW;
        for (let k = 0; k < 14; k++) { const mid = (a + c) / 2; if (Planner.operate(gen, 1, Object.assign({}, L, { sleepW: mid }), i0, i1).alive) a = mid; else c = mid; }
        fix.sleepW = Math.max(1, Math.floor(a * 10) / 10);
      }
    }
    const sub = { n, stepH: 1, lit: ser.lit.subarray(i0, i1), sunAlt: ser.sunAlt.subarray(i0, i1), sunAz: ser.sunAz.subarray(i0, i1), flux: ser.flux.subarray(i0, i1) };
    return {
      i0, i1, litPct: 100 * lit / n, commPct: 100 * comm / n, bothPct: 100 * both / n, meanFlux: E / n,
      darkH: Planner.longestRun(ser.lit, (v) => v < 0.01, 1, i0, i1), gapH: Planner.longestRun(ser.comm, (v) => v === 0, 1, i0, i1),
      b, fix, rose: Planner.panelRose(sub, { area: 1, efficiency: L.panel.efficiency }),
    };
  };

  // Values at a fractional hour index (azimuths interpolate the short way round).
  const lerpAz = (a, b, w) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return (a + d * w + 360) % 360; };
  NAV.at = function (site, f) {
    const ser = site.ser, i = Math.max(0, Math.min(ser.n - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - i)), L = (a) => a[i] * (1 - w) + a[i + 1] * w;
    const D = NAV.data, sunAlt = L(ser.sunAlt), sunAz = lerpAz(ser.sunAz[i], ser.sunAz[i + 1], w), earthAlt = L(ser.earthAlt), earthAz = lerpAz(ser.earthAz[i], ser.earthAz[i + 1], w);
    const sunR = D.S.sunR[i], hS = site.hf(sunAz), hE = site.hf(earthAz);
    const dAz = (sunAz - earthAz) * D2R, cosEl = Math.sin(sunAlt * D2R) * Math.sin(earthAlt * D2R) + Math.cos(sunAlt * D2R) * Math.cos(earthAlt * D2R) * Math.cos(dAz);
    return { i, sunAlt, sunAz, earthAlt, earthAz, sunR, earthR: D.earthR[i], hSun: hS, hEarth: hE, lit: Planner.disc((sunAlt - hS) / sunR), comm: earthAlt > hE, flux: D.S.flux[i], earthLit: (1 - cosEl) / 2 };
  };
  // Hours from index i until pred(arr[k]) flips; null if it never does inside the data.
  NAV.untilFlip = function (arr, i, pred) {
    const now = pred(arr[i]);
    for (let k = i + 1; k < arr.length; k++) if (pred(arr[k]) !== now) return k - i;
    return null;
  };
})();
