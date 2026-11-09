/* Small canvas charts used across the site. Colours follow css/app.css. */
(function (root) {
  const C = { sun: '#d6a451', sunFill: 'rgba(214,164,81,', earth: '#6fa8dc', grid: 'rgba(194,184,200,0.16)', text: '#a79db0', terrain: 'rgba(122,108,134,0.92)', terrain2: 'rgba(111,168,220,0.35)', safe: '#52c48e', risky: '#e0605e', lav: '#c2b8c8' };
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = (t) => { const d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
  function setup(cv, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 300, H = h || cv.clientHeight || 160;
    cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.font = '11px "Space Grotesk", Arial'; return { g, W, H };
  }

  // Time series: lit / Earth bars on top, Sun & Earth altitude lines below
  function timeline(cv, s, opts) {
    opts = opts || {};
    const { g, W, H } = setup(cv, opts.height || 170);
    const i0 = opts.i0 || 0, i1 = opts.i1 || s.n, n = i1 - i0; if (n < 2) return;
    const top = 26, bot = H - 18, yMin = -8, yMax = 8;
    const X = (i) => ((i - i0) / (n - 1)) * W, Y = (v) => top + (yMax - Math.max(yMin, Math.min(yMax, v))) / (yMax - yMin) * (bot - top);
    const bw = Math.max(1, W / n + 0.6);
    for (let i = i0; i < i1; i++) {
      if (s.lit[i] > 0) { g.fillStyle = C.sunFill + (0.25 + 0.75 * s.lit[i]) + ')'; g.fillRect(X(i), 2, bw, 8); }
      if (s.comm[i]) { g.fillStyle = C.earth; g.fillRect(X(i), 13, bw, 8); }
    }
    g.strokeStyle = C.grid; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.setLineDash([]);
    const st = Math.max(1, Math.floor(n / 2000));
    const line = (arr, col) => { g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); for (let i = i0; i < i1; i += st) { const x = X(i), y = Y(arr[i]); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
    if (s.hSun) { g.strokeStyle = 'rgba(194,184,200,0.35)'; g.lineWidth = 1; g.beginPath(); for (let i = i0; i < i1; i += st) { const x = X(i), y = Y(s.hSun[i]); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    line(s.earthAlt, C.earth); line(s.sunAlt, C.sun);
    g.fillStyle = C.text; g.textAlign = 'left'; g.fillText(isoDate(s.t[i0]), 2, H - 4); g.textAlign = 'right'; g.fillText(isoDate(s.t[i1 - 1]), W - 2, H - 4);
    g.fillText('+8°', W - 2, Y(8) + 10); g.fillText('0°', W - 2, Y(0) - 3);
  }

  // Horizon panorama: terrain silhouette + Sun / Earth paths + current positions; optional second horizon
  function horizon(cv, elev, s, now, opts) {
    opts = opts || {};
    const { g, W, H } = setup(cv, opts.height || 170);
    let hzMax = 0; for (let b = 0; b < 360; b++) hzMax = Math.max(hzMax, elev[b]);
    if (opts.second) for (let b = 0; b < 360; b++) hzMax = Math.max(hzMax, opts.second[b]);
    const top = 8, bot = H - 18, yMin = -6, yMax = Math.max(8, Math.ceil(hzMax + 2));
    const X = (az) => (az / 360) * W, Y = (v) => top + (yMax - Math.max(yMin, Math.min(yMax, v))) / (yMax - yMin) * (bot - top);
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (let v = -6; v <= yMax; v += 2) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); }
    if (s) {
      const st = Math.max(1, Math.floor(s.n / 2500));
      for (let i = 0; i < s.n; i += st) {
        g.fillStyle = 'rgba(111,168,220,0.45)'; g.fillRect(X(s.earthAz[i]), Y(s.earthAlt[i]), 1.6, 1.6);
        g.fillStyle = 'rgba(214,164,81,0.55)'; g.fillRect(X(s.sunAz[i]), Y(s.sunAlt[i]), 1.6, 1.6);
      }
    }
    const sil = (e, fill, stroke) => {
      g.beginPath(); g.moveTo(0, bot);
      for (let b = 0; b <= 360; b++) g.lineTo(X(b), Y(e[b % 360]));
      g.lineTo(W, bot); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.6; g.stroke(); }
    };
    sil(elev, opts.second ? 'rgba(214,164,81,0.28)' : C.terrain, opts.second ? C.sun : null);
    if (opts.second) sil(opts.second, C.terrain2, C.earth);
    if (now) {
      if (now.sunAz != null) { g.fillStyle = '#ffd98a'; g.shadowColor = '#ffb84d'; g.shadowBlur = 10; g.beginPath(); g.arc(X(now.sunAz), Y(now.sunAlt), 5.5, 0, 7); g.fill(); g.shadowBlur = 0; }
      if (now.earthAz != null) { g.fillStyle = C.earth; g.beginPath(); g.arc(X(now.earthAz), Y(now.earthAlt), 5, 0, 7); g.fill(); }
    }
    g.fillStyle = C.text; g.textAlign = 'center';
    for (const [az, lab] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) g.fillText(lab, Math.min(W - 6, Math.max(6, X(az))), H - 4);
    g.textAlign = 'right'; g.fillText('+' + yMax + '°', W - 2, Y(yMax) + 10); g.fillText('0°', W - 2, Y(0) - 2);
  }

  // Battery state of charge curves: list of {soc, stepH, t0, color, label}
  function soc(cv, curves, minSoc, opts) {
    opts = opts || {};
    const { g, W, H } = setup(cv, opts.height || 150);
    const top = 10, bot = H - 18, n = Math.max(...curves.map((c) => c.soc.length));
    const X = (i) => (i / Math.max(1, n - 1)) * W, Y = (v) => top + (1 - v) * (bot - top);
    g.strokeStyle = C.grid; for (const v of [0, 0.25, 0.5, 0.75, 1]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); }
    if (minSoc) { g.fillStyle = 'rgba(224,96,94,0.12)'; g.fillRect(0, Y(minSoc), W, bot - Y(minSoc)); g.strokeStyle = 'rgba(224,96,94,0.7)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(0, Y(minSoc)); g.lineTo(W, Y(minSoc)); g.stroke(); g.setLineDash([]); }
    for (const c of curves) {
      if (c.state && curves.length === 1) {
        for (let i = 0; i < c.state.length; i++) {
          if (c.state[i] === 2) { g.fillStyle = 'rgba(138,106,143,0.28)'; g.fillRect(X(i), top, Math.max(1, W / n + 0.5), bot - top); }
          if (c.state[i] === 3) { g.fillStyle = 'rgba(224,96,94,0.18)'; g.fillRect(X(i), top, Math.max(1, W / n + 0.5), bot - top); }
        }
      }
    }
    for (const c of curves) {
      g.strokeStyle = c.color || C.sun; g.lineWidth = 2; g.beginPath();
      const st = Math.max(1, Math.floor(c.soc.length / 1500));
      for (let i = 0; i < c.soc.length; i += st) { const x = X(i), y = Y(c.soc[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = C.text; g.textAlign = 'right'; g.fillText('100%', W - 2, Y(1) + 11); g.fillText('0%', W - 2, Y(0) - 3);
    g.textAlign = 'left'; const c0 = curves[0];
    if (opts.relative && c0) { g.fillText('landing', 2, H - 4); g.textAlign = 'right'; g.fillText('+' + Math.round((n - 1) * (c0.stepH || 1) / 24) + ' d', W - 2, H - 4); }
    else if (c0 && c0.t0 != null) { g.fillText(isoDate(c0.t0), 2, H - 4); g.textAlign = 'right'; g.fillText(isoDate(c0.t0 + (n - 1) * (c0.stepH || 1) * 3600e3), W - 2, H - 4); }
  }

  // Polar "rose": energy of a fixed vertical panel facing each azimuth (outer ring = tracking panel)
  function rose(cv, r, nowAz, size) {
    const S = size || 230; const { g, W, H } = setup(cv, S);
    const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) / 2 - 24;
    const max = r.trackWh || 1;
    g.strokeStyle = C.grid; for (const f of [0.25, 0.5, 0.75, 1]) { g.beginPath(); g.arc(cx, cy, R0 * f, 0, 7); g.stroke(); }
    // azimuth: 0 = north (up), clockwise east
    const P = (az, f) => [cx + Math.sin(az * Math.PI / 180) * R0 * f, cy - Math.cos(az * Math.PI / 180) * R0 * f];
    g.beginPath();
    for (let b = 0; b <= r.bins.length; b++) { const k = b % r.bins.length, [x, y] = P(k * r.step, r.bins[k] / max); b ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fillStyle = 'rgba(214,164,81,0.28)'; g.fill(); g.strokeStyle = C.sun; g.lineWidth = 1.6; g.stroke();
    const [bx, by] = P(r.bestAz, r.bestWh / max);
    g.strokeStyle = '#ffd98a'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(bx, by); g.stroke();
    g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(bx, by, 4.5, 0, 7); g.fill();
    if (nowAz != null) { const [nx, ny] = P(nowAz, 1.04); g.fillStyle = '#fff3c4'; g.shadowColor = '#ffb84d'; g.shadowBlur = 10; g.beginPath(); g.arc(nx, ny, 5, 0, 7); g.fill(); g.shadowBlur = 0; }
    g.fillStyle = C.text; g.textAlign = 'center'; g.font = '600 11px "Space Grotesk", Arial';
    for (const [az, lab] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) { const [x, y] = P(az, 1.13); g.fillText(lab, x, y + 4); }
  }

  // Mission strip: Sun, Earth contact and the lander's state (1 working, 2 asleep, 3 lost) over [i0, i0 + state.length)
  function states(cv, ser, state, i0, opts) {
    opts = opts || {};
    const { g, W, H } = setup(cv, opts.height || 74), n = state.length; if (!n) return;
    const X = (i) => (i / n) * W, bw = Math.max(1, W / n + 0.6);
    const rows = [[4, 12], [20, 12], [38, 18]];
    g.fillStyle = 'rgba(194,184,200,0.06)'; for (const [y, h] of rows) g.fillRect(0, y, W, h);
    for (let i = 0; i < n; i++) {
      const k = i0 + i, x = X(i);
      if (ser.lit[k] > 0) { g.fillStyle = 'rgba(214,164,81,' + (0.2 + 0.6 * ser.lit[k]).toFixed(2) + ')'; g.fillRect(x, rows[0][0], bw, rows[0][1]); }
      if (ser.comm[k]) { g.fillStyle = C.earth; g.fillRect(x, rows[1][0], bw, rows[1][1]); }
      const s = state[i]; g.fillStyle = s === 1 ? '#d6a451' : s === 2 ? '#8a6a8f' : '#e0605e'; g.fillRect(x, rows[2][0], bw, rows[2][1]);
    }
    g.fillStyle = C.text; g.font = '11px "Manrope", Arial'; g.textAlign = 'left';
    const st = ser.stepH || 1; g.fillText(isoDate(ser.t[i0]), 2, H - 3); g.textAlign = 'right'; g.fillText(isoDate(ser.t[Math.min(ser.n - 1, i0 + n - 1)]), W - 2, H - 3);
  }

  root.Charts = { setup, timeline, horizon, soc, rose, states, isoDate };
})(window);
