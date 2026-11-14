/* One strip per site across the 60-day window: sunlight (brightness), Earth contact (blue line) and,
   for every possible landing day, what happens to the lander. Drag the landing flag on the date axis
   to slip the schedule; click or drag in the rows to move the time shown in the sky view. */
(function () {
  const NAV = window.NAV;
  const AX = 46, ROW = 60;
  const C = { line: '#2D2C29', text: '#EEEBE4', muted: '#A5A198', sun: [255, 209, 102], earth: '#6FAEFF', sleep: '#C7903C', lost: '#E86A52', track: '#1B1B19', sel: '#1D1D1B' };

  function Strips(cv, cb) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.cb = cb; this.w = 1; this.rows = 0; this.cols = null;
    let mode = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: e.clientY - r.top }; };
    const apply = (p) => {
      const h = p.x / this.w * NAV.data.windowH;
      if (mode === 'land') cb.onLanding(Math.max(0, Math.min(NAV.data.windowDays - 1, Math.round(h / 24))));
      else cb.onTime(Math.max(0, Math.min(NAV.data.windowH - 1, h)));
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e); mode = p.y < AX ? 'land' : 'time';
      if (mode === 'time') { const r = Math.floor((p.y - AX) / ROW); if (r >= 0 && r < this.rows) cb.onSelect(r); }
      cv.setPointerCapture(e.pointerId); apply(p);
    });
    cv.addEventListener('pointermove', (e) => { const p = pos(e); if (mode) apply(p); else cv.style.cursor = p.y < AX ? 'ew-resize' : 'crosshair'; });
    const end = () => { mode = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  Strips.AX = AX; Strips.ROW = ROW;

  Strips.prototype.resize = function (rows) {
    this.rows = rows; this.cv.style.height = AX + rows * ROW + 1 + 'px';
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width); this.h = AX + rows * ROW + 1; this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
    this.cols = null;
  };

  // per pixel column: mean sunlight (0..16) and whether the Earth is in view for most of it
  Strips.prototype.columns = function (sites) {
    if (this.cols) return this.cols;
    const W = Math.round(this.w), win = NAV.data.windowH;
    this.cols = sites.map((s) => {
      const lit = new Uint8Array(W), comm = new Uint8Array(W);
      for (let x = 0; x < W; x++) {
        const k0 = Math.floor(x / W * win), k1 = Math.max(k0 + 1, Math.floor((x + 1) / W * win));
        let l = 0, c = 0; for (let k = k0; k < k1; k++) { l += s.ser.lit[k]; c += s.ser.comm[k]; }
        lit[x] = Math.round(16 * l / (k1 - k0)); comm[x] = c * 2 >= k1 - k0 ? 1 : 0;
      }
      return { lit, comm };
    });
    return this.cols;
  };

  Strips.prototype.draw = function (st) {
    const g = this.ctx, W = this.w, H = this.h, D = NAV.data, win = D.windowH, X = (h) => h / win * W;
    const cols = this.columns(D.sites), ar = NAV.lang === 'ar';
    const font = (px, wt) => (wt || 500) + ' ' + px + 'px ' + (ar ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, W, H); g.direction = ar ? 'rtl' : 'ltr';

    // date axis
    const dayW = W / D.windowDays, every = dayW * 5 < 52 ? 10 : 5;
    g.font = font(11); g.textBaseline = 'alphabetic';
    for (let d = 0; d <= D.windowDays; d++) {
      const x = Math.round(X(d * 24)), major = d % every === 0;
      g.fillStyle = major ? C.muted : '#55534E'; g.fillRect(Math.min(W - 1, x), AX - (major ? 7 : 3), 1, major ? 7 : 3);
      if (major && d < D.windowDays) { g.textAlign = 'left'; g.fillStyle = C.muted; g.fillText(NAV.fmtDay(D.t0 + d * 864e5) + (d === 0 ? ' ' + new Date(D.t0).getUTCFullYear() : ''), x + 4, AX - 11); }
    }

    // rows
    for (let r = 0; r < D.sites.length; r++) {
      const y0 = AX + r * ROW, col = cols[r], out = st.outs[r];
      if (r === st.sel) { g.fillStyle = C.sel; g.fillRect(0, y0, W, ROW); }
      g.fillStyle = C.line; g.fillRect(0, y0, W, 1);
      g.fillStyle = r === st.sel ? '#262624' : C.track; g.fillRect(0, y0 + 9, W, 20);
      for (let x = 0, n = col.lit.length; x < n;) {                    // sunlight, merged runs
        let e = x + 1; while (e < n && col.lit[e] === col.lit[x]) e++;
        if (col.lit[x]) { g.fillStyle = 'rgba(' + C.sun + ',' + (col.lit[x] / 16).toFixed(3) + ')'; g.fillRect(x, y0 + 9, e - x, 20); }
        x = e;
      }
      g.fillStyle = C.earth;
      for (let x = 0, n = col.comm.length; x < n;) {
        let e = x + 1; while (e < n && col.comm[e] === col.comm[x]) e++;
        if (col.comm[x]) g.fillRect(x, y0 + 33, e - x, 3);
        x = e;
      }
      for (let d = 0; d < D.windowDays; d++) {                         // landing lane
        const o = out[d], x = X(d * 24) + 0.5, w = Math.max(1.5, dayW - 1.5), y = y0 + 42;
        if (o.cls === 'ok' && !o.dark) { g.fillStyle = C.text; g.fillRect(x, y, w, 8); }
        else if (o.cls === 'ok') { g.strokeStyle = C.text; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, 7); }
        else if (o.cls === 'sleep') { g.fillStyle = C.sleep; g.fillRect(x, y + 4, w, 4); }
        else { g.fillStyle = C.lost; g.fillRect(x, y + 6.5, w, 1.5); }
      }
    }
    g.fillStyle = C.line; g.fillRect(0, AX + D.sites.length * ROW, W, 1);

    // mission span
    const x0 = X(st.land * 24), x1 = Math.min(W, X((st.land + st.mission) * 24));
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x0, AX, x1 - x0, H - AX);
    g.fillStyle = C.text; g.fillRect(Math.round(x0), 22, 1.5, H - 22);
    if (X((st.land + st.mission) * 24) <= W) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(x1) - 0.5, AX); g.lineTo(Math.round(x1) - 0.5, H); g.stroke(); g.setLineDash([]); }

    // plan marker and landing flag
    g.font = font(11, 600); g.textBaseline = 'middle';
    const flag = NAV.T('landing') + ' ' + NAV.fmtDay(D.t0 + st.land * 864e5), fw = g.measureText(flag).width + 14;
    const xp = X(st.plan * 24);
    let flagLeft = x0 + fw <= W;                                        // flag extends right of its pole when it fits
    if (st.plan !== st.land) {
      if (st.plan > st.land && xp - x0 < fw + 40 && x0 - fw >= 0) flagLeft = false;
      g.strokeStyle = C.muted; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(Math.round(xp) + 0.5, 6); g.lineTo(Math.round(xp) + 0.5, H); g.stroke(); g.setLineDash([]);
      const after = st.plan > st.land ? !flagLeft || xp - x0 >= fw + 40 : false;
      g.fillStyle = C.muted; g.textAlign = after ? 'left' : 'right'; g.fillText(NAV.T('plan'), xp + (after ? 5 : -5), 12);
    }
    const fx = flagLeft ? Math.round(x0) : Math.round(x0) - fw + 1.5;
    g.fillStyle = C.text; g.fillRect(fx, 2, fw, 20);
    g.fillStyle = '#111110'; g.textAlign = 'center'; g.fillText(flag, fx + fw / 2, 12.5);

    // time shown in the sky view
    const xt = Math.round(X(st.f)) + 0.5;
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 1; g.beginPath(); g.moveTo(xt, AX - 2); g.lineTo(xt, H); g.stroke();
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.moveTo(xt - 5, AX - 8); g.lineTo(xt + 5, AX - 8); g.lineTo(xt, AX - 1); g.closePath(); g.fill();
  };

  NAV.Strips = Strips;
})();
