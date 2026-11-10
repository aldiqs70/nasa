/* Site file: a 24 km analysis map around the selected site, computed from the LOLA relief crop and the
   2027 sunlight / Earth-visibility grids in data/sites/<id>.bin (scripts/make_sites.js). */
(function () {
  const NAV = window.NAV, D2R = Math.PI / 180;
  const ZONE = { slope: 10, lit: 40, earth: 40 };
  const SLOPE_CLASSES = [[5, '#F3ECD6'], [10, '#E2C283'], [15, '#CB8C4C'], [25, '#9B4F2F'], [90, '#531F18']];
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const SUN = [hex('#12110F'), hex('#FFD166'), hex('#FFF6DC')], EARTH = [hex('#0F1114'), hex('#4E8FEA'), hex('#DCEBFF')];
  const ramp = (R, v) => (v < 0.65 ? mix(R[0], R[1], v / 0.65) : mix(R[1], R[2], (v - 0.65) / 0.35));

  function SiteFile(cv) { this.cv = cv; this.ctx = cv.getContext('2d'); this.cache = {}; this.off = document.createElement('canvas'); this.size = 1; }
  SiteFile.ZONE = ZONE; SiteFile.SLOPE_CLASSES = SLOPE_CLASSES;
  SiteFile.rampCss = (name) => { const R = name === 'sun' ? SUN : EARTH, c = (v) => 'rgb(' + ramp(R, v).map(Math.round).join(',') + ')'; return 'linear-gradient(to right,' + [0, 0.2, 0.4, 0.65, 0.85, 1].map((v) => c(v) + ' ' + v * 100 + '%').join(',') + ')'; };

  SiteFile.prototype.load = async function (site) {
    if (this.cache[site.id]) return this.cache[site.id];
    const { reliefN: N, gridN: G, reliefRes: res } = NAV.data.crop, buf = await NAV.getBin('data/sites/' + site.id + '.bin');
    const h = new Int16Array(buf, 0, N * N), lit = new Uint8Array(buf, N * N * 2, G * G), ear = new Uint8Array(buf, N * N * 2 + G * G, G * G);
    const shade = new Float32Array(N * N), slope = new Float32Array(N * N);
    const lx = -0.58, ly = 0.58, lz = 0.57, z = 2.2;                       // light from the upper left of the map
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, cl = Math.max(0, c - 1), cr = Math.min(N - 1, c + 1), ru = Math.max(0, r - 1), rd = Math.min(N - 1, r + 1);
      const gx = (h[r * N + cr] - h[r * N + cl]) / ((cr - cl) * res), gy = (h[ru * N + c] - h[rd * N + c]) / ((rd - ru) * res);
      slope[i] = Math.atan(Math.hypot(gx, gy)) / D2R;
      const nx = -gx * z, ny = -gy * z, nn = Math.hypot(nx, ny, 1);
      shade[i] = Math.pow(Math.max(0, Math.min(1, ((nx * lx + ny * ly + lz) / nn - 0.22) / 0.62)), 0.9);
    }
    const grid = (arr, r, c) => {                                          // bilinear sample of a G x G layer at relief pixel (r, c), 0..1
      const fy = (r + 0.5) * G / N - 0.5, fx = (c + 0.5) * G / N - 0.5, j = Math.max(0, Math.min(G - 2, Math.floor(fy))), i = Math.max(0, Math.min(G - 2, Math.floor(fx)));
      const wy = Math.max(0, Math.min(1, fy - j)), wx = Math.max(0, Math.min(1, fx - i)), a = j * G + i;
      return ((arr[a] * (1 - wx) + arr[a + 1] * wx) * (1 - wy) + (arr[a + G] * (1 - wx) + arr[a + G + 1] * wx) * wy) / 200;
    };
    const litF = new Float32Array(N * N), earF = new Float32Array(N * N), zone = new Uint8Array(N * N);
    let area = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c; litF[i] = grid(lit, r, c); earF[i] = grid(ear, r, c);
      let sm = 0, k = 0;                                                   // slope over a 240 m patch
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N) { sm = Math.max(sm, slope[rr * N + cc]); k++; } }
      if (sm <= ZONE.slope && litF[i] * 100 >= ZONE.lit && earF[i] * 100 >= ZONE.earth) { zone[i] = 1; area++; }
    }
    return (this.cache[site.id] = { N, shade, slope, litF, earF, zone, areaKm2: area * res * res / 1e6 });
  };

  SiteFile.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.max(1, r.width); this.dpr = dpr; this.cv.width = this.cv.height = Math.round(this.size * dpr);
  };

  SiteFile.prototype.draw = function (site, layer) {
    const d = this.cache[site.id], g = this.ctx, S = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    if (!d) return;
    const N = d.N, off = this.off; off.width = off.height = N;
    const og = off.getContext('2d'), im = og.createImageData(N, N), px = im.data;
    for (let i = 0; i < N * N; i++) {
      const sh = d.shade[i]; let c;
      if (layer === 'slope') { let k = 0; while (d.slope[i] > SLOPE_CLASSES[k][0]) k++; const m = 0.5 + 0.5 * sh; c = hex(SLOPE_CLASSES[k][1]).map((v) => v * m); }
      else if (layer === 'sun') { const m = 0.62 + 0.38 * sh; c = ramp(SUN, d.litF[i]).map((v) => v * m); }
      else if (layer === 'earth') { const m = 0.62 + 0.38 * sh; c = ramp(EARTH, d.earF[i]).map((v) => v * m); }
      else {
        const r = (i / N) | 0, col = i % N, z = d.zone[i];
        const edge = z && (!d.zone[i - 1] || !d.zone[i + 1] || !d.zone[i - N] || !d.zone[i + N] || col === 0 || col === N - 1 || r === 0 || r === N - 1);
        const v = 255 * (0.08 + 0.92 * sh);
        c = edge ? [255, 209, 102] : z ? [v * 0.98 + 14, v * 0.93 + 10, v * 0.76] : [v * 0.5, v * 0.5, v * 0.49];
      }
      const o = i * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    og.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(off, 0, 0, S, S);

    const km = S / 24, ar = NAV.lang === 'ar', fam = ar ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif';
    // 4 km grid
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1; g.beginPath();
    for (let k = 4; k < 24; k += 4) { const p = Math.round(k * km) + 0.5; g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); }
    g.stroke();
    // the site
    const c = S / 2; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)';
    for (const pass of [0, 1]) {
      if (pass) { g.lineWidth = 1.5; g.strokeStyle = '#fff'; }
      g.beginPath(); g.arc(c, c, 7, 0, 6.2832); g.moveTo(c - 15, c); g.lineTo(c - 7, c); g.moveTo(c + 7, c); g.lineTo(c + 15, c); g.moveTo(c, c - 15); g.lineTo(c, c - 7); g.moveTo(c, c + 7); g.lineTo(c, c + 15); g.stroke();
    }
    const text = (t, x, y, align, wt) => { g.font = (wt || 600) + ' 11px ' + fam; g.textAlign = align; g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, x, y); g.fillStyle = '#fff'; g.fillText(t, x, y); };
    g.textBaseline = 'middle'; g.direction = ar ? 'rtl' : 'ltr';
    text(NAV.T('site_mark'), c + 20, c - 14, 'left');
    // scale bar
    g.direction = 'ltr'; const bar = 5 * km, bx = 14, by = S - 16;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(bx - 1, by - 5, bar + 2, 8);
    g.fillStyle = '#fff'; g.fillRect(bx, by, bar, 2); g.fillRect(bx, by - 4, 1, 6); g.fillRect(bx + bar - 1, by - 4, 1, 6);
    g.textBaseline = 'bottom'; text('5 km', bx + 4, by - 5, 'left');
    // north arrow: north is directly away from the pole
    const t = site.lon * D2R, nx = Math.sin(t), ny = -Math.cos(t), ax = S - 34, ay = 36, L = 16;
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)';
    for (const pass of [0, 1]) {
      if (pass) { g.lineWidth = 1.5; g.strokeStyle = '#fff'; }
      g.beginPath(); g.moveTo(ax - nx * L, ay - ny * L); g.lineTo(ax + nx * L, ay + ny * L);
      g.moveTo(ax + nx * L, ay + ny * L); g.lineTo(ax + nx * (L - 7) - ny * 4.5, ay + ny * (L - 7) + nx * 4.5);
      g.moveTo(ax + nx * L, ay + ny * L); g.lineTo(ax + nx * (L - 7) + ny * 4.5, ay + ny * (L - 7) - nx * 4.5); g.stroke();
    }
    g.textBaseline = 'middle'; text('N', ax + nx * (L + 10), ay + ny * (L + 10), 'center');
  };

  NAV.SiteFile = SiteFile;
})();
