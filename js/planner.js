/*
 * Mission planner engine (browser + Node).
 *
 *  - Solar panel models: vertical panel that turns to face the Sun ("track"), or a fixed vertical
 *    panel facing an azimuth ("fixed"), plus the best fixed azimuth for a period.
 *  - Battery simulation: hourly energy balance with a minimum allowed state of charge.
 *  - Landing-site search: every precomputed candidate (2 km grid, real LOLA horizon) is tried for
 *    every landing day in the window; the lander must survive the whole mission on its battery.
 *    Score mixes sunlight, Earth contact, battery margin, slope and distance to ice.
 *
 * Geometry is the same as js/sunearth.js (Moon-fixed MOON_ME frame, DE421 ephemeris).
 */
(function (root) {
  const R = 1737400, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const SOLAR = 1361, SUN_R_1AU = 0.2666;

  function disc(x) { if (x <= -1) return 0; if (x >= 1) return 1; return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI; }
  function ll2xy(lat, lon) { const rho = 2 * R * Math.tan((90 + lat) * D2R / 2); return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)]; }
  function xy2ll(x, y) { const rho = Math.hypot(x, y); return [2 * Math.atan(rho / (2 * R)) * R2D - 90, Math.atan2(x, y) * R2D]; }

  // ---------------------------------------------------------------- ephemeris samples
  // Pre-sample Sun / Earth vectors on a regular time grid (shared by every site).
  function sampleEphem(eph, t0, hours, stepH) {
    const n = Math.max(1, Math.floor(hours / stepH));
    const sun = new Float64Array(3 * n), earth = new Float64Array(3 * n), sunR = new Float64Array(n), flux = new Float64Array(n), t = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const tk = t0 + k * stepH * 3600e3, g = eph.at(tk);
      sun[3 * k] = g.sun[0]; sun[3 * k + 1] = g.sun[1]; sun[3 * k + 2] = g.sun[2];
      earth[3 * k] = g.earth[0]; earth[3 * k + 1] = g.earth[1]; earth[3 * k + 2] = g.earth[2];
      sunR[k] = SUN_R_1AU / g.sunAU; flux[k] = SOLAR / (g.sunAU * g.sunAU); t[k] = tk;
    }
    return { n, stepH, t0, sun, earth, sunR, flux, t };
  }

  // ---------------------------------------------------------------- one site over time
  // horizonFn(az) -> deg. Returns per-step series used by everything else.
  function siteSeries(S, lat, lon, hM, horizonFn) {
    const f = lat * D2R, l = lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
    const up = [cf * cl, cf * sl, sf], ea = [-sl, cl, 0], no = [-sf * cl, -sf * sl, cf];
    const rk = (R + (hM || 0) + 2) / 1000, P = [up[0] * rk, up[1] * rk, up[2] * rk];
    const n = S.n;
    const out = { n, stepH: S.stepH, t: S.t, sunAlt: new Float32Array(n), sunAz: new Float32Array(n), lit: new Float32Array(n), flux: S.flux,
      earthAlt: new Float32Array(n), earthAz: new Float32Array(n), comm: new Uint8Array(n), hSun: new Float32Array(n), hEarth: new Float32Array(n) };
    for (let k = 0; k < n; k++) {
      const s0 = S.sun[3 * k], s1 = S.sun[3 * k + 1], s2 = S.sun[3 * k + 2];
      const alt = Math.asin(s0 * up[0] + s1 * up[1] + s2 * up[2]) * R2D;
      let az = Math.atan2(s0 * ea[0] + s1 * ea[1], s0 * no[0] + s1 * no[1] + s2 * no[2]) * R2D; if (az < 0) az += 360;
      const hs = horizonFn ? horizonFn(az) : 0;
      out.sunAlt[k] = alt; out.sunAz[k] = az; out.hSun[k] = hs; out.lit[k] = disc((alt - hs) / S.sunR[k]);
      const e0 = S.earth[3 * k] - P[0], e1 = S.earth[3 * k + 1] - P[1], e2 = S.earth[3 * k + 2] - P[2], en = Math.hypot(e0, e1, e2);
      const ealt = Math.asin((e0 * up[0] + e1 * up[1] + e2 * up[2]) / en) * R2D;
      let eaz = Math.atan2(e0 * ea[0] + e1 * ea[1], e0 * no[0] + e1 * no[1] + e2 * no[2]) * R2D; if (eaz < 0) eaz += 360;
      const he = horizonFn ? horizonFn(eaz) : 0;
      out.earthAlt[k] = ealt; out.earthAz[k] = eaz; out.hEarth[k] = he; out.comm[k] = ealt > he ? 1 : 0;
    }
    return out;
  }

  // ---------------------------------------------------------------- solar panels
  // Power (W) per step for a panel: { mode: 'track' | 'fixed', azimuth, area m2, efficiency }
  function panelPower(ser, panel) {
    const n = ser.n, P = new Float32Array(n), A = panel.area || 1, eta = panel.efficiency != null ? panel.efficiency : 0.3;
    const fixed = panel.mode === 'fixed', phi = (panel.azimuth || 0) * D2R;
    for (let k = 0; k < n; k++) {
      if (ser.lit[k] <= 0) continue;
      let c = Math.cos(ser.sunAlt[k] * D2R);                     // vertical panel
      if (fixed) c *= Math.max(0, Math.cos(ser.sunAz[k] * D2R - phi));
      P[k] = ser.flux[k] * eta * A * ser.lit[k] * c;
    }
    return P;
  }
  // Energy (Wh) for a fixed vertical panel facing each azimuth 0..355 (5 deg steps) + the tracking panel.
  function panelRose(ser, panel) {
    const bins = 72, E = new Float64Array(bins); let track = 0;
    const A = panel.area || 1, eta = panel.efficiency != null ? panel.efficiency : 0.3, dt = ser.stepH;
    for (let k = 0; k < ser.n; k++) {
      if (ser.lit[k] <= 0) continue;
      const p = ser.flux[k] * eta * A * ser.lit[k] * Math.cos(ser.sunAlt[k] * D2R) * dt;
      track += p;
      const az = ser.sunAz[k] * D2R;
      for (let b = 0; b < bins; b++) { const c = Math.cos(az - b * 5 * D2R); if (c > 0) E[b] += p * c; }
    }
    let best = 0; for (let b = 1; b < bins; b++) if (E[b] > E[best]) best = b;
    // two panels back to back (bifacial / opposite faces) facing best and best+180
    let two = 0; for (let b = 0; b < bins; b++) two = Math.max(two, E[b] + E[(b + 36) % bins]);
    return { bins: E, step: 5, bestAz: best * 5, bestWh: E[best], trackWh: track, twoFacedWh: two };
  }

  // ---------------------------------------------------------------- battery
  // gen: W per step; load W; capWh; minSoc (0..1) = lowest allowed charge; start full.
  function battery(gen, stepH, loadW, capWh, minSoc, i0, i1) {
    i0 = i0 || 0; i1 = i1 == null ? gen.length : i1;
    const floor = capWh * (minSoc || 0), soc = new Float32Array(i1 - i0);
    let e = capWh, minE = capWh, failAt = -1, debt = 0, debtMax = 0, eIn = 0;
    for (let k = i0; k < i1; k++) {
      const g = gen[k] * stepH, need = loadW * stepH;
      eIn += g;
      e = Math.min(capWh, e + g - need);
      if (e < minE) minE = e;
      if (e < floor && failAt < 0) failAt = k - i0;
      debt = Math.max(0, debt + need - g); if (debt > debtMax) debtMax = debt;
      soc[k - i0] = e / capWh;
    }
    const hours = (i1 - i0) * stepH;
    return {
      ok: failAt < 0, failHour: failAt < 0 ? null : failAt * stepH, minSoc: Math.max(0, minE) / capWh, soc,
      energyInWh: eIn, energyOutWh: loadW * hours,
      neededCapWh: debtMax / Math.max(0.05, 1 - (minSoc || 0)),   // smallest battery that would have survived
    };
  }

  // longest run (in hours) of steps where pred is true, within [i0, i1)
  function longestRun(arr, pred, stepH, i0, i1) {
    let run = 0, best = 0;
    for (let k = i0; k < i1; k++) { if (pred(arr[k])) { run += stepH; if (run > best) best = run; } else run = 0; }
    return best;
  }

  // ---------------------------------------------------------------- candidates
  function Candidates(meta, maskBuf) {
    const n = meta.count, d = meta.data;
    this.n = n; this.masks = new Uint8Array(maskBuf);
    this.lat = new Float64Array(n); this.lon = new Float64Array(n); this.h = new Float32Array(n); this.slope = new Float32Array(n);
    this.lit = new Float32Array(n); this.earth = new Float32Array(n); this.darkH = new Float32Array(n);
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.iceKm = new Float32Array(n).fill(Infinity); this.iceId = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const r = d[i];
      this.lat[i] = r[0]; this.lon[i] = r[1]; this.h[i] = r[2]; this.slope[i] = r[3]; this.lit[i] = r[4]; this.earth[i] = r[5]; this.darkH[i] = r[6];
      const xy = ll2xy(r[0], r[1]); this.x[i] = xy[0]; this.y[i] = xy[1];
    }
  }
  Candidates.prototype.horizonFn = function (i) {
    const m = this.masks, o = i * 360;
    return (az) => { const t = ((az % 360) + 360) % 360 - 0.5; const a = Math.floor(t), w = t - a; return (m[o + ((a + 360) % 360)] * (1 - w) + m[o + ((a + 1) % 360)] * w) * 0.06 - 2; };
  };
  Candidates.prototype.horizonArray = function (i) {
    const e = new Float32Array(360), o = i * 360; for (let b = 0; b < 360; b++) e[b] = this.masks[o + b] * 0.06 - 2; return e;
  };

  // ---------------------------------------------------------------- ice
  // psr: list from data/ice/psr_ice.json (rings in 20 m units). Distance (km) from (x,y) to the nearest
  // ice-bearing PSR with at least minM3 detections; 0 inside.
  function IceMap(data) {
    this.meta = data.meta; this.psr = data.psr;
    this.polys = data.psr.map((p) => p.rings20.map((r) => { const a = new Float64Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r[i] * 20; return a; }));
    this.radius = data.psr.map((p) => Math.sqrt(p.area_km2 * 1e6 / Math.PI));
  }
  // distance (map metres) from (x, y) to PSR i; 0 inside
  IceMap.prototype.distanceOneM = function (i, x, y) {
    const p = this.psr[i], rings = this.polys[i];
    if (!rings.length || rings.every((r) => r.length < 6)) return Math.max(0, Math.hypot(x - p.x, y - p.y) - this.radius[i]);
    let inside = false, d = Infinity;
    for (const r of rings) {
      const m = r.length / 2;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const xa = r[2 * a], ya = r[2 * a + 1], xb = r[2 * b], yb = r[2 * b + 1];
        if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
        const dx = xb - xa, dy = yb - ya, L = dx * dx + dy * dy;
        let t = L ? ((x - xa) * dx + (y - ya) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
        const dd = Math.hypot(x - xa - t * dx, y - ya - t * dy); if (dd < d) d = dd;
      }
    }
    return inside ? 0 : d;
  };
  // ground km from map metres (stereographic scale)
  IceMap.prototype.groundKm = function (x, y, m) { return m / (1 + (x * x + y * y) / (4 * R * R)) / 1000; };
  IceMap.prototype.distanceOne = function (i, x, y) { return this.groundKm(x, y, this.distanceOneM(i, x, y)); };
  IceMap.prototype.distance = function (x, y, minM3) {
    let best = Infinity, id = -1;
    for (let i = 0; i < this.psr.length; i++) {
      if (this.psr[i].m3 < (minM3 || 1)) continue;
      // quick reject: far from the PSR centre
      const p = this.psr[i], c = Math.hypot(x - p.x, y - p.y) - this.radius[i] * 3 - 5000;
      if (c > best) continue;
      const d = this.distanceOneM(i, x, y);
      if (d < best) { best = d; id = i; }
    }
    return { km: id < 0 ? Infinity : this.groundKm(x, y, best), id };
  };
  Candidates.prototype.attachIce = function (ice, minM3) {
    for (let i = 0; i < this.n; i++) { const r = ice.distance(this.x[i], this.y[i], minM3); this.iceKm[i] = r.km; this.iceId[i] = r.id; }
  };

  // ---------------------------------------------------------------- evaluate one site for a mission
  // ser: siteSeries over [window start, window end + mission]; lander {loadW, capWh, minSoc, panel}
  // Tries every landing step (startStep apart) in the window, returns the best start and its numbers.
  function evaluateMission(ser, gen, opts) {
    const st = ser.stepH, mSteps = Math.round(opts.missionH / st), wSteps = Math.max(1, Math.round(opts.windowH / st) + 1);
    const every = Math.max(1, Math.round((opts.startEveryH || 24) / st));
    let best = null;
    for (let s = 0; s < wSteps && s + mSteps <= ser.n; s += every) {
      const b = battery(gen, st, opts.loadW, opts.capWh, opts.minSoc, s, s + mSteps);
      let lit = 0, comm = 0, both = 0;
      for (let k = s; k < s + mSteps; k++) { lit += ser.lit[k]; comm += ser.comm[k]; if (ser.lit[k] > 0.5 && ser.comm[k]) both++; }
      const r = { start: s, ok: b.ok, minSoc: b.minSoc, failHour: b.failHour, neededCapWh: b.neededCapWh, energyInWh: b.energyInWh,
        litPct: 100 * lit / mSteps, commPct: 100 * comm / mSteps, bothPct: 100 * both / mSteps };
      const key = (r.ok ? 1000 : 0) + r.minSoc * 100 + r.commPct * 0.2 + r.litPct * 0.2;
      if (!best || key > best.key) { r.key = key; best = r; }
    }
    if (best) {
      best.longestDarkH = longestRun(ser.lit, (v) => v < 0.01, st, best.start, best.start + mSteps);
      best.longestNoCommH = longestRun(ser.comm, (v) => v === 0, st, best.start, best.start + mSteps);
      best.startMs = ser.t[best.start];
    }
    return best;
  }

  function score(r, slope, iceKm, w) {
    const sIce = Math.max(0, 1 - iceKm / (w.iceMaxKm || 15));
    const sSlope = Math.max(0, 1 - slope / 15);
    const parts = { light: r.litPct / 100, comm: r.commPct / 100, battery: r.ok ? r.minSoc : 0, slope: sSlope, ice: sIce };
    const W = { light: w.light != null ? w.light : 0.3, comm: w.comm != null ? w.comm : 0.2, battery: 0.15, slope: 0.1, ice: w.ice != null ? w.ice : 0.25 };
    let s = 0, sw = 0; for (const k in W) { s += W[k] * parts[k]; sw += W[k]; }
    return { score: 100 * s / sw, parts };
  }
  // green / amber / red
  function classify(r, slope) {
    if (!r || !r.ok || slope > 15) return 'risky';
    if (r.minSoc >= 0.3 && slope <= 8 && r.commPct >= 40) return 'safe';
    return 'caution';
  }

  // ---------------------------------------------------------------- full search
  // opts: { t0, windowH, missionH, stepH, startEveryH, loadW, capWh, minSoc, panel, weights, maxSlope, minM3, onProgress }
  function rankSites(eph, C, opts) {
    const st = opts.stepH || 1;
    const S = sampleEphem(eph, opts.t0, opts.windowH + opts.missionH + st, st);
    const res = new Array(C.n);
    const maxSlope = opts.maxSlope != null ? opts.maxSlope : 15;
    for (let i = 0; i < C.n; i++) {
      if (C.slope[i] > maxSlope) { res[i] = { i, cls: 'risky', skipped: true, score: 0 }; continue; }
      const ser = siteSeries(S, C.lat[i], C.lon[i], C.h[i], C.horizonFn(i));
      const gen = panelPower(ser, opts.panel);
      const r = evaluateMission(ser, gen, opts);
      const sc = score(r, C.slope[i], C.iceKm[i], opts.weights || {});
      r.i = i; r.score = r.ok ? sc.score : sc.score * 0.25; r.parts = sc.parts; r.cls = classify(r, C.slope[i]);
      res[i] = r;
      if (opts.onProgress && i % 400 === 0) opts.onProgress(i / C.n);
    }
    return res;
  }
  function pickTop(C, res, k, minSepKm) {
    const order = res.filter((r) => r && !r.skipped && r.ok).sort((a, b) => b.score - a.score);
    const out = [];
    for (const r of order) {
      if (out.every((o) => Math.hypot(C.x[o.i] - C.x[r.i], C.y[o.i] - C.y[r.i]) / 1000 >= (minSepKm || 6))) out.push(r);
      if (out.length >= k) break;
    }
    return out;
  }

  const api = { R, ll2xy, xy2ll, disc, sampleEphem, siteSeries, panelPower, panelRose, battery, longestRun, Candidates, IceMap,
    evaluateMission, score, classify, rankSites, pickTop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Planner = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
