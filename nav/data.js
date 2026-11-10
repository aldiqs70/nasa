/* Loads the ephemeris and the curated sites, then computes hour-by-hour series and landing outcomes.
   Geometry and the lander model are the existing engines: js/sunearth.js and js/planner.js. */
(function () {
  const NAV = (window.NAV = window.NAV || {});
  const HOUR = 3600e3, DAY = 86400e3;
  const WINDOW_DAYS = 60, MAX_MISSION = 28;
  NAV.LANDERS = {
    small: { capWh: 1500, loadW: 60, area: 1 },
    medium: { capWh: 5000, loadW: 200, area: 3 },
    large: { capWh: 20000, loadW: 600, area: 8 },
  };
  const EFF = 0.30, MIN_SOC = 0.20, WAKE_SOC = 0.50, SLEEP_SHARE = 0.10;

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function getBin(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); }
  NAV.getJSON = getJSON; NAV.getBin = getBin;

  function circMean(az, n) {
    let sx = 0, sy = 0;
    for (let k = 0; k < n; k++) { const a = az[k] * Math.PI / 180; sx += Math.sin(a); sy += Math.cos(a); }
    return (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
  }

  NAV.load = async function () {
    const [em, eb, idx] = await Promise.all([getJSON('data/out/ephem.json'), getBin('data/out/ephem.bin'), getJSON('data/sites/sites.json')]);
    const eph = new SunEarth.Ephemeris(em, new Float32Array(eb)), range = eph.range();
    let t0 = Math.floor(Date.now() / DAY) * DAY;
    t0 = Math.min(Math.max(t0, range[0]), range[1] - (WINDOW_DAYS + MAX_MISSION + 2) * DAY);
    const hours = (WINDOW_DAYS + MAX_MISSION) * 24;
    const S = Planner.sampleEphem(eph, t0, hours, 1);
    const earthR = new Float32Array(S.n);
    for (let k = 0; k < S.n; k++) earthR[k] = Math.asin(6371 / Math.hypot(S.earth[3 * k], S.earth[3 * k + 1], S.earth[3 * k + 2])) * 180 / Math.PI;
    const NB = idx.horizon.bins;
    const sites = idx.sites.map((s) => {
      const bands = s.bands.map((b) => Float32Array.from(b, (v) => v / 100));
      const total = new Float32Array(NB);
      for (let i = 0; i < NB; i++) { let m = -90; for (const b of bands) if (b[i] > m) m = b[i]; total[i] = m; }
      const at = (arr, az) => { const t = (((az % 360) + 360) % 360) * NB / 360 - 0.5, i = Math.floor(t), w = t - i; return arr[(i + NB) % NB] * (1 - w) + arr[(i + 1) % NB] * w; };
      const hf = (az) => at(total, az);
      const ser = Planner.siteSeries(S, s.lat, s.lon, s.h, hf);
      const win = WINDOW_DAYS * 24;
      let lit = 0, comm = 0; for (let k = 0; k < win; k++) { lit += ser.lit[k]; comm += ser.comm[k]; }
      return {
        id: s.id, name: s.name, ar: s.ar, lat: s.lat, lon: s.lon, x: s.x, y: s.y, h: s.h, slope: s.slope,
        bands, total, hf, bandAt: (b, az) => at(bands[b], az), ser,
        earthAz: circMean(ser.earthAz, win),
        litPct: 100 * lit / win, commPct: 100 * comm / win,
        darkH: Planner.longestRun(ser.lit, (v) => v < 0.01, 1, 0, win), gapH: Planner.longestRun(ser.comm, (v) => v === 0, 1, 0, win),
        gen: {}, out: {},
      };
    });
    NAV.data = { t0, hours, windowDays: WINDOW_DAYS, windowH: WINDOW_DAYS * 24, S, earthR, sites, crop: idx.crop, NB };
    return NAV.data;
  };

  NAV.landerSpec = function (key) {
    const p = NAV.LANDERS[key];
    return { capWh: p.capWh, loadW: p.loadW, minSoc: MIN_SOC, hibernate: true, sleepW: p.loadW * SLEEP_SHARE, wakeSoc: WAKE_SOC, panel: { mode: 'track', area: p.area, efficiency: EFF } };
  };
  NAV.gen = function (site, landerKey) {
    return site.gen[landerKey] || (site.gen[landerKey] = Planner.panelPower(site.ser, NAV.landerSpec(landerKey).panel));
  };
  // Outcome of landing at 00:00 UTC on each day of the window.
  NAV.outcomes = function (site, landerKey, missionDays) {
    const key = landerKey + ':' + missionDays;
    if (site.out[key]) return site.out[key];
    const L = NAV.landerSpec(landerKey), gen = NAV.gen(site, landerKey), res = [];
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const i0 = d * 24, o = Planner.operate(gen, 1, L, i0, i0 + missionDays * 24);
      res.push({
        cls: !o.alive ? 'lost' : o.ok ? 'ok' : 'sleep', dark: site.ser.lit[i0] < 0.5,
        sleepH: Math.round(o.longestSleepH), lostDay: o.alive ? null : Math.floor(o.deadHour / 24) + 1, minSoc: o.minSoc, state: o.state,
      });
    }
    return (site.out[key] = res);
  };
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
    const R = 1737.4, f1 = a.lat * Math.PI / 180, f2 = b.lat * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    return R * Math.acos(Math.min(1, Math.sin(f1) * Math.sin(f2) + Math.cos(f1) * Math.cos(f2) * Math.cos(dl)));
  };

  // Values at a fractional hour index (azimuths interpolate the short way round).
  const lerpAz = (a, b, w) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return (a + d * w + 360) % 360; };
  NAV.at = function (site, f) {
    const ser = site.ser, i = Math.max(0, Math.min(ser.n - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - i)), L = (a) => a[i] * (1 - w) + a[i + 1] * w;
    const D = NAV.data, sunAlt = L(ser.sunAlt), sunAz = lerpAz(ser.sunAz[i], ser.sunAz[i + 1], w), earthAlt = L(ser.earthAlt), earthAz = lerpAz(ser.earthAz[i], ser.earthAz[i + 1], w);
    const sunR = D.S.sunR[i], hS = site.hf(sunAz), hE = site.hf(earthAz);
    return { i, sunAlt, sunAz, earthAlt, earthAz, sunR, earthR: D.earthR[i], hSun: hS, hEarth: hE, lit: Planner.disc((sunAlt - hS) / sunR), comm: earthAlt > hE, flux: D.S.flux[i] };
  };
  // Hours from index i until pred(arr[k]) flips; null if it never does inside the data.
  NAV.untilFlip = function (arr, i, pred) {
    const now = pred(arr[i]);
    for (let k = i + 1; k < arr.length; k++) if (pred(arr[k]) !== now) return k - i;
    return null;
  };
})();
