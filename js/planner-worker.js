/* Runs the landing-site search off the main thread (see js/planner.js). */
importScripts('sunearth.js', 'planner.js');
let EPH = null, C = null, ICE = null, iceM3 = -1;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      EPH = new SunEarth.Ephemeris(m.ephMeta, new Float32Array(m.ephData));
      C = new Planner.Candidates(m.candMeta, m.masks);
      ICE = new Planner.IceMap(m.ice);
      self.postMessage({ type: 'ready', n: C.n });
      return;
    }
    if (m.type === 'rank') {
      const o = m.opts;
      if (iceM3 !== (o.minM3 || 1)) { C.attachIce(ICE, o.minM3 || 1); iceM3 = o.minM3 || 1; }
      o.onProgress = (f) => self.postMessage({ type: 'progress', f });
      const res = Planner.rankSites(EPH, C, o);
      const top = Planner.pickTop(C, res, 3, o.minSepKm || 6);
      const n = C.n, cls = new Uint8Array(n), sc = new Float32Array(n);
      for (let i = 0; i < n; i++) { const r = res[i]; cls[i] = r.cls === 'safe' ? 1 : r.cls === 'caution' ? 2 : 3; sc[i] = r.score || 0; }
      const counts = { safe: 0, caution: 0, risky: 0 };
      for (const r of res) counts[r.cls]++;
      const strip = (r) => ({ i: r.i, lat: C.lat[r.i], lon: C.lon[r.i], h: C.h[r.i], slope: C.slope[r.i], iceKm: C.iceKm[r.i], iceId: C.iceId[r.i],
        score: r.score, parts: r.parts, cls: r.cls, ok: r.ok, alive: r.alive, sleeps: r.sleeps, uptimePct: r.uptimePct, longestSleepH: r.longestSleepH, minSoc: r.minSoc, failHour: r.failHour, neededCapWh: r.neededCapWh,
        litPct: r.litPct, commPct: r.commPct, bothPct: r.bothPct, longestDarkH: r.longestDarkH, longestNoCommH: r.longestNoCommH, startMs: r.startMs });
      self.postMessage({ type: 'result', cls, score: sc, counts, top: top.map(strip), iceKm: C.iceKm }, [cls.buffer, sc.buffer]);
    }
  } catch (e) { self.postMessage({ type: 'error', message: String(e && e.stack || e) }); }
};
