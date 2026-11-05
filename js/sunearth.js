/*
 * Sun / Earth geometry for a point on the lunar surface.
 * All vectors are in the Moon-fixed MOON_ME frame (same as LOLA and Cesium Moon).
 * Works in the browser (window.SunEarth) and in Node (module.exports) for testing.
 */
(function (root) {
  const R_MOON_KM = 1737.4;
  const SOLAR_CONST = 1361;          // W/m^2 at 1 AU
  const SUN_RADIUS_DEG_1AU = 0.2666; // apparent solar radius at 1 AU
  const EARTH_RADIUS_KM = 6371.0;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);

  // --- Ephemeris table -------------------------------------------------------
  function Ephemeris(meta, data) {
    this.meta = meta;
    this.data = data;                       // Float32Array, 7 values per step
    this.t0 = Date.parse(meta.start_utc);   // ms
    this.stepMs = meta.step_hours * 3600e3;
    this.count = meta.count;
  }
  Ephemeris.prototype.range = function () {
    return [this.t0, this.t0 + (this.count - 1) * this.stepMs];
  };
  // Linear interpolation between hourly samples. Returns {sun:[unit], sunAU, earth:[km]}
  Ephemeris.prototype.at = function (tMs) {
    let x = (tMs - this.t0) / this.stepMs;
    x = Math.min(Math.max(x, 0), this.count - 1.000001);
    const i = Math.floor(x), w = x - i, d = this.data, a = i * 7, b = a + 7;
    const L = (k) => d[a + k] * (1 - w) + d[b + k] * w;
    const s = [L(0), L(1), L(2)], sn = norm(s);
    return { sun: [s[0] / sn, s[1] / sn, s[2] / sn], sunAU: L(3), earth: [L(4), L(5), L(6)] };
  };

  // --- Local frame at a surface point ---------------------------------------
  function localFrame(latDeg, lonDeg, heightM) {
    const f = latDeg * D2R, l = lonDeg * D2R;
    const cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
    const up = [cf * cl, cf * sl, sf];
    const east = [-sl, cl, 0];
    const north = [-sf * cl, -sf * sl, cf];
    const rKm = R_MOON_KM + (heightM || 0) / 1000;
    return { up, east, north, pos: [up[0] * rKm, up[1] * rKm, up[2] * rKm] };
  }

  function altAz(dir, fr) {
    const n = norm(dir);
    const alt = Math.asin(Math.max(-1, Math.min(1, dot(dir, fr.up) / n))) * R2D;
    let az = Math.atan2(dot(dir, fr.east), dot(dir, fr.north)) * R2D;
    if (az < 0) az += 360;
    return { alt, az };
  }

  // Fraction of the solar disc above a horizon of elevation H (deg).
  function discFraction(altDeg, horizonDeg, radiusDeg) {
    const x = (altDeg - horizonDeg) / radiusDeg;
    if (x <= -1) return 0;
    if (x >= 1) return 1;
    return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI;
  }

  /*
   * Everything for one point at one time.
   * horizonFn(azDeg) -> horizon elevation in degrees (0 until terrain is added).
   * panel: { efficiency } ; power is for 1 m^2 of a vertical panel that turns to face the Sun.
   */
  function evaluate(eph, tMs, fr, horizonFn, panel) {
    const g = eph.at(tMs);
    const sun = altAz(g.sun, fr);
    const ev = [g.earth[0] - fr.pos[0], g.earth[1] - fr.pos[1], g.earth[2] - fr.pos[2]];
    const earth = altAz(ev, fr);
    const earthDist = norm(ev);
    const hSun = horizonFn ? horizonFn(sun.az) : 0;
    const hEarth = horizonFn ? horizonFn(earth.az) : 0;
    const sunR = SUN_RADIUS_DEG_1AU / g.sunAU;
    const lit = discFraction(sun.alt, hSun, sunR);
    const flux = SOLAR_CONST / (g.sunAU * g.sunAU);
    const eff = panel && panel.efficiency != null ? panel.efficiency : 0.30;
    const power = flux * eff * lit * Math.max(0, Math.cos(sun.alt * D2R));
    const earthR = Math.asin(EARTH_RADIUS_KM / earthDist) * R2D;
    const earthVisible = earth.alt > hEarth;            // centre of Earth above the horizon
    const earthDisc = discFraction(earth.alt, hEarth, earthR);
    return { sun, earth, lit, power, flux, earthVisible, earthDisc, hSun, hEarth, sunAU: g.sunAU, earthDistKm: earthDist };
  }

  // Statistics over a period [t0, t0 + hours), sampled every stepH hours.
  function analyse(eph, t0, hours, fr, horizonFn, panel, stepH) {
    stepH = stepH || 1;
    const n = Math.floor(hours / stepH);
    const series = { t: new Float64Array(n), sunAlt: new Float32Array(n), earthAlt: new Float32Array(n), sunAz: new Float32Array(n), earthAz: new Float32Array(n), lit: new Float32Array(n), comm: new Uint8Array(n), power: new Float32Array(n) };
    let litSum = 0, commSum = 0, energyWh = 0, darkRun = 0, darkMax = 0, gapRun = 0, gapMax = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * stepH * 3600e3;
      const r = evaluate(eph, t, fr, horizonFn, panel);
      series.t[i] = t; series.sunAlt[i] = r.sun.alt; series.earthAlt[i] = r.earth.alt; series.sunAz[i] = r.sun.az; series.earthAz[i] = r.earth.az;
      series.lit[i] = r.lit; series.comm[i] = r.earthVisible ? 1 : 0; series.power[i] = r.power;
      litSum += r.lit; energyWh += r.power * stepH;
      if (r.lit === 0) { darkRun += stepH; if (darkRun > darkMax) darkMax = darkRun; } else darkRun = 0;
      if (r.earthVisible) { commSum++; gapRun = 0; } else { gapRun += stepH; if (gapRun > gapMax) gapMax = gapRun; }
    }
    return {
      series,
      litPct: 100 * litSum / n,
      commPct: 100 * commSum / n,
      longestDarkH: darkMax,
      longestGapH: gapMax,
      energyKWh: energyWh / 1000,
      meanPowerW: energyWh / (n * stepH),
    };
  }

  const api = { Ephemeris, localFrame, altAz, discFraction, evaluate, analyse, R_MOON_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SunEarth = api;
})(typeof window !== 'undefined' ? window : globalThis);
