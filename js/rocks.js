/*
 * Estimated rock mix at any point near the lunar south pole, from orbital chemistry.
 *
 * Data: Lunar Prospector gamma-ray spectrometer, half-degree maps of FeO (wt%) and Th (ppm)
 * (Lawrence et al. 2002, 2003; PDS Geosciences Node), resampled to a 10 km south polar
 * stereographic grid (same projection as js/terrain.js). The instrument footprint is ~45 km,
 * so this describes the average material of the surrounding area, not a single boulder.
 *
 * Mix: three typical lunar rock end-members, solved with sum = 100 % and no negative parts.
 *   anorthosite  FeO  1.0  Th  0.2   (ferroan anorthosite, the bright highland crust)
 *   mafic        FeO 14.0  Th  1.5   (basalt / norite: iron-rich rock, e.g. South Pole-Aitken material)
 *   KREEP        FeO 10.5  Th 10.0   (KREEP basalt, rich in K, rare-earth elements and P)
 * Breccia and regolith are not separate rocks in this sense: they are broken-up mixtures of these.
 */
(function (root) {
  const R = 1737400, D2R = Math.PI / 180;

  function RockMap(meta) {
    Object.assign(this, meta);
    this.fe = Float32Array.from(meta.fe);
    this.th = Float32Array.from(meta.th);
    this.em = meta.endmembers;
  }

  RockMap.prototype.chem = function (lat, lon) {
    const rho = 2 * R * Math.tan((90 + lat) * D2R / 2);
    const x = rho * Math.sin(lon * D2R), y = rho * Math.cos(lon * D2R);
    const fx = (x - this.xmin) / this.res - 0.5, fy = (this.ymax - y) / this.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.ny - 1) return null;
    const wx = fx - i, wy = fy - j, n = this.nx, a = j * n + i;
    const bl = (g) => (g[a] * (1 - wx) + g[a + 1] * wx) * (1 - wy) + (g[a + n] * (1 - wx) + g[a + n + 1] * wx) * wy;
    return { FeO: bl(this.fe), Th: bl(this.th) };
  };

  // sum-to-one, non-negative least squares (FeO and Th scaled to similar weight)
  RockMap.prototype.unmix = function (FeO, Th) {
    const E = this.em, sf = 13, st = 9.8, W = 10;
    let best = null;
    const subsets = [[0, 1, 2], [0, 1], [0, 2], [1, 2], [0], [1], [2]];
    for (const sub of subsets) {
      if (best && sub.length < 3 && best.full3) break;
      const A = [sub.map((k) => E[k].FeO / sf), sub.map((k) => E[k].Th / st), sub.map(() => W)];
      const b = [FeO / sf, Th / st, W];
      const x = lstsq(A, b);
      if (!x || x.some((v) => v < -1e-9)) continue;
      let r = 0;
      for (let row = 0; row < 3; row++) { let s = 0; for (let c = 0; c < sub.length; c++) s += A[row][c] * x[c]; r += (s - b[row]) ** 2; }
      if (!best || r < best.r - 1e-12) {
        const f = [0, 0, 0]; sub.forEach((k, c) => { f[k] = Math.max(0, x[c]); });
        best = { r, f, full3: sub.length === 3 };
      }
    }
    const s = best.f[0] + best.f[1] + best.f[2];
    return { anorthosite: 100 * best.f[0] / s, mafic: 100 * best.f[1] / s, kreep: 100 * best.f[2] / s };
  };

  RockMap.prototype.at = function (lat, lon) {
    const c = this.chem(lat, lon);
    if (!c) return null;
    return Object.assign({}, c, this.unmix(c.FeO, c.Th));
  };

  // least squares via normal equations (at most 3 unknowns)
  function lstsq(A, b) {
    const n = A[0].length, M = [], v = [];
    for (let i = 0; i < n; i++) {
      M.push([]); let s = 0;
      for (let j = 0; j < n; j++) { let t = 0; for (let r = 0; r < A.length; r++) t += A[r][i] * A[r][j]; M[i].push(t); }
      for (let r = 0; r < A.length; r++) s += A[r][i] * b[r];
      v.push(s);
    }
    // Gaussian elimination
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      if (Math.abs(M[p][i]) < 1e-12) return null;
      [M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]];
      for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < n; c++) M[r][c] -= f * M[i][c]; v[r] -= f * v[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = v[i]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; }
    return x;
  }

  RockMap.load = async function (url) {
    const meta = await fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
    return new RockMap(meta);
  };

  const api = { RockMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RockMap = RockMap;
})(typeof window !== 'undefined' ? window : globalThis);
