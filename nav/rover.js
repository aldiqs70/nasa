/* Rover route from a landing site to an ice-bearing shadowed region.
   The terrain model is sampled on a 160 m grid around both. A cell can be driven if its slope is within
   the rover's limit; the route is the shortest drivable path (Dijkstra, 8 neighbours, 3-D length) from
   the site to the first cell inside the region's outline. If no such path exists, a second search finds
   the route whose steepest cell is as gentle as possible, to say what limit the trip would need.
   160 m terrain cannot see boulders or small craters: this tests slope only, it is not a drive plan. */
(function () {
  const NAV = window.NAV, RES = 160, D2R = Math.PI / 180, MAX_KM = 40;

  function Heap(n) { this.k = new Float64Array(n + 1); this.v = new Int32Array(n + 1); this.n = 0; }
  Heap.prototype.push = function (key, val) {
    if (this.n + 1 >= this.k.length) { const k = new Float64Array(this.k.length * 2), v = new Int32Array(this.k.length * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v; }
    let i = ++this.n; const K = this.k, V = this.v;
    while (i > 1) { const p = i >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v, top = V[1], key = K[this.n], val = V[this.n--]; let i = 1;
    for (;;) { let c = i * 2; if (c > this.n) break; if (c < this.n && K[c + 1] < K[c]) c++; if (K[c] >= key) break; K[i] = K[c]; V[i] = V[c]; i = c; }
    K[i] = key; V[i] = val; this.top = top; return top;
  };

  // T3: terrain, iceMap: Planner.IceMap, i: region index, limit: steepest drivable slope in degrees
  function plan(T3, iceMap, i, site, limit) {
    const p = iceMap.psr[i], rings = iceMap.polys[i], rad = iceMap.radius[i];
    let x0 = Math.min(site.x, p.x - rad), x1 = Math.max(site.x, p.x + rad), y0 = Math.min(site.y, p.y - rad), y1 = Math.max(site.y, p.y + rad);
    for (const r of rings) for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); }
    const pad = 3000; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    if (Math.max(x1 - x0, y1 - y0) > (MAX_KM + 20) * 1000) return { far: true };
    const W = Math.ceil((x1 - x0) / RES), Hn = Math.ceil((y1 - y0) / RES), n = W * Hn;
    const X = (c) => x0 + (c + 0.5) * RES, Y = (r) => y1 - (r + 0.5) * RES;
    const h = new Float32Array(n), slope = new Float32Array(n), target = new Uint8Array(n);
    for (let r = 0; r < Hn; r++) for (let c = 0; c < W; c++) h[r * W + c] = T3.heightXY(X(c), Y(r));
    let nT = 0;
    for (let r = 0; r < Hn; r++) for (let c = 0; c < W; c++) {
      const k = r * W + c, cl = Math.max(0, c - 1), cr = Math.min(W - 1, c + 1), ru = Math.max(0, r - 1), rd = Math.min(Hn - 1, r + 1);
      const gx = (h[r * W + cr] - h[r * W + cl]) / ((cr - cl) * RES), gy = (h[ru * W + c] - h[rd * W + c]) / ((rd - ru) * RES);
      slope[k] = Number.isNaN(h[k]) || Number.isNaN(gx) || Number.isNaN(gy) ? 90 : Math.atan(Math.hypot(gx, gy)) / D2R;
      if (Math.abs(X(c) - p.x) < rad * 3 + 2000 && Math.abs(Y(r) - p.y) < rad * 3 + 2000 && iceMap.distanceOneM(i, X(c), Y(r)) === 0) { target[k] = 1; nT++; }
    }
    const cell = (x, y) => Math.max(0, Math.min(Hn - 1, Math.floor((y1 - y) / RES))) * W + Math.max(0, Math.min(W - 1, Math.floor((x - x0) / RES)));
    if (!nT) target[cell(p.x, p.y)] = 1;                                   // a region smaller than one cell
    const start = cell(site.x, site.y);

    // mode 'short': shortest length with every cell within the limit. mode 'gentle': smallest steepest cell.
    const search = (mode) => {
      const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), heap = new Heap(4096);
      dist[start] = 0; heap.push(0, start);
      while (heap.n) {
        const u = heap.pop(); if (done[u]) continue; done[u] = 1;
        if (target[u]) return { end: u, prev, cost: dist[u] };
        const ur = (u / W) | 0, uc = u - ur * W;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const r = ur + dr, c = uc + dc; if (r < 0 || c < 0 || r >= Hn || c >= W) continue;
          const v = r * W + c; if (done[v] || slope[v] >= 89) continue;
          let nd;
          if (mode === 'short') { if (slope[v] > limit) continue; const dxy = RES * (dr && dc ? 1.41421356 : 1), dh = h[v] - h[u]; nd = dist[u] + Math.sqrt(dxy * dxy + dh * dh); }
          else nd = Math.max(dist[u], slope[v]) + 1e-6;
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
        }
      }
      return null;
    };
    const trace = (res) => {
      const cells = []; for (let u = res.end; u >= 0; u = res.prev[u]) cells.push(u); cells.reverse();
      let len = 0, steep = 0, climb = 0; const pts = [];
      cells.forEach((u, k) => {
        const r = (u / W) | 0, c = u - r * W; pts.push([X(c), Y(r)]);
        if (k) { const q = cells[k - 1], qr = (q / W) | 0, qc = q - qr * W, dxy = RES * (qr !== r && qc !== c ? 1.41421356 : 1), dh = h[u] - h[q]; len += Math.sqrt(dxy * dxy + dh * dh); if (dh > 0) climb += dh; steep = Math.max(steep, slope[u]); }
      });
      return { pts, lengthKm: len / 1000, steepest: steep, climb, drop: h[cells[cells.length - 1]] - h[cells[0]] };
    };
    const grid = { W, Hn, x0, y1, res: RES, h, slope, rings };
    const direct = search('short');
    if (direct) return Object.assign({ ok: true, grid }, trace(direct));
    const gentle = search('gentle');
    return gentle ? Object.assign({ ok: false, grid, needs: Math.ceil(gentle.cost) }, trace(gentle)) : { ok: false, grid, pts: [] };
  }

  // Draw the route window: shaded relief, cells too steep for the rover, the region's outline, the route.
  function draw(cv, res, site, limit) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), S = Math.max(1, r.width), g = cv.getContext('2d');
    cv.width = cv.height = Math.round(S * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    if (!res || !res.grid) return;
    const G = res.grid, off = document.createElement('canvas'), mask = document.createElement('canvas'); off.width = mask.width = G.W; off.height = mask.height = G.Hn;
    const og = off.getContext('2d'), im = og.createImageData(G.W, G.Hn), px = im.data, mg = mask.getContext('2d'), mi = mg.createImageData(G.W, G.Hn), mp = mi.data, lx = -0.58, ly = 0.58, lz = 0.57, z = 2.2;
    for (let rr = 0; rr < G.Hn; rr++) for (let c = 0; c < G.W; c++) {
      const k = rr * G.W + c, cl = Math.max(0, c - 1), cr = Math.min(G.W - 1, c + 1), ru = Math.max(0, rr - 1), rd = Math.min(G.Hn - 1, rr + 1);
      const gx = (G.h[rr * G.W + cr] - G.h[rr * G.W + cl]) / ((cr - cl) * G.res), gy = (G.h[ru * G.W + c] - G.h[rd * G.W + c]) / ((rd - ru) * G.res);
      const nx = -gx * z, ny = -gy * z, nn = Math.hypot(nx, ny, 1), sh = Number.isNaN(nn) ? 0 : Math.pow(Math.max(0, Math.min(1, ((nx * lx + ny * ly + lz) / nn - 0.22) / 0.62)), 0.9);
      const v = 255 * (0.08 + 0.62 * sh), o = k * 4;
      px[o] = v; px[o + 1] = v; px[o + 2] = v * 0.98; px[o + 3] = 255;
      if (G.slope[k] > limit) { mp[o] = 190; mp[o + 1] = 84; mp[o + 2] = 52; mp[o + 3] = 150; }
    }
    og.putImageData(im, 0, 0); mg.putImageData(mi, 0, 0);
    const sc = S / Math.max(G.W, G.Hn), ox = (S - G.W * sc) / 2, oy = (S - G.Hn * sc) / 2;
    const PX = (x) => ox + (x - G.x0) / G.res * sc, PY = (y) => oy + (G.y1 - y) / G.res * sc;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(off, ox, oy, G.W * sc, G.Hn * sc);
    g.imageSmoothingEnabled = false; g.drawImage(mask, ox, oy, G.W * sc, G.Hn * sc); g.imageSmoothingEnabled = true;   // cell-exact, so a drivable corridor stays visible
    g.fillStyle = 'rgba(111,174,255,0.28)'; g.strokeStyle = '#8FC0FF'; g.lineWidth = 1.5;
    for (const ring of G.rings) { if (ring.length < 6) continue; g.beginPath(); for (let k = 0; k < ring.length; k += 2) { if (k) g.lineTo(PX(ring[k]), PY(ring[k + 1])); else g.moveTo(PX(ring[k]), PY(ring[k + 1])); } g.closePath(); g.fill(); g.stroke(); }
    if (res.pts && res.pts.length > 1) for (const pass of [0, 1]) {
      g.strokeStyle = pass ? (res.ok ? '#FFFFFF' : '#E86A52') : 'rgba(0,0,0,0.8)'; g.lineWidth = pass ? 2.2 : 5; g.lineJoin = 'round'; g.setLineDash(res.ok || !pass ? [] : [5, 4]);
      g.beginPath(); res.pts.forEach((p, k) => { if (k) g.lineTo(PX(p[0]), PY(p[1])); else g.moveTo(PX(p[0]), PY(p[1])); }); g.stroke();
    }
    g.setLineDash([]);
    const sx = PX(site.x), sy = PY(site.y);
    g.fillStyle = '#FFD166'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 6, 0, 6.2832); g.fill(); g.stroke();
    const km = sc / (G.res / 1000), span = Math.max(G.W, G.Hn) * G.res / 1000, barKm = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1, bx = 14, by = S - 16;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(bx - 1, by - 5, barKm * km + 2, 8);
    g.fillStyle = '#fff'; g.fillRect(bx, by, barKm * km, 2); g.fillRect(bx, by - 4, 1, 6); g.fillRect(bx + barKm * km - 1, by - 4, 1, 6);
    g.font = '600 11px Archivo, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.direction = 'ltr';
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(barKm + ' km', bx + 4, by - 5); g.fillText(barKm + ' km', bx + 4, by - 5);
  }

  NAV.Rover = { plan, draw, MAX_KM };
})();
