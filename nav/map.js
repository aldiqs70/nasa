/* Polar map, 150 km around the south pole (south polar stereographic, lon 0 = up, toward the Earth).
   Base: shaded relief from LOLA. Layers multiply the relief by long-term sunlight or Earth visibility
   from data/grid (1 km cells, 2026-2030), so brighter ground means more light. */
(function () {
  const NAV = window.NAV, HALF = 150000, R = 1737400, D2R = Math.PI / 180;
  const GRID = { n: 320, half: 160000 };

  function img(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(url)); im.src = url; }); }

  function Map(cv, pinsEl, onPick) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.pinsEl = pinsEl; this.onPick = onPick;
    this.base = document.createElement('canvas'); this.layers = null; this.relief = null; this.size = 0;
  }
  Map.prototype.load = async function () {
    const [relief, lit, earth, maxLit] = await Promise.all([img('img/pole_relief.jpg'), NAV.getBin('data/grid/lit.bin'), NAV.getBin('data/grid/earth.bin'), NAV.getBin('data/grid/maxlit.bin')]);
    this.relief = relief;
    const L = new Uint8Array(lit), E = new Uint8Array(earth), M = new Uint8Array(maxLit), n = GRID.n;
    const make = (fn) => { const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), d = g.createImageData(n, n); for (let i = 0; i < n * n; i++) fn(i, d.data, i * 4); g.putImageData(d, 0, 0); return c; };
    this.layers = {
      sunMul: make((i, d, o) => { const v = L[i] === 255 ? 0.5 : M[i] === 0 ? 0 : 0.10 + 0.90 * Math.pow(L[i] / 100, 0.75), c = Math.round(255 * v); d[o] = d[o + 1] = d[o + 2] = c; d[o + 3] = 255; }),
      sunTint: make((i, d, o) => { const v = L[i] === 255 ? 0 : Math.max(0, (L[i] - 45) / 55); d[o] = 255; d[o + 1] = 205; d[o + 2] = 96; d[o + 3] = Math.round(120 * Math.pow(v, 1.4)); }),
      earthMul: make((i, d, o) => { const v = E[i] === 255 ? 0.5 : 0.16 + 0.84 * E[i] / 100, c = Math.round(255 * v); d[o] = d[o + 1] = d[o + 2] = c; d[o + 3] = 255; }),
      earthTint: make((i, d, o) => { const v = E[i] === 255 ? 0 : E[i] / 100; d[o] = 70; d[o + 1] = 140; d[o + 2] = 255; d[o + 3] = Math.round(150 * v * v); }),
    };
  };
  Map.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.max(1, r.width); this.dpr = dpr;
    this.cv.width = this.cv.height = Math.round(this.size * dpr);
    this.base.width = this.base.height = this.cv.width; this.baseKey = null;
  };
  Map.prototype.xy = function (x, y) { return [(x + HALF) / (2 * HALF) * this.size, (HALF - y) / (2 * HALF) * this.size]; };

  Map.prototype.pins = function (sites, sel) {
    this.pinsEl.textContent = '';
    const S = this.size, placed = sites.map((s) => { const [x, y] = this.xy(s.x, s.y); return { x0: x - 8, x1: x + 8, y0: y - 8, y1: y + 8, pin: s }; }), hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const order = sites.map((s, i) => i).sort((a, b) => (a === sel ? -1 : b === sel ? 1 : 0));
    const sides = {};
    for (const i of order) {
      const s = sites[i], [x, y] = this.xy(s.x, s.y), w = NAV.siteName(s).length * 6.6 + 8, h = 16;
      const box = { r: { x0: x + 9, x1: x + 9 + w, y0: y - h / 2, y1: y + h / 2 }, l: { x0: x - 9 - w, x1: x - 9, y0: y - h / 2, y1: y + h / 2 }, t: { x0: x - w / 2, x1: x + w / 2, y0: y - 10 - h, y1: y - 10 }, b: { x0: x - w / 2, x1: x + w / 2, y0: y + 10, y1: y + 10 + h } };
      const side = (x > S * 0.6 ? ['l', 'r', 't', 'b'] : ['r', 'l', 't', 'b']).find((k) => box[k].x0 >= 2 && box[k].x1 <= S - 2 && box[k].y0 >= 2 && !placed.some((p) => p.pin !== s && hit(p, box[k]))) || (x > S * 0.6 ? 'l' : 'r');
      placed.push(box[side]); sides[i] = side;
    }
    sites.forEach((s, i) => {
      const b = document.createElement('button'), sp = document.createElement('span');
      b.type = 'button'; b.className = 'pin side-' + sides[i] + (i === sel ? ' on' : '');
      b.style.left = (s.x + HALF) / (2 * HALF) * 100 + '%'; b.style.top = (HALF - s.y) / (2 * HALF) * 100 + '%';
      b.setAttribute('aria-pressed', i === sel ? 'true' : 'false');
      sp.textContent = NAV.siteName(s); b.appendChild(sp);
      b.addEventListener('click', () => this.onPick(i));
      this.pinsEl.appendChild(b);
    });
  };

  Map.prototype.drawBase = function (layer) {
    const key = layer + ':' + NAV.lang + ':' + this.cv.width;
    if (this.baseKey === key || !this.relief) return;
    this.baseKey = key;
    const g = this.base.getContext('2d'), S = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.globalAlpha = layer === 'relief' ? 0.78 : 1; g.drawImage(this.relief, 0, 0, S, S); g.globalAlpha = 1;
    const k = GRID.n / (2 * GRID.half), s0 = (GRID.half - HALF) * k, sw = 2 * HALF * k;
    if (layer !== 'relief') {
      g.globalCompositeOperation = 'multiply'; g.drawImage(this.layers[layer + 'Mul'], s0, s0, sw, sw, 0, 0, S, S);
      g.globalCompositeOperation = 'screen'; g.drawImage(this.layers[layer + 'Tint'], s0, s0, sw, sw, 0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    // graticule
    const c = S / 2, km = S / (2 * HALF / 1000);
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1; g.font = '500 10.5px Archivo, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)';
    g.textAlign = 'left'; g.textBaseline = 'bottom'; g.direction = 'ltr';
    for (const lat of [-88, -86]) {
      const rho = 2 * R * Math.tan((90 + lat) * D2R / 2) / 1000 * km;
      g.beginPath(); g.arc(c, c, rho, 0, 6.2832); g.stroke();
      g.fillText(-lat + '°S', c + rho * Math.sin(200 * D2R) + 4, c - rho * Math.cos(200 * D2R) - 2);
    }
    for (let lon = 0; lon < 360; lon += 30) { g.beginPath(); g.moveTo(c + 6 * Math.sin(lon * D2R), c - 6 * Math.cos(lon * D2R)); g.lineTo(c + S * Math.sin(lon * D2R), c - S * Math.cos(lon * D2R)); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('0°', c + 12, 5);
    g.textBaseline = 'bottom'; g.fillText('180°', c + 16, S - 5);
    g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillText('90°E', S - 5, c - 9); g.textAlign = 'left'; g.fillText('90°W', 5, c - 9);
    // scale bar
    const bar = 50 * km, bx = 12, by = S - 14;
    g.fillStyle = '#fff'; g.fillRect(bx, by, bar, 2); g.fillRect(bx, by - 4, 1, 6); g.fillRect(bx + bar - 1, by - 4, 1, 6);
    g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('50 km', bx + 4, by - 3);
  };

  Map.prototype.draw = function (layer, site, a) {
    if (!this.relief) return;
    this.drawBase(layer);
    const g = this.ctx, S = this.size;
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [px, py] = this.xy(site.x, site.y), ar = NAV.lang === 'ar';
    g.font = '600 11px ' + (ar ? '"IBM Plex Sans Arabic", sans-serif' : 'Archivo, system-ui, sans-serif'); g.textBaseline = 'middle'; g.direction = ar ? 'rtl' : 'ltr';
    const ray = (az, col, dashed) => {
      const t = (site.lon + az) * D2R, dx = Math.sin(t), dy = -Math.cos(t), len = Math.max(40, S * 0.13);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.setLineDash([]); g.beginPath(); g.moveTo(px + dx * 9, py + dy * 9); g.lineTo(px + dx * len, py + dy * len); g.stroke();
      g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(dashed ? [4, 4] : []); g.beginPath(); g.moveTo(px + dx * 9, py + dy * 9); g.lineTo(px + dx * len, py + dy * len); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.beginPath(); g.arc(px + dx * len, py + dy * len, 3, 0, 6.2832); g.fill();
    };
    ray(a.earthAz, '#8FC0FF', !a.comm);
    ray(a.sunAz, '#FFD166', a.lit <= 0);
  };

  NAV.Map = Map;
})();
