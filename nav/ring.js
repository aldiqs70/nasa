/* Ring of Light: one site and one mission as a single circle.
   Near the pole the Sun does not rise and set, it travels once around the horizon every 29.5 days,
   so around this circle direction and date are the same thing.
     inside : the sky seen from the site, zenith toward the centre, terrain horizon growing in from the rim
              (same computed horizon as the Sky tab), the Sun's path and the Earth
     rings  : for each hour after landing, drawn at the Sun's azimuth of that hour:
              sunlight on the lander, Earth in view, and what the lander is doing
   Drag around the ring to slip the landing date. */
(function () {
  const NAV = window.NAV, D2R = Math.PI / 180;
  const LAP_H = 709;                                   // one lap of the Sun, hours
  const E0 = -6, E1 = 14;                              // elevation at the rim and at the inner edge of the sky, deg
  const BAND_LIGHT = [1.0, 0.93, 0.84, 0.74], BAND_SHADOW = [0.9, 0.75, 0.4, 0.0];
  const C = { text: '#EEEBE4', muted: '#A5A198', track: '#1F1F1D', sun: '#FFD166', earth: '#6FAEFF', sleep: '#C7903C', lost: '#E86A52' };
  const wrap = (d) => ((d % 360) + 540) % 360 - 180;
  const ang = (az) => (az - 90) * D2R;                 // canvas angle of an azimuth (north up, east right)

  function Ring(cv, cb) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.cb = cb; this.size = 1; this.g = null;
    let drag = null;
    const where = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; return { rad: Math.hypot(x, y), az: (Math.atan2(x, -y) / D2R + 360) % 360 }; };
    cv.addEventListener('pointerdown', (e) => { const p = where(e); if (!this.g || p.rad < this.g.R0) return; drag = { az: p.az, land: this.land }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      const p = where(e);
      if (!drag) { cv.style.cursor = this.g && p.rad >= this.g.R0 ? 'grab' : 'default'; return; }
      cb.onLanding(drag.land + Math.round(wrap(p.az - drag.az) / (this.rate || -12.19)));
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  Ring.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.max(1, r.width); this.dpr = dpr; this.cv.width = this.cv.height = Math.round(this.size * dpr);
  };

  // The Sun's azimuth unwrapped over [i0, i1], so arcs follow its real direction of travel (it runs
  // anticlockwise seen from the south pole, clockwise in the north).
  function unwrap(ser, i0, i1) {
    const U = new Float64Array(i1 - i0 + 1); U[0] = ser.sunAz[i0];
    for (let k = i0 + 1; k <= i1; k++) U[k - i0] = U[k - i0 - 1] + wrap(ser.sunAz[k] - ser.sunAz[k - 1]);
    return U;
  }
  // arcs of constant value along [k0, k1): fn(k) -> value, draw(value, angle0, angle1, anticlockwise)
  function runs(U, i0, k0, k1, fn, draw) {
    for (let k = k0; k < k1;) {
      const v = fn(k); let e = k + 1; while (e < k1 && fn(e) === v) e++;
      if (v) { const a0 = ang(U[k - i0]), a1 = ang(U[Math.min(e, i0 + U.length - 1) - i0]), ccw = a1 < a0; draw(v, a0, a1 + (ccw ? -0.004 : 0.004), ccw); }
      k = e;
    }
  }
  const stateCol = { 1: C.text, 2: C.sleep, 3: C.lost };

  Ring.prototype.draw = function (site, st, state) {
    const g = this.ctx, S = this.size, c = S / 2, Rm = S / 2, ser = site.ser, ar = NAV.lang === 'ar';
    const q = Math.max(0.62, Math.min(1, S / 520)), R0 = Rm - 76 * q, R1 = R0 * 0.5, rad = (alt) => R0 - (Math.max(E0, Math.min(E1, alt)) - E0) / (E1 - E0) * (R0 - R1);
    const P = (az, r) => [c + Math.sin(az * D2R) * r, c - Math.cos(az * D2R) * r];
    const i0 = st.land * 24, i1 = Math.min(ser.n - 1, i0 + LAP_H), mEnd = Math.min(ser.n - 1, i0 + st.mission * 24), U = unwrap(ser, i0, Math.max(i1, mEnd));
    const inLap = st.f >= i0 && st.f <= i1, a = NAV.at(site, inLap ? st.f : i0);
    const fam = ar ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif';
    this.land = st.land; this.g = { R0 }; this.rate = (U[Math.min(24, U.length - 1)] - U[0]) || -12.19;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.setLineDash([]);

    // ---- the sky inside the rim
    g.save(); g.beginPath(); g.arc(c, c, R0, 0, 6.2832); g.clip();
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.lineWidth = 1;
    for (const alt of [0, 5, 10]) { g.strokeStyle = alt === 0 ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.09)'; g.setLineDash(alt === 0 ? [2, 5] : []); g.beginPath(); g.arc(c, c, rad(alt), 0, 6.2832); g.stroke(); }
    g.setLineDash([]);
    // Earth's path, then the lit part of the Sun's path
    g.strokeStyle = 'rgba(111,174,255,0.6)'; g.beginPath();
    for (let k = i0; k <= i1; k += 2) { const [x, y] = P(ser.earthAz[k], rad(ser.earthAlt[k])); if (k === i0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    g.strokeStyle = C.sun; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let k = i0; k < i1; k++) {
      if (ser.lit[k] <= 0 && ser.lit[k + 1] <= 0) continue;
      const [x0, y0] = P(ser.sunAz[k], rad(ser.sunAlt[k])), [x1, y1] = P(ser.sunAz[k + 1], rad(ser.sunAlt[k + 1]));
      g.globalAlpha = 0.35 + 0.65 * ser.lit[k]; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    // Sun and Earth at the time shown
    const [sx, sy] = P(a.sunAz, rad(a.sunAlt)), [ex, ey] = P(a.earthAz, rad(a.earthAlt)), er = Math.max(6, a.earthR * (R0 - R1) / (E1 - E0));
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 46);
    glow.addColorStop(0, 'rgba(255,226,160,0.85)'); glow.addColorStop(0.18, 'rgba(255,209,102,0.35)'); glow.addColorStop(1, 'rgba(255,190,90,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = glow; g.fillRect(sx - 46, sy - 46, 92, 92); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#FFF8E6'; g.beginPath(); g.arc(sx, sy, 4.5, 0, 6.2832); g.fill();
    const day = g.createRadialGradient(ex - er * 0.3, ey - er * 0.3, er * 0.1, ex, ey, er);
    day.addColorStop(0, '#E4EFFF'); day.addColorStop(0.6, '#79B0FF'); day.addColorStop(1, '#2F66C8');
    g.globalAlpha = 0.35 + 0.65 * a.earthLit; g.fillStyle = day; g.beginPath(); g.arc(ex, ey, er, 0, 6.2832); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(111,174,255,0.7)'; g.lineWidth = 1; g.beginPath(); g.arc(ex, ey, er, 0, 6.2832); g.stroke();
    // terrain, far band first, growing in from the rim
    const N = 720;
    for (let b = site.bands.length - 1; b >= 0; b--) {
      const shade = BAND_LIGHT[b] * (1 - BAND_SHADOW[b] * (1 - a.lit));
      let fill = 'rgb(60,59,56)';
      if (g.createConicGradient) {
        fill = g.createConicGradient(-Math.PI / 2, c, c);
        for (let s = 0; s <= 36; s++) { const front = (1 - Math.cos((s * 10 - a.sunAz) * D2R)) / 2, I = shade * (0.03 + 0.97 * Math.pow(front, 1.6)); fill.addColorStop(s / 36, 'rgb(' + Math.round(6 + 206 * I) + ',' + Math.round(6 + 200 * I) + ',' + Math.round(5 + 188 * I) + ')'); }
      }
      g.beginPath(); g.arc(c, c, R0 + 2, 0, 6.2832);
      for (let s = 0; s <= N; s++) { const az = s * 360 / N, [x, y] = P(az, rad(site.bandAt(b, az))); if (s === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.closePath(); g.fillStyle = fill; g.fill('evenodd');
      g.beginPath(); for (let s = 0; s <= N; s++) { const az = s * 360 / N, [x, y] = P(az, rad(site.bandAt(b, az))); if (s === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokeStyle = 'rgba(255,255,255,' + (0.08 + 0.14 * shade) + ')'; g.lineWidth = 1; g.stroke();
    }
    const rim = g.createRadialGradient(c, c, R0 - 26, c, c, R0); rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = rim; g.fillRect(0, 0, S, S);
    // the whole path as a ghost line, and hidden bodies as dashed rings
    g.strokeStyle = 'rgba(255,209,102,0.4)'; g.lineWidth = 1; g.setLineDash([1, 4]); g.beginPath();
    for (let k = i0; k <= i1; k += 2) { const [x, y] = P(ser.sunAz[k], rad(ser.sunAlt[k])); if (k === i0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([3, 3]); g.lineWidth = 1.2;
    if (a.lit <= 0) { g.strokeStyle = 'rgba(255,209,102,0.95)'; g.beginPath(); g.arc(sx, sy, 6.5, 0, 6.2832); g.stroke(); }
    if (!a.comm) { g.strokeStyle = 'rgba(111,174,255,0.95)'; g.beginPath(); g.arc(ex, ey, er, 0, 6.2832); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = C.muted; g.font = '600 10.5px ' + fam; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'ltr';
    { const [x, y] = P(0, R1 - 4); g.fillText(NAV.T('N'), x, y); g.strokeStyle = C.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(c, c - R1 + 6); g.lineTo(c, c - R1 + 14); g.stroke(); }
    g.restore();
    g.strokeStyle = '#4A4843'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, R0, 0, 6.2832); g.stroke();

    // ---- the time rings outside the rim
    const rSun = Rm - 64 * q, rEarth = Rm - 52 * q, rState = Rm - 44 * q, rLab = Rm - 21 * q, wSun = 12 * q;
    g.strokeStyle = C.track; g.lineWidth = wSun; g.beginPath(); g.arc(c, c, rSun, 0, 6.2832); g.stroke();
    g.lineWidth = wSun; runs(U, i0, i0, i1, (k) => Math.round(8 * ser.lit[k]), (v, a0, a1, ccw) => { g.strokeStyle = 'rgba(255,209,102,' + (v / 8).toFixed(3) + ')'; g.beginPath(); g.arc(c, c, rSun, a0, a1, ccw); g.stroke(); });
    g.lineWidth = 3; g.strokeStyle = C.earth; runs(U, i0, i0, i1, (k) => ser.comm[k], (v, a0, a1, ccw) => { g.beginPath(); g.arc(c, c, rEarth, a0, a1, ccw); g.stroke(); });
    if (state) for (let lap = 0, k0 = i0; k0 < mEnd; lap++, k0 += LAP_H) {                      // lander state, one more ring per lap
      const k1 = Math.min(mEnd, k0 + LAP_H);
      runs(U, i0, k0, k1, (k) => state[k - i0] || 0, (v, a0, a1, ccw) => { g.lineWidth = v === 3 ? 2 : 4; g.strokeStyle = stateCol[v]; g.beginPath(); g.arc(c, c, rState + lap * 6 * q, a0, a1, ccw); g.stroke(); });
    }
    // days: a tick each day, a date every fifth day
    g.font = '500 10.5px ' + fam; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = ar ? 'rtl' : 'ltr';
    for (let d = 0; d * 24 < i1 - i0; d++) {
      const az = ser.sunAz[i0 + d * 24], [x0, y0] = P(az, rSun - wSun / 2), [x1, y1] = P(az, rSun - (d % 5 === 0 ? 0 : wSun / 4));
      g.strokeStyle = d % 5 === 0 ? '#000' : 'rgba(0,0,0,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (d > 0 && d % 5 === 0 && Math.abs(wrap(az - ser.sunAz[i0])) > 24) { const [x, y] = P(az, rLab); g.fillStyle = C.muted; g.fillText(NAV.fmtDayShort(NAV.data.t0 + (i0 + d * 24) * 3600e3), x, y); }
    }
    // landing flag and mission end
    const azL = ser.sunAz[i0], [lx0, ly0] = P(azL, R0), [lx1, ly1] = P(azL, Rm - 34 * q), [tx, ty] = P(azL, rLab);
    g.strokeStyle = C.text; g.lineWidth = 2; g.beginPath(); g.moveTo(lx0, ly0); g.lineTo(lx1, ly1); g.stroke();
    g.font = '700 11px ' + fam; const lab = NAV.fmtDayShort(NAV.data.t0 + i0 * 3600e3), tw = g.measureText(lab).width + 10;
    const bx = Math.max(1, Math.min(S - tw - 1, tx - tw / 2)), by = Math.max(1, Math.min(S - 19, ty - 9));
    g.fillStyle = C.text; g.fillRect(bx, by, tw, 18); g.fillStyle = '#111110'; g.fillText(lab, bx + tw / 2, by + 9.5);
    if (st.mission * 24 < LAP_H) { const azE = ser.sunAz[mEnd], [x0, y0] = P(azE, R0), [x1, y1] = P(azE, Rm - 36 * q); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]); }
    if (inLap) { const [x0, y0] = P(a.sunAz, rSun - wSun / 2 - 2), [x1, y1] = P(a.sunAz, rSun + wSun / 2 + 2); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  };

  // The time rings alone, for comparing sites at a glance.
  Ring.mini = function (cv, site, land, mission, state) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), S = Math.max(1, r.width), g = cv.getContext('2d'), c = S / 2, ser = site.ser;
    cv.width = cv.height = Math.round(S * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    const i0 = land * 24, i1 = Math.min(ser.n - 1, i0 + LAP_H), mEnd = Math.min(i1, i0 + mission * 24), rSun = S / 2 - 12, rEarth = rSun - 8, rState = S / 2 - 3, U = unwrap(ser, i0, i1);
    g.strokeStyle = C.track; g.lineWidth = 8; g.beginPath(); g.arc(c, c, rSun, 0, 6.2832); g.stroke();
    runs(U, i0, i0, i1, (k) => Math.round(8 * ser.lit[k]), (v, a0, a1, ccw) => { g.strokeStyle = 'rgba(255,209,102,' + (v / 8).toFixed(3) + ')'; g.beginPath(); g.arc(c, c, rSun, a0, a1, ccw); g.stroke(); });
    g.lineWidth = 2; g.strokeStyle = C.earth; runs(U, i0, i0, i1, (k) => ser.comm[k], (v, a0, a1, ccw) => { g.beginPath(); g.arc(c, c, rEarth, a0, a1, ccw); g.stroke(); });
    runs(U, i0, i0, mEnd, (k) => state[k - i0] || 0, (v, a0, a1, ccw) => { g.lineWidth = v === 3 ? 1.5 : 3; g.strokeStyle = stateCol[v]; g.beginPath(); g.arc(c, c, rState, a0, a1, ccw); g.stroke(); });
    const az = ser.sunAz[i0] * D2R; g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(c + Math.sin(az) * (rEarth - 3), c - Math.cos(az) * (rEarth - 3)); g.lineTo(c + Math.sin(az) * (S / 2), c - Math.cos(az) * (S / 2)); g.stroke();
  };

  NAV.Ring = Ring;
})();
