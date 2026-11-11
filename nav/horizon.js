/*
 * Fine horizon profile in four distance bands (browser + Node).
 * Same ray march as Terrain.horizon in js/terrain.js: every terrain sample is placed on the curved Moon
 * before its elevation angle is measured. Bins are a quarter degree of azimuth; each band keeps its own
 * highest terrain, so the sky view can draw near and far ridgelines separately.
 * Outside the terrain model the horizon is the smooth sphere seen from mast height.
 */
(function (root) {
  const R = 1737400, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const BANDS = [0, 1500, 8000, 40000, 300000];     // m
  const NB = 1440, NRAYS = 2880;

  function unitVec(x, y, out) { const rho2 = x * x + y * y, k = 4 * R * R, d = k + rho2; out[0] = 4 * R * y / d; out[1] = 4 * R * x / d; out[2] = -(k - rho2) / d; return out; }

  // T: Terrain instance, Terrain: its constructor (for ll2xy). Returns null outside the terrain model.
  function banded(T, Terrain, lat, lon, mast) {
    const [x0, y0] = Terrain.ll2xy(lat, lon), h0 = T.heightXY(x0, y0);
    if (Number.isNaN(h0)) return null;
    const rObs = R + h0 + mast;
    const f = lat * D2R, l = lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
    const up = [cf * cl, cf * sl, sf], east = [-sl, cl, 0], north = [-sf * cl, -sf * sl, cf];
    const O = [up[0] * rObs, up[1] * rObs, up[2] * rObs];
    const nb = BANDS.length - 1, prof = []; for (let b = 0; b < nb; b++) prof.push(new Float32Array(NB).fill(-90));
    const fine = T.levels[0].res, u = [0, 0, 0];
    for (let k = 0; k < NRAYS; k++) {
      const psi = (k + 0.5) * 2 * Math.PI / NRAYS, dx = Math.sin(psi), dy = Math.cos(psi);
      let d = fine * 0.75, band = 0;
      while (d < 300000) {
        const x = x0 + dx * d, y = y0 + dy * d, step = Math.max(fine * 0.75, d * 0.008);
        const h = T.heightXY(x, y, step * 0.6 > fine ? Math.min(step * 0.6, 640) : 0);
        if (!Number.isNaN(h)) {
          unitVec(x, y, u); const r = R + h;
          const Dx = u[0] * r - O[0], Dy = u[1] * r - O[1], Dz = u[2] * r - O[2], Dn = Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
          const e = Math.asin((Dx * up[0] + Dy * up[1] + Dz * up[2]) / Dn) * R2D;
          let az = Math.atan2(Dx * east[0] + Dy * east[1], Dx * north[0] + Dy * north[1] + Dz * north[2]) * R2D; if (az < 0) az += 360;
          while (band < nb - 1 && d >= BANDS[band + 1]) band++;
          const bi = Math.min(NB - 1, Math.floor(az * NB / 360)), p = prof[band];
          if (e > p[bi]) p[bi] = e;
        } else if (d > 5000 && Number.isNaN(T.heightXY(x, y))) break;
        d += step;
      }
    }
    for (const p of prof) for (let pass = 0; pass < 3; pass++) for (let b = 0; b < NB; b++) if (p[b] === -90) p[b] = Math.max(p[(b + NB - 1) % NB], p[(b + 1) % NB]);
    return { h0, prof };
  }
  function sphere(mast) {
    const dip = -Math.acos(R / (R + mast)) * R2D;
    return { h0: 0, prof: BANDS.slice(1).map(() => new Float32Array(NB).fill(dip)) };
  }

  const api = { BANDS, NB, NRAYS, banded, sphere };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Horizon = api;
})(typeof window !== 'undefined' ? window : globalThis);
