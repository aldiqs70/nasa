/*
 * Lunar south-pole terrain engine (LOLA DEM) for the browser.
 *
 * Grids are south polar stereographic on the 1737.4 km reference sphere
 * (PROJ: +proj=stere +lat_0=-90 +lon_0=0 +R=1737400), i.e.
 *     rho = 2R tan((90+lat)/2),  x = rho sin(lon),  y = rho cos(lon)
 * which is the native projection of the LOLA polar products.
 *
 * Several nested levels (fine near the pole, coarse far away). Heights are
 * Int16 metres relative to the 1737.4 km sphere.
 *
 * horizon(lat, lon) casts rays out to ~300 km and returns, for every 1 deg of
 * azimuth, the elevation angle of the highest terrain seen from the site.
 * Curvature of the Moon is handled exactly: every sample is placed on the
 * sphere in 3-D before the elevation angle is measured.
 *
 * Works in the browser (window.Terrain) and in Node (module.exports).
 */
(function (root) {
  const R = 1737400;           // m
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const NODATA = -32768;

  function Terrain(meta, buffers) {
    this.meta = meta;
    this.levels = meta.levels.map((L, i) => ({
      name: L.name, res: L.res, nx: L.nx, ny: L.ny, xmin: L.xmin, ymax: L.ymax,
      xmax: L.xmin + L.nx * L.res, ymin: L.ymax - L.ny * L.res,
      h: new Int16Array(buffers[i]),
    }));
    // finest first
    this.levels.sort((a, b) => a.res - b.res);
    this.maxRange = Math.max(...this.levels.map((L) => Math.min(-L.xmin, L.xmax, -L.ymin, L.ymax)));
  }

  // ---- projection ----
  Terrain.ll2xy = function (lat, lon) {
    const rho = 2 * R * Math.tan((90 + lat) * D2R / 2);
    return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)];
  };
  Terrain.xy2ll = function (x, y) {
    const rho = Math.hypot(x, y);
    const lat = 2 * Math.atan(rho / (2 * R)) * R2D - 90;
    const lon = Math.atan2(x, y) * R2D;
    return [lat, lon];
  };
  // unit vector (Moon-fixed, MOON_ME axes) of a stereographic point, no trig
  function unitVec(x, y, out) {
    const rho2 = x * x + y * y, k = 4 * R * R, d = k + rho2;
    out[0] = 4 * R * y / d; out[1] = 4 * R * x / d; out[2] = -(k - rho2) / d;
    return out;
  }

  // ---- sampling ----
  function sampleLevel(L, x, y) {
    const fx = (x - L.xmin) / L.res - 0.5, fy = (L.ymax - y) / L.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= L.nx - 1 || j >= L.ny - 1) return NaN;
    const wx = fx - i, wy = fy - j, n = L.nx, a = j * n + i, h = L.h;
    const h00 = h[a], h10 = h[a + 1], h01 = h[a + n], h11 = h[a + n + 1];
    if (h00 === NODATA || h10 === NODATA || h01 === NODATA || h11 === NODATA) return NaN;
    return (h00 * (1 - wx) + h10 * wx) * (1 - wy) + (h01 * (1 - wx) + h11 * wx) * wy;
  }
  Terrain.prototype.heightXY = function (x, y, minRes) {
    for (const L of this.levels) {
      if (minRes && L.res < minRes) continue;
      const v = sampleLevel(L, x, y);
      if (!Number.isNaN(v)) return v;
    }
    return NaN;
  };
  Terrain.prototype.height = function (lat, lon) {
    const [x, y] = Terrain.ll2xy(lat, lon);
    return this.heightXY(x, y);
  };
  Terrain.prototype.covers = function (lat, lon) { return !Number.isNaN(this.height(lat, lon)); };

  // slope (deg) from the finest level, central differences over `span` cells
  Terrain.prototype.slope = function (lat, lon, span) {
    const [x, y] = Terrain.ll2xy(lat, lon);
    for (const L of this.levels) {
      const d = L.res * (span || 1);
      const hx1 = sampleLevel(L, x + d, y), hx0 = sampleLevel(L, x - d, y);
      const hy1 = sampleLevel(L, x, y + d), hy0 = sampleLevel(L, x, y - d);
      if ([hx1, hx0, hy1, hy0].some(Number.isNaN)) continue;
      // stereographic scale factor k = 1 + rho^2/(4R^2) (map metres -> ground metres)
      const k = 1 + (x * x + y * y) / (4 * R * R);
      const gx = (hx1 - hx0) / (2 * d / k), gy = (hy1 - hy0) / (2 * d / k);
      return { deg: Math.atan(Math.hypot(gx, gy)) * R2D, baseline: 2 * d / k };
    }
    return null;
  };

  /*
   * Horizon profile. Returns { elev: Float32Array(360) deg, h0, obsH }.
   * opts.mast: observer height above ground in m (default 2)
   * opts.maxDist: ray length in m (default: all the terrain we have, max 300 km)
   */
  Terrain.prototype.horizon = function (lat, lon, opts) {
    opts = opts || {};
    const mast = opts.mast != null ? opts.mast : 2;
    const [x0, y0] = Terrain.ll2xy(lat, lon);
    const h0 = this.heightXY(x0, y0);
    if (Number.isNaN(h0)) return null;
    const rObs = R + h0 + mast;

    // local frame at the observer (Moon-fixed axes)
    const f = lat * D2R, l = lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
    const up = [cf * cl, cf * sl, sf], east = [-sl, cl, 0], north = [-sf * cl, -sf * sl, cf];
    const O = [up[0] * rObs, up[1] * rObs, up[2] * rObs];

    const nBins = 360, best = new Float32Array(nBins).fill(-90);
    const nRays = opts.rays || 720;
    const fine = this.levels[0].res;
    const maxDist = Math.min(opts.maxDist || 300000, 300000);
    const u = [0, 0, 0];

    for (let k = 0; k < nRays; k++) {
      const psi = (k + 0.5) * 2 * Math.PI / nRays;
      const dx = Math.sin(psi), dy = Math.cos(psi);
      let d = fine * 0.75;
      while (d < maxDist) {
        const x = x0 + dx * d, y = y0 + dy * d;
        // use a level whose cell is not much finer than the step (fast, avoids aliasing far away)
        const step = Math.max(fine * 0.75, d * 0.012);
        const h = this.heightXY(x, y, step * 0.6 > fine ? Math.min(step * 0.6, 640) : 0);
        if (!Number.isNaN(h)) {
          unitVec(x, y, u);
          const r = R + h;
          const Dx = u[0] * r - O[0], Dy = u[1] * r - O[1], Dz = u[2] * r - O[2];
          const Dn = Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
          const e = Math.asin((Dx * up[0] + Dy * up[1] + Dz * up[2]) / Dn) * R2D;
          let az = Math.atan2(Dx * east[0] + Dy * east[1], Dx * north[0] + Dy * north[1] + Dz * north[2]) * R2D;
          if (az < 0) az += 360;
          const b = Math.min(nBins - 1, Math.floor(az));
          if (e > best[b]) best[b] = e;
        } else if (d > 5000 && Number.isNaN(this.heightXY(x, y))) {
          break; // left the terrain coverage
        }
        d += step;
      }
    }
    // fill any bin no ray landed in
    for (let b = 0; b < nBins; b++) {
      if (best[b] === -90) {
        const p = best[(b + nBins - 1) % nBins], n = best[(b + 1) % nBins];
        best[b] = Math.max(p, n);
      }
    }
    return { elev: best, h0, obsH: h0 + mast };
  };

  // Horizon elevation at an arbitrary azimuth (deg), linear between 1-deg bins
  Terrain.horizonFn = function (hz) {
    if (!hz) return null;
    const e = hz.elev, n = e.length;
    return (az) => {
      const t = ((az % 360) + 360) % 360 - 0.5;
      const i = Math.floor(t), w = t - i;
      return e[(i + n) % n] * (1 - w) + e[(i + 1) % n] * w;
    };
  };

  // ---- load from data/dem/terrain.json + .bin files ----
  Terrain.load = async function (base) {
    const meta = await fetch(base + 'terrain.json').then((r) => { if (!r.ok) throw new Error('terrain.json ' + r.status); return r.json(); });
    const bufs = await Promise.all(meta.levels.map((L) =>
      fetch(base + L.file).then((r) => { if (!r.ok) throw new Error(L.file + ' ' + r.status); return r.arrayBuffer(); })));
    return new Terrain(meta, bufs);
  };

  // ---- reference raster (e.g. NASA average illumination %, uint8, 255 = no data) ----
  function RefMap(meta, buf) {
    Object.assign(this, meta);
    this.v = new Uint8Array(buf);
  }
  RefMap.prototype.at = function (lat, lon) {
    const [x, y] = Terrain.ll2xy(lat, lon);
    const i = Math.floor((x - this.xmin) / this.res), j = Math.floor((this.ymax - y) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null;
    const v = this.v[j * this.nx + i];
    return v === 255 ? null : v;
  };
  // distance (km) to nearest pixel with value <= threshold (e.g. 0 % lit = permanent shadow)
  RefMap.prototype.nearest = function (lat, lon, threshold, maxKm) {
    const [x, y] = Terrain.ll2xy(lat, lon);
    const ci = Math.floor((x - this.xmin) / this.res), cj = Math.floor((this.ymax - y) / this.res);
    const maxR = Math.ceil((maxKm || 50) * 1000 / this.res);
    let best = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (r * this.res > best) break;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
        const v = this.v[j * this.nx + i];
        if (v !== 255 && v <= threshold) { const dd = Math.hypot(di, dj) * this.res; if (dd < best) best = dd; }
      }
    }
    if (!isFinite(best)) return null;
    const k = 1 + (x * x + y * y) / (4 * R * R);
    return best / k / 1000;
  };
  Terrain.loadRef = async function (base, name) {
    const meta = await fetch(base + name + '.json').then((r) => { if (!r.ok) throw new Error(name + '.json ' + r.status); return r.json(); });
    const buf = await fetch(base + meta.file).then((r) => { if (!r.ok) throw new Error(meta.file + ' ' + r.status); return r.arrayBuffer(); });
    return new RefMap(meta, buf);
  };

  const api = { Terrain, RefMap, R };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Terrain = Terrain, root.RefMap = RefMap;
})(typeof window !== 'undefined' ? window : globalThis);
