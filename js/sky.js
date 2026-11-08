/*
 * Natural-looking Sun, Earth and Moon drawn on a 2D canvas.
 *  - Spheres are ray-cast per pixel from an equirectangular texture (NASA Blue Marble / LRO Moon map)
 *    and lit with a real light direction, so phases and terminators come out right.
 *  - The Sun is a layered gradient with limb darkening, granulation and a soft corona.
 */
(function (root) {
  const D2R = Math.PI / 180;
  const cache = new Map();

  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + url)); im.src = url; });
  }
  async function texture(url, w) {
    if (cache.has(url)) return cache.get(url);
    const p = loadImage(url).then((im) => {
      w = w || im.width; const h = Math.round(w * im.height / im.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, w, h);
      return { w, h, data: g.getImageData(0, 0, w, h).data };
    });
    cache.set(url, p);
    return p;
  }

  const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // Basis for a decorative view: rotation (deg, sub-viewer longitude) and tilt (deg, sub-viewer latitude)
  function basisFromAngles(rotDeg, tiltDeg) {
    const r = rotDeg * D2R, t = tiltDeg * D2R;
    const F = [Math.cos(r) * Math.cos(t), Math.sin(r) * Math.cos(t), Math.sin(t)];
    const U = [-Math.cos(r) * Math.sin(t), -Math.sin(r) * Math.sin(t), Math.cos(t)];
    return { F, U, R: cross(U, F) };
  }
  // Basis from a viewing direction F (body frame, unit vector from the body toward the viewer) and an "up" hint
  function basisFromView(F, upHint) {
    F = norm(F); let U = upHint || [0, 0, 1];
    const k = dot(U, F); U = norm([U[0] - k * F[0], U[1] - k * F[1], U[2] - k * F[2]]);
    return { F, U, R: cross(U, F) };
  }

  /*
   * Draw a textured sphere.
   * opts.basis : {R,U,F} in body coordinates (screen right / up / toward viewer)
   * opts.light : light direction in body coordinates (unit, toward the light), or opts.lightView in screen coords
   * opts.kind  : 'moon' | 'earth'
   */
  function sphere(ctx, cx, cy, rad, tex, opts) {
    const size = Math.max(2, Math.ceil(rad * 2));
    const B = opts.basis;
    let L = opts.lightView;
    if (!L && opts.light) { const l = norm(opts.light); L = [dot(l, B.R), dot(l, B.U), dot(l, B.F)]; }
    L = norm(L || [0.6, 0.3, 0.75]);
    const img = ctx.createImageData(size, size), px = img.data;
    const tw = tex.w, th = tex.h, td = tex.data;
    const earth = opts.kind === 'earth';
    const amb = opts.ambient != null ? opts.ambient : (earth ? 0.035 : 0.025);
    for (let j = 0; j < size; j++) {
      const sy = 1 - (j + 0.5) / rad;
      for (let i = 0; i < size; i++) {
        const sx = (i + 0.5) / rad - 1, rr = sx * sx + sy * sy;
        if (rr > 1) continue;
        const sz = Math.sqrt(1 - rr);
        const nx = sx * B.R[0] + sy * B.U[0] + sz * B.F[0];
        const ny = sx * B.R[1] + sy * B.U[1] + sz * B.F[1];
        const nz = sx * B.R[2] + sy * B.U[2] + sz * B.F[2];
        const lat = Math.asin(Math.max(-1, Math.min(1, nz))), lon = Math.atan2(ny, nx);
        const u = Math.min(tw - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * tw)));
        const v = Math.min(th - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * th)));
        const o = (v * tw + u) * 4;
        let d = sx * L[0] + sy * L[1] + sz * L[2];
        let I;
        if (earth) {
          const s = Math.max(0, Math.min(1, (d + 0.08) / 0.28));
          I = amb + (1 - amb) * s * s * (3 - 2 * s) * Math.max(0.15, d + 0.1);
        } else {
          I = amb + (1 - amb) * Math.pow(Math.max(0, d), 0.8) * 1.12;
        }
        const limb = earth ? 1 : 0.88 + 0.12 * sz;          // gentle limb darkening for the Moon
        let r = td[o] * I * limb, g = td[o + 1] * I * limb, b = td[o + 2] * I * limb;
        if (earth) {                                           // thin blue atmosphere at the limb on the day side
          const rim = Math.pow(1 - sz, 3) * Math.max(0, d + 0.15);
          r += 60 * rim; g += 120 * rim; b += 230 * rim;
          if (d < -0.05) { b += 6; g += 2; }                  // faint night-side blue
        }
        const q = (j * size + i) * 4, edge = Math.max(0, Math.min(1, (1 - Math.sqrt(rr)) * rad + 0.5));
        px[q] = r; px[q + 1] = g; px[q + 2] = b; px[q + 3] = 255 * edge;
      }
    }
    const off = sphere._off || (sphere._off = document.createElement('canvas'));
    off.width = size; off.height = size; off.getContext('2d').putImageData(img, 0, 0);
    if (earth && opts.glow !== false) {
      const gr = ctx.createRadialGradient(cx, cy, rad * 0.95, cx, cy, rad * 1.18);
      gr.addColorStop(0, 'rgba(110,170,255,0.35)'); gr.addColorStop(1, 'rgba(110,170,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.2, 0, 7); ctx.fill();
    }
    ctx.drawImage(off, cx - rad, cy - rad, size, size);
    return L;
  }

  // ---------------------------------------------------------------- Sun
  let gran = null;
  function granulation() {
    if (gran) return gran;
    const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), im = g.createImageData(n, n);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < n * n; k++) { const v = 200 + rnd() * 55; im.data[4 * k] = v; im.data[4 * k + 1] = v * 0.78; im.data[4 * k + 2] = v * 0.35; im.data[4 * k + 3] = 30 + rnd() * 40; }
    g.putImageData(im, 0, 0);
    // blur into cells
    const c2 = document.createElement('canvas'); c2.width = c2.height = n; const g2 = c2.getContext('2d');
    g2.filter = 'blur(1.6px)'; g2.drawImage(c, 0, 0); gran = c2; return gran;
  }
  function sun(ctx, cx, cy, rad, t) {
    t = t || 0;
    // corona / glow
    const halo = ctx.createRadialGradient(cx, cy, rad * 0.9, cx, cy, rad * 3.2);
    halo.addColorStop(0, 'rgba(255,196,110,0.55)'); halo.addColorStop(0.25, 'rgba(255,160,70,0.18)'); halo.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, rad * 3.2, 0, 7); ctx.fill();
    // faint rays
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.02);
    for (let k = 0; k < 18; k++) {
      ctx.rotate(Math.PI * 2 / 18);
      const len = rad * (1.6 + 0.35 * Math.sin(k * 2.3 + t * 0.3));
      const gr = ctx.createLinearGradient(rad, 0, len, 0); gr.addColorStop(0, 'rgba(255,200,120,0.06)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(rad * 0.95, -rad * 0.05); ctx.lineTo(len, 0); ctx.lineTo(rad * 0.95, rad * 0.05); ctx.fill();
    }
    ctx.restore();
    // photosphere with limb darkening
    const ph = ctx.createRadialGradient(cx - rad * 0.12, cy - rad * 0.12, rad * 0.05, cx, cy, rad);
    ph.addColorStop(0, '#fffbe8'); ph.addColorStop(0.45, '#ffe08a'); ph.addColorStop(0.8, '#f7a83e'); ph.addColorStop(1, '#d9711f');
    ctx.fillStyle = ph; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
    // granulation texture
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.clip();
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.55;
    const gt = granulation(); const s = rad * 2.2;
    ctx.drawImage(gt, cx - s / 2 + Math.sin(t * 0.05) * 4, cy - s / 2, s, s);
    ctx.restore();
  }

  // ---------------------------------------------------------------- star field
  function stars(canvas, opts) {
    opts = opts || {};
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = opts.W || canvas.clientWidth, H = opts.H || canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#120f17'); bg.addColorStop(0.55, '#1b1621'); bg.addColorStop(1, '#231a2a');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // purple nebula haze
    const neb = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(107,77,111,' + a + ')'); gr.addColorStop(1, 'rgba(107,77,111,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
    neb(W * 0.2, H * 0.85, W * 0.5, 0.35); neb(W * 0.85, H * 0.15, W * 0.35, 0.18); neb(W * 0.55, H * 0.55, W * 0.6, 0.12);
    let seed = opts.seed || 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = Math.round(W * H / (opts.density || 2600));
    for (let k = 0; k < n; k++) {
      const x = rnd() * W, y = rnd() * H, m = rnd(), r = m > 0.985 ? 1.4 : m > 0.9 ? 0.9 : 0.55;
      const a = 0.25 + rnd() * 0.7, tint = rnd();
      g.fillStyle = tint > 0.92 ? 'rgba(255,214,170,' + a + ')' : tint > 0.85 ? 'rgba(190,210,255,' + a + ')' : 'rgba(240,236,246,' + a + ')';
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    return g;
  }

  // Greenwich mean sidereal time (deg)
  function gmst(tMs) { const jd = tMs / 86400000 + 2440587.5; return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360 + 360) % 360; }

  root.Sky = { loadImage, texture, sphere, sun, stars, basisFromAngles, basisFromView, gmst, norm, dot, cross };
})(window);
