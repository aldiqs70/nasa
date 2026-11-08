/*
 * Interactive 2D map of the lunar south pole (south polar stereographic, same grid as the data).
 * Base: shaded relief from LOLA. Layers are plain functions drawn in order.
 * Wheel / buttons to zoom, drag to pan, click to pick a point.
 */
(function (root) {
  const R = 1737400, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const ll2xy = (lat, lon) => { const rho = 2 * R * Math.tan((90 + lat) * D2R / 2); return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)]; };
  const xy2ll = (x, y) => { const rho = Math.hypot(x, y); return [2 * Math.atan(rho / (2 * R)) * R2D - 90, Math.atan2(x, y) * R2D]; };
  let shadeImg = null, shadePromise = null;
  function loadShade(url) {
    if (shadePromise) return shadePromise;
    shadePromise = new Promise((res) => { const im = new Image(); im.onload = () => { shadeImg = im; res(im); }; im.onerror = () => res(null); im.src = url; });
    return shadePromise;
  }

  class PolarMap {
    constructor(canvas, opts) {
      opts = opts || {};
      this.cv = canvas; this.half = (opts.halfKm || 160) * 1000; this.layers = [];
      this.cx = 0; this.cy = 0; this.scale = 1; this.minScale = 20; this.onClick = opts.onClick || null; this.onHover = opts.onHover || null;
      this.interactive = opts.interactive !== false;
      loadShade(opts.shade || 'img/pole_shade.jpg').then(() => this.render());
      this.resize(); this.fit();
      if (this.interactive) this._bind();
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { this.resize(); this.render(); }).observe(canvas);
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1); this.dpr = dpr;
      this.W = this.cv.clientWidth || 300; this.H = this.cv.clientHeight || this.W;
      this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
      if (!this._fitted) this.fit();
    }
    fit(halfM) { const h = halfM || this.half; this.cx = 0; this.cy = 0; this.scale = (2 * h) / Math.min(this.W, this.H); this._fitted = true; this.render(); }
    focus(x, y, halfM) { this.cx = x; this.cy = y; this.scale = (2 * (halfM || 30000)) / Math.min(this.W, this.H); this.render(); }
    toPx(x, y) { return [this.W / 2 + (x - this.cx) / this.scale, this.H / 2 - (y - this.cy) / this.scale]; }
    fromPx(px, py) { return [this.cx + (px - this.W / 2) * this.scale, this.cy - (py - this.H / 2) * this.scale]; }
    llPx(lat, lon) { const [x, y] = ll2xy(lat, lon); return this.toPx(x, y); }
    zoom(f, px, py) {
      if (px == null) { px = this.W / 2; py = this.H / 2; }
      const [x, y] = this.fromPx(px, py);
      this.scale = Math.min(Math.max(this.scale * f, this.minScale), (2.4 * this.half) / Math.min(this.W, this.H));
      this.cx = x - (px - this.W / 2) * this.scale; this.cy = y + (py - this.H / 2) * this.scale;
      this.render();
    }
    add(layer) { this.layers.push(layer); this.render(); return layer; }
    render() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
    }
    _draw() {
      const g = this.cv.getContext('2d'); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = '#100d14'; g.fillRect(0, 0, this.W, this.H);
      if (shadeImg) {
        const [x0, y0] = this.toPx(-this.half, this.half), [x1, y1] = this.toPx(this.half, -this.half);
        g.imageSmoothingEnabled = true; g.drawImage(shadeImg, x0, y0, x1 - x0, y1 - y0);
      }
      for (const L of this.layers) if (L.visible !== false) { g.save(); try { L.draw(g, this); } catch (e) { console.warn(e); } g.restore(); }
    }
    _bind() {
      const cv = this.cv; let drag = null, moved = false;
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy }; moved = false; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
          if (moved) { this.cx = drag.cx - dx * this.scale; this.cy = drag.cy + dy * this.scale; this.render(); }
        }
        if (this.onHover) { const [x, y] = this.fromPx(px, py), [lat, lon] = xy2ll(x, y); this.onHover({ x, y, lat, lon, px, py, inside: Math.abs(x) < this.half && Math.abs(y) < this.half }); }
      });
      cv.addEventListener('pointerup', (e) => {
        const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        if (drag && !moved && this.onClick) { const [x, y] = this.fromPx(px, py), [lat, lon] = xy2ll(x, y); this.onClick({ x, y, lat, lon, px, py }); }
        drag = null;
      });
      cv.addEventListener('pointerleave', () => { if (this.onHover) this.onHover(null); });
    }
  }

  // ---------------- layer helpers ----------------
  // raster: grid {nx, ny, res, xmin, ymax}, values array, colour(v) -> [r,g,b,a] | null
  PolarMap.raster = function (grid, values, colour, alpha) {
    const c = document.createElement('canvas'); c.width = grid.nx; c.height = grid.ny;
    const g = c.getContext('2d'), im = g.createImageData(grid.nx, grid.ny);
    for (let k = 0; k < values.length; k++) { const col = colour(values[k], k); if (!col) continue; im.data[4 * k] = col[0]; im.data[4 * k + 1] = col[1]; im.data[4 * k + 2] = col[2]; im.data[4 * k + 3] = col[3]; }
    g.putImageData(im, 0, 0);
    return {
      alpha: alpha == null ? 1 : alpha, visible: true, canvas: c,
      draw(gc, map) {
        const [x0, y0] = map.toPx(grid.xmin, grid.ymax), [x1, y1] = map.toPx(grid.xmin + grid.nx * grid.res, grid.ymax - grid.ny * grid.res);
        gc.globalAlpha = this.alpha; gc.imageSmoothingEnabled = (x1 - x0) / grid.nx < 6; gc.drawImage(c, x0, y0, x1 - x0, y1 - y0);
      },
    };
  };
  // latitude rings and meridians
  PolarMap.graticule = function () {
    return {
      visible: true,
      draw(g, map) {
        g.strokeStyle = 'rgba(239,233,243,0.16)'; g.lineWidth = 1; g.fillStyle = 'rgba(239,233,243,0.55)'; g.font = '11px "Space Grotesk", Arial';
        const [ox, oy] = map.toPx(0, 0);
        for (const lat of [-89, -88, -87, -86, -85, -84]) {
          const rho = 2 * R * Math.tan((90 + lat) * D2R / 2) / map.scale;
          g.beginPath(); g.arc(ox, oy, rho, 0, 7); g.stroke();
          g.fillText(lat + '°', ox + 4, oy - rho - 3);
        }
        for (let lon = 0; lon < 360; lon += 30) {
          const [x, y] = ll2xy(-83.6, lon), [px, py] = map.toPx(x, y);
          g.beginPath(); g.moveTo(ox, oy); g.lineTo(px, py); g.stroke();
          const [lx, ly] = map.toPx(x * 0.93, y * 0.93); const L = lon > 180 ? lon - 360 : lon;
          g.fillText((L === 0 ? '0°' : Math.abs(L) + '°' + (L > 0 ? 'E' : 'W')), lx - 12, ly);
        }
        g.fillStyle = '#ff8f7a'; g.beginPath(); g.arc(ox, oy, 3.5, 0, 7); g.fill();
      },
    };
  };
  // markers: [{lat, lon, label, color, r, ring, num}]
  PolarMap.markers = function (getList) {
    return {
      visible: true,
      draw(g, map) {
        const list = typeof getList === 'function' ? getList() : getList;
        g.font = '600 12px "IBM Plex Sans Arabic", "Space Grotesk", Arial'; g.textAlign = 'center';
        for (const m of list || []) {
          const [px, py] = map.llPx(m.lat, m.lon); if (px < -20 || py < -20 || px > map.W + 20 || py > map.H + 20) continue;
          const r = m.r || 6;
          if (m.halo) { g.fillStyle = m.halo; g.beginPath(); g.arc(px, py, r * 2.4, 0, 7); g.fill(); }
          g.fillStyle = m.color || '#d6a451'; g.strokeStyle = m.stroke || '#120f17'; g.lineWidth = 2;
          g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.stroke();
          if (m.num != null) { g.fillStyle = m.numColor || '#1d1408'; g.font = '700 11px "Space Grotesk", Arial'; g.fillText(String(m.num), px, py + 4); g.font = '600 12px "IBM Plex Sans Arabic", "Space Grotesk", Arial'; }
          if (m.label) {
            g.lineWidth = 3.5; g.strokeStyle = 'rgba(16,13,20,0.85)'; g.strokeText(m.label, px, py - r - 6);
            g.fillStyle = m.labelColor || '#efe9f3'; g.fillText(m.label, px, py - r - 6);
          }
        }
      },
    };
  };
  // ice-bearing PSR outlines (data/ice/psr_ice.json)
  PolarMap.psr = function (ice, opts) {
    opts = opts || {};
    return {
      visible: true, highlight: -1, minM3: 1,
      draw(g, map) {
        const maxM3 = 134;
        ice.psr.forEach((p, i) => {
          if (p.m3 < this.minM3) return;
          const a = 0.35 + 0.5 * Math.min(1, Math.log(1 + p.m3) / Math.log(1 + maxM3));
          const fill = 'rgba(127,195,255,' + (a * 0.55).toFixed(3) + ')', stroke = i === this.highlight ? '#ffffff' : 'rgba(170,215,255,' + a.toFixed(3) + ')';
          g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = i === this.highlight ? 2.5 : 1;
          if (!p.rings20.length) {
            const [px, py] = map.toPx(p.x, p.y), rr = Math.max(3, Math.sqrt(p.area_km2 * 1e6 / Math.PI) / map.scale);
            g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill(); g.stroke(); return;
          }
          g.beginPath();
          for (const r of p.rings20) {
            for (let k = 0; k < r.length; k += 2) { const [px, py] = map.toPx(r[k] * 20, r[k + 1] * 20); k ? g.lineTo(px, py) : g.moveTo(px, py); }
            g.closePath();
          }
          g.fill('evenodd'); g.stroke();
          if (opts.labels && p.name && p.m3 >= 5) {
            const [px, py] = map.toPx(p.x, p.y); g.font = '600 11.5px "Space Grotesk", Arial'; g.textAlign = 'center';
            g.lineWidth = 3; g.strokeStyle = 'rgba(16,13,20,0.85)'; g.strokeText(p.name, px, py + 4); g.fillStyle = '#d8ecff'; g.fillText(p.name, px, py + 4);
          }
        });
        if (opts.lcross && ice.meta.lcross) {
          const L = ice.meta.lcross, [px, py] = map.llPx(L.lat, L.lon);
          g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.moveTo(px - 6, py - 6); g.lineTo(px + 6, py + 6); g.moveTo(px + 6, py - 6); g.lineTo(px - 6, py + 6); g.stroke();
          g.font = '600 11.5px "Space Grotesk", Arial'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(16,13,20,0.85)'; g.strokeText('LCROSS', px, py - 10); g.fillStyle = '#fff'; g.fillText('LCROSS', px, py - 10);
        }
      },
    };
  };
  // candidate squares coloured by class (1 safe, 2 caution, 3 risky)
  PolarMap.classes = function (C, getCls, cellM) {
    const cols = { 1: 'rgba(82,196,142,0.82)', 2: 'rgba(227,179,65,0.78)', 3: 'rgba(224,96,94,0.42)' };
    return {
      visible: true, showRisky: true,
      draw(g, map) {
        const cls = getCls(); if (!cls) return;
        const s = Math.max(1.5, (cellM || 2000) / map.scale);
        for (let i = 0; i < C.n; i++) {
          const c = cls[i]; if (!c || (c === 3 && !this.showRisky)) continue;
          const [px, py] = map.toPx(C.x[i], C.y[i]); if (px < -s || py < -s || px > map.W + s || py > map.H + s) continue;
          g.fillStyle = cols[c]; g.fillRect(px - s / 2, py - s / 2, s, s);
        }
      },
    };
  };
  // scale bar
  PolarMap.scaleBar = function () {
    return {
      visible: true,
      draw(g, map) {
        const target = map.W * 0.2 * map.scale, pow = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 5, 10].map((k) => k * pow).filter((v) => v <= target).pop() || pow;
        const w = nice / map.scale, x = 14, y = map.H - 16;
        g.strokeStyle = '#efe9f3'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y - 5); g.stroke();
        g.fillStyle = '#efe9f3'; g.font = '11px "Space Grotesk", Arial'; g.textAlign = 'left'; g.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', x + w + 6, y);
      },
    };
  };

  PolarMap.ll2xy = ll2xy; PolarMap.xy2ll = xy2ll;
  root.PolarMap = PolarMap;
})(window);
