/* The sky from the landing site: full horizon panorama.
   Ridgelines are the computed terrain horizon in four distance bands (far drawn first). The Sun and the
   Earth are drawn before the terrain, so the terrain hides them exactly where the geometry says it does.
   Terrain brightness is illustrative (faces away from the Sun are bright, faces toward it are silhouettes). */
(function () {
  const NAV = window.NAV, D2R = Math.PI / 180;
  const ALT_MIN = -6, ALT_MAX = 13;
  const BAND_LIGHT = [1.0, 0.93, 0.84, 0.74];        // near .. far
  const BAND_SHADOW = [0.9, 0.75, 0.4, 0.0];         // how much a band darkens when the site itself is in shadow
  const wrap = (d) => ((d % 360) + 540) % 360 - 180;

  function Sky(cv, onTurn) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.center = 0; this.w = 0; this.h = 0; this.onTurn = onTurn;
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, c: this.center }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; this.center = (drag.c - (e.clientX - drag.x) / (this.w / this.fov()) + 360) % 360; this.onTurn(); });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      this.center = (this.center + (e.key === 'ArrowLeft' ? -10 : 10) + 360) % 360; e.preventDefault(); this.onTurn();
    });
  }
  Sky.prototype.fov = function () { return this.w >= 880 ? 360 : this.w >= 560 ? 220 : 130; };
  Sky.prototype.stretch = function () { return (this.h / (ALT_MAX - ALT_MIN)) / (this.w / this.fov()); };
  Sky.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
  };

  Sky.prototype.draw = function (site, f) {
    const g = this.ctx, W = this.w, H = this.h, fov = this.fov(), ppd = W / fov, ppv = H / (ALT_MAX - ALT_MIN), c = this.center;
    const X = (az) => W / 2 + wrap(az - c) * ppd, Y = (alt) => H - (alt - ALT_MIN) * ppv, azAt = (x) => c + (x - W / 2) / ppd;
    const a = NAV.at(site, f), ser = site.ser, ar = NAV.lang === 'ar';
    const font = (px, wt) => (wt || 500) + ' ' + px + 'px ' + (ar ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif');
    const copies = (x, r) => (fov === 360 ? (x < r ? [x, x + W] : x > W - r ? [x, x - W] : [x]) : [x]);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);

    // elevation lines
    g.lineWidth = 1; g.font = font(11); g.textBaseline = 'bottom'; g.textAlign = 'left'; g.direction = 'ltr';
    for (const alt of [0, 5, 10]) {
      const y = Math.round(Y(alt)) + 0.5;
      g.strokeStyle = alt === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
      g.setLineDash(alt === 0 ? [2, 5] : []); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.setLineDash([]);

    // Earth's path over the next 28 days
    g.strokeStyle = 'rgba(111,174,255,0.55)'; g.lineWidth = 1; g.beginPath();
    let px = null;
    for (let k = a.i, end = Math.min(ser.n - 1, a.i + 28 * 24); k <= end; k += 2) {
      const x = X(ser.earthAz[k]), y = Y(ser.earthAlt[k]);
      if (px === null || Math.abs(x - px) > W / 2) g.moveTo(x, y); else g.lineTo(x, y);
      px = x;
    }
    g.stroke();

    // the Sun's path over the next 30 days: a dot every 3 hours, a mark at each UTC midnight
    const sunCol = 'rgba(255,209,102,';
    const marks = [];
    for (let k = a.i + 1, end = Math.min(ser.n - 1, a.i + 30 * 24); k <= end; k++) {
      const midnight = k % 24 === 0;
      if (k % 3 && !midnight) continue;
      const x = X(ser.sunAz[k]), y = Y(ser.sunAlt[k]);
      g.fillStyle = sunCol + (midnight ? '0.9)' : '0.42)');
      g.beginPath(); g.arc(x, y, midnight ? 2 : 1, 0, 6.2832); g.fill();
      const day = Math.round((k - f) / 24);
      if (midnight && day > 0 && day % 5 === 0 && day < 30) marks.push({ x, y, day });
    }

    // Sun
    const sx = X(a.sunAz), sy = Y(a.sunAlt), sr = Math.max(3.5, a.sunR * ppv);
    g.globalCompositeOperation = 'lighter';
    for (const x of copies(sx, sr * 20)) {
      const gl = g.createRadialGradient(x, sy, 0, x, sy, sr * 20);
      gl.addColorStop(0, 'rgba(255,226,160,0.85)'); gl.addColorStop(0.08, 'rgba(255,209,102,0.45)'); gl.addColorStop(0.3, 'rgba(255,190,90,0.12)'); gl.addColorStop(1, 'rgba(255,190,90,0)');
      g.fillStyle = gl; g.fillRect(x - sr * 20, sy - sr * 20, sr * 40, sr * 40);
    }
    g.globalCompositeOperation = 'source-over';
    for (const x of copies(sx, sr)) { g.fillStyle = '#FFF8E6'; g.beginPath(); g.arc(x, sy, sr, 0, 6.2832); g.fill(); }

    // Earth with its phase (lit limb faces the Sun)
    const ex = X(a.earthAz), ey = Y(a.earthAlt), er = a.earthR * ppv;
    const dAz = wrap(a.sunAz - a.earthAz), cosEl = Math.sin(a.sunAlt * D2R) * Math.sin(a.earthAlt * D2R) + Math.cos(a.sunAlt * D2R) * Math.cos(a.earthAlt * D2R) * Math.cos(dAz * D2R);
    const kLit = (1 - cosEl) / 2, ang = Math.atan2(-(a.sunAlt - a.earthAlt), dAz * Math.cos(a.earthAlt * D2R));
    for (const x of copies(ex, er * 2.4)) {
      const halo = g.createRadialGradient(x, ey, er * 0.9, x, ey, er * 2.4);
      halo.addColorStop(0, 'rgba(111,174,255,' + (0.10 + 0.22 * kLit) + ')'); halo.addColorStop(1, 'rgba(111,174,255,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(x, ey, er * 2.4, 0, 6.2832); g.fill();
      g.save(); g.translate(x, ey); g.rotate(ang);
      g.fillStyle = '#0C1A33'; g.beginPath(); g.arc(0, 0, er, 0, 6.2832); g.fill();
      const day = g.createRadialGradient(er * 0.45, 0, er * 0.1, 0, 0, er);
      day.addColorStop(0, '#E4EFFF'); day.addColorStop(0.55, '#79B0FF'); day.addColorStop(1, '#2F66C8');
      g.fillStyle = day; g.beginPath(); g.arc(0, 0, er, -Math.PI / 2, Math.PI / 2); g.fill();
      const rx = Math.max(0.01, er * Math.abs(2 * kLit - 1));
      g.fillStyle = kLit > 0.5 ? day : '#0C1A33'; g.beginPath(); g.ellipse(0, 0, rx, er, 0, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(111,174,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, er, 0, 6.2832); g.stroke();
      g.restore();
    }

    // terrain, far band first
    const lit = a.lit, n = Math.ceil(W) + 1, ys = new Float32Array(n);
    if (!this.grain) {
      const t = document.createElement('canvas'); t.width = t.height = 192; const tg = t.getContext('2d'), d = tg.createImageData(192, 192);
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 192 * 192; i++) { const v = Math.round(255 * (0.5 + (rnd() - 0.5) * 0.9 * (rnd() < 0.08 ? 1 : 0.5))); d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
      tg.putImageData(d, 0, 0); this.grain = g.createPattern(t, 'repeat');
    }
    for (let b = site.bands.length - 1; b >= 0; b--) {
      const shade = BAND_LIGHT[b] * (1 - BAND_SHADOW[b] * (1 - lit));
      const grad = g.createLinearGradient(0, 0, W, 0);
      for (let s = 0; s <= 36; s++) {
        const front = (1 - Math.cos((azAt(s * W / 36) - a.sunAz) * D2R)) / 2, I = shade * (0.03 + 0.97 * Math.pow(front, 1.6));
        grad.addColorStop(s / 36, 'rgb(' + Math.round(6 + 206 * I) + ',' + Math.round(6 + 200 * I) + ',' + Math.round(5 + 188 * I) + ')');
      }
      let top = H;
      for (let x = 0; x < n; x++) { ys[x] = Y(site.bandAt(b, azAt(x))); if (ys[x] < top) top = ys[x]; }
      g.save();
      g.beginPath(); g.moveTo(0, H + 2); for (let x = 0; x < n; x++) g.lineTo(x, ys[x]); g.lineTo(W, H + 2); g.closePath();
      g.fillStyle = grad; g.fill(); g.clip();
      const fall = g.createLinearGradient(0, Math.max(0, top), 0, H);                  // slopes fall away into shadow
      fall.addColorStop(0, 'rgba(0,0,0,0)'); fall.addColorStop(0.5, 'rgba(0,0,0,' + (0.22 + 0.1 * b) + ')'); fall.addColorStop(1, 'rgba(0,0,0,0.78)');
      g.fillStyle = fall; g.fillRect(0, Math.max(0, top), W, H);
      g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.5; g.fillStyle = this.grain; g.fillRect(0, Math.max(0, top), W, H);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.restore();
      g.beginPath(); for (let x = 0; x < n; x++) { if (x) g.lineTo(x, ys[x]); else g.moveTo(x, ys[x]); }
      g.strokeStyle = 'rgba(255,255,255,' + (0.08 + 0.16 * shade) + ')'; g.lineWidth = 1; g.stroke();
    }
    const fade = g.createLinearGradient(0, H - 46, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = fade; g.fillRect(0, H - 46, W, 46);
    g.font = font(11); g.textBaseline = 'bottom'; g.textAlign = 'left'; g.lineJoin = 'round';
    for (const alt of [0, 5, 10]) {
      const y = Math.round(Y(alt)) + 0.5, t = (alt > 0 ? '+' : '') + alt + '°';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(t, 8, y - 3); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(t, 8, y - 3);
    }

    // glare spilling over the ridge while part of the disc shows
    if (lit > 0) {
      g.globalCompositeOperation = 'lighter';
      for (const x of copies(sx, sr * 26)) {
        const gl = g.createRadialGradient(x, sy, 0, x, sy, sr * 26);
        gl.addColorStop(0, 'rgba(255,214,130,' + 0.34 * lit + ')'); gl.addColorStop(1, 'rgba(255,214,130,0)');
        g.fillStyle = gl; g.fillRect(x - sr * 26, sy - sr * 26, sr * 52, sr * 52);
      }
      g.globalCompositeOperation = 'source-over';
    }

    // where a hidden body sits behind the terrain
    g.lineWidth = 1.2; g.setLineDash([3, 3]);
    if (lit <= 0) for (const x of copies(sx, sr + 3)) { g.strokeStyle = 'rgba(255,209,102,0.9)'; g.beginPath(); g.arc(x, sy, sr + 2, 0, 6.2832); g.stroke(); }
    if (!a.comm) for (const x of copies(ex, er)) { g.strokeStyle = 'rgba(111,174,255,0.9)'; g.beginPath(); g.arc(x, ey, er, 0, 6.2832); g.stroke(); }
    g.setLineDash([]);

    // day marks on the Sun's path
    g.font = font(11); g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (const m of marks) {
      if (Math.abs(m.x - sx) < 70 || Math.abs(m.x - ex) < 70) continue;
      const top = Math.min(m.y, Y(site.hf(azAt(m.x)))) - 8;
      g.fillStyle = 'rgba(255,209,102,0.85)'; g.fillText('+' + m.day + ' ' + NAV.T('d'), m.x, top);
    }

    // labels
    g.font = font(12, 600); g.direction = ar ? 'rtl' : 'ltr';
    const label = (x, yObj, r, hz, text, col) => {
      const top = Math.min(yObj - r, Y(hz)) - 10, tw = g.measureText(text).width, tx = Math.max(tw / 2 + 6, Math.min(W - tw / 2 - 6, x));
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, top + 3); g.lineTo(x, Math.min(yObj - r, Y(hz)) - 2); g.stroke();
      g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(text, tx, top); g.fillStyle = col; g.fillText(text, tx, top);
    };
    const deg = (v) => '⁦' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°⁩';
    label(sx, sy, sr, a.hSun, NAV.T('lbl_sun') + (lit > 0 ? ' ' + deg(a.sunAlt) : ', ' + NAV.T('lbl_hidden')), '#FFD166');
    label(ex, ey, er, a.hEarth, NAV.T('lbl_earth') + (a.comm ? ' ' + deg(a.earthAlt) : ', ' + NAV.T('lbl_hidden')), '#8FC0FF');

    // azimuth scale
    g.direction = 'ltr'; g.font = font(11); g.textBaseline = 'bottom'; g.textAlign = 'center';
    const every = fov === 360 && W < 1100 ? 45 : 30, card = { 0: 'N', 90: 'E', 180: 'Sth', 270: 'Wst' };
    for (let az = Math.ceil(azAt(0) / 5) * 5; az <= azAt(W); az += 5) {
      const x = W / 2 + (az - c) * ppd, m = ((az % 360) + 360) % 360, major = m % every === 0;
      g.fillStyle = 'rgba(255,255,255,' + (major ? 0.7 : 0.3) + ')'; g.fillRect(Math.round(x), H - (major ? 7 : 4), 1, major ? 7 : 4);
      if (major) g.fillText(card[m] ? NAV.T(card[m]) + ' ' + m + '°' : m + '°', x, H - 9);
    }
  };

  NAV.Sky = Sky;
})();
