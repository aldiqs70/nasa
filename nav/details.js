/* Drawings for the site file: the pointing compass, the panel-direction rose and the battery history. */
(function () {
  const NAV = window.NAV, D2R = Math.PI / 180;
  const C = { text: '#EEEBE4', muted: '#A5A198', line: '#2D2C29', ring: '#4A4843', sun: '#FFD166', earth: '#6FAEFF', sleep: '#C7903C', lost: '#E86A52' };
  const fam = () => (NAV.lang === 'ar' ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif');

  function setup(cv, h) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.max(1, r.width), H = h || Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    return { g, W, H };
  }
  function dial(g, W, H) {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 20;
    g.strokeStyle = C.ring; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
    for (let a = 0; a < 360; a += 30) { const s = Math.sin(a * D2R), c = Math.cos(a * D2R), k = a % 90 === 0 ? 7 : 4; g.beginPath(); g.moveTo(cx + s * R, cy - c * R); g.lineTo(cx + s * (R - k), cy - c * (R - k)); g.stroke(); }
    g.fillStyle = C.muted; g.font = '600 11px ' + fam(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'ltr';
    for (const [a, k] of [[0, 'N'], [90, 'E'], [180, 'Sth'], [270, 'Wst']]) g.fillText(NAV.T(k), cx + Math.sin(a * D2R) * (R + 11), cy - Math.cos(a * D2R) * (R + 11));
    return { cx, cy, R, P: (az, f) => [cx + Math.sin(az * D2R) * R * f, cy - Math.cos(az * D2R) * R * f] };
  }

  // Where the Sun and the Earth are around the site right now. The grey bar is the panel, square to the Sun.
  function compass(cv, a, bestAz) {
    const { g, W, H } = setup(cv), d = dial(g, W, H);
    if (bestAz != null) { const [x, y] = d.P(bestAz, 0.97); g.setLineDash([3, 4]); g.strokeStyle = C.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(d.cx, d.cy); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
    const arm = (az, col, on, r) => {
      const [x, y] = d.P(az, 0.88);
      g.globalAlpha = on ? 1 : 0.4; g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(on ? [] : [4, 4]); g.beginPath(); g.moveTo(d.cx, d.cy); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); g.globalAlpha = 1;
    };
    arm(a.earthAz, C.earth, a.comm, 5.5); arm(a.sunAz, C.sun, a.lit > 0, 6.5);
    g.save(); g.translate(d.cx, d.cy); g.rotate(a.sunAz * D2R); g.fillStyle = C.text; g.fillRect(-15, -3, 30, 6); g.restore();
  }

  // Energy a fixed vertical panel collects for every direction it could face, as a share of the best one.
  function rose(cv, r, sunAz) {
    const { g, W, H } = setup(cv), d = dial(g, W, H), max = Math.max(1e-9, r.bestWh), n = r.bins.length, half = 360 / n / 2 * D2R;
    g.strokeStyle = C.line; g.beginPath(); g.arc(d.cx, d.cy, d.R * 0.5, 0, 6.2832); g.stroke();
    if (r.trackWh <= 0) return;
    for (let b = 0; b < n; b++) {
      const f = r.bins[b] / max; if (f <= 0.004) continue;
      const a0 = b * r.step * D2R - Math.PI / 2;
      g.fillStyle = b * r.step === r.bestAz ? C.sun : 'rgba(255,209,102,0.42)';
      g.beginPath(); g.moveTo(d.cx, d.cy); g.arc(d.cx, d.cy, d.R * 0.94 * f, a0 - half, a0 + half); g.closePath(); g.fill();
    }
    const [x, y] = d.P(sunAz, 1); g.fillStyle = C.sun; g.strokeStyle = '#131312'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 6.2832); g.fill(); g.stroke();
  }

  // Battery charge through the mission, over the sunlight it had, with what the lander was doing underneath.
  function battery(cv, site, mis, f) {
    const { g, W, H } = setup(cv, 190), ser = site.ser, L = NAV.lander, n = mis.i1 - mis.i0, days = n / 24, ar = NAV.lang === 'ar';
    const padL = 38, padR = 8, top = 12, bot = H - 40, X = (k) => padL + (k / n) * (W - padL - padR), Y = (v) => bot - v * (bot - top);
    g.font = '500 11px ' + fam(); g.direction = 'ltr';
    const runs = (val, draw) => { for (let k = 0; k < n;) { const v = val(k); let e = k + 1; while (e < n && val(e) === v) e++; if (v) draw(v, X(k), X(e) - X(k)); k = e; } };
    runs((k) => Math.round(8 * ser.lit[mis.i0 + k]), (v, x, w) => { g.fillStyle = 'rgba(255,209,102,' + (0.15 * v / 8).toFixed(3) + ')'; g.fillRect(x, top, w, bot - top); });   // sunlight behind the curve
    g.fillStyle = C.earth; runs((k) => ser.comm[mis.i0 + k], (v, x, w) => g.fillRect(x, top - 7, w, 3));                                                                  // Earth contact along the top
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) { const y = Math.round(Y(v)) + 0.5; g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillStyle = C.muted; g.fillText(v * 100 + '%', padL - 7, y); }
    const yf = Math.round(Y(L.minSoc)) + 0.5;                              // lowest allowed charge
    g.strokeStyle = C.lost; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(padL, yf); g.lineTo(W - padR, yf); g.stroke(); g.setLineDash([]);
    g.textAlign = ar ? 'left' : 'right'; g.textBaseline = 'bottom'; g.fillStyle = C.lost; g.direction = ar ? 'rtl' : 'ltr';
    g.fillText(NAV.T('floor'), ar ? padL + 4 : W - padR - 4, yf - 3); g.direction = 'ltr';
    const soc = mis.b.soc;                                                 // charge
    g.beginPath(); g.moveTo(X(0), Y(1)); for (let k = 0; k < n; k++) g.lineTo(X(k + 1), Y(soc[k]));
    g.strokeStyle = C.text; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.lineTo(X(n), bot); g.lineTo(X(0), bot); g.closePath(); g.fillStyle = 'rgba(238,235,228,0.07)'; g.fill();
    const st = mis.b.state, col = { 1: C.text, 2: C.sleep, 3: C.lost };   // working / asleep / lost
    for (let k = 0; k < n;) { let e = k + 1; while (e < n && st[e] === st[k]) e++; g.fillStyle = col[st[k]]; g.fillRect(X(k), bot + 7, X(e) - X(k), st[k] === 1 ? 5 : st[k] === 2 ? 5 : 2); k = e; }
    g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = C.muted;   // days
    const every = days > 20 ? 4 : days > 10 ? 2 : 1;
    for (let d = 0; d < days; d += every) { const x = Math.round(X(d * 24)); g.fillRect(x, bot + 16, 1, 4); g.fillText(NAV.fmtDay(NAV.data.t0 + (mis.i0 + d * 24) * 3600e3), x + 4, bot + 19); }
    if (f >= mis.i0 && f <= mis.i1) { const x = Math.round(X(f - mis.i0)) + 0.5; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, top - 8); g.lineTo(x, bot + 14); g.stroke(); }
  }

  NAV.Details = { compass, rose, battery };
})();
