"""
Build the Sun/Earth ephemeris table used by the website.

For every hour between START and END (UTC) it stores, in the Moon-fixed
MOON_ME frame (the same frame as the LOLA terrain and Cesium Moon):
  - Sun unit vector seen from the Moon's centre      (3 values)
  - Sun distance in AU                                (1 value)
  - Earth position vector from the Moon's centre, km  (3 values)

Output: data/out/ephem.bin (float32, little-endian, 7 values per hour)
        data/out/ephem.json (metadata: start, step, count, layout)

The website adds the site's own position to the Earth vector (topocentric
parallax up to ~0.26 deg) — the Sun's parallax is negligible (<0.001 deg).

Time scale: ET (TDB) = UTC + 69.184 s. Valid while no new leap second is
added after 2017 (true as of 2026). TDB-TT periodic terms (<2 ms) ignored.

Kernels (data/kernels): de421.bsp, moon_pa_de421_1900-2050.bpc,
moon_080317.tf, pck00008.tpc  — LOLA products use MOON_ME / DE421.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KDIR = os.path.join(ROOT, "data", "kernels")
ODIR = os.path.join(ROOT, "data", "out")

START = datetime(2026, 1, 1, tzinfo=timezone.utc)
END = datetime(2031, 1, 1, tzinfo=timezone.utc)
STEP_H = 1
AU_KM = 149597870.7
TT_MINUS_UTC = 69.184  # 37 leap seconds + 32.184 s

J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)


def utc_to_et(t: datetime) -> float:
    return (t - J2000).total_seconds() + TT_MINUS_UTC


def main() -> None:
    for k in ["de421.bsp", "moon_pa_de421_1900-2050.bpc", "moon_080317.tf", "pck00008.tpc"]:
        sp.furnsh(os.path.join(KDIR, k))

    n = int((END - START).total_seconds() // (STEP_H * 3600))
    out = np.zeros((n, 7), dtype=np.float32)
    for i in range(n):
        et = utc_to_et(START + timedelta(hours=i * STEP_H))
        s, _ = sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")
        e, _ = sp.spkpos("EARTH", et, "MOON_ME", "LT+S", "MOON")
        s = np.asarray(s)
        d = np.linalg.norm(s)
        out[i, 0:3] = s / d
        out[i, 3] = d / AU_KM
        out[i, 4:7] = e

    os.makedirs(ODIR, exist_ok=True)
    out.astype("<f4").tofile(os.path.join(ODIR, "ephem.bin"))
    meta = {
        "frame": "MOON_ME (DE421)",
        "start_utc": START.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "step_hours": STEP_H,
        "count": n,
        "layout": ["sun_x", "sun_y", "sun_z", "sun_dist_au", "earth_x_km", "earth_y_km", "earth_z_km"],
        "source": "NAIF SPICE: de421.bsp, moon_pa_de421_1900-2050.bpc, moon_080317.tf",
    }
    with open(os.path.join(ODIR, "ephem.json"), "w") as f:
        json.dump(meta, f, indent=2)

    # Sanity checks printed for the record
    sun_lat = np.degrees(np.arcsin(out[:, 2]))
    e = out[:, 4:7].astype(float)
    er = np.linalg.norm(e, axis=1)
    e_lat = np.degrees(np.arcsin(e[:, 2] / er))
    e_lon = np.degrees(np.arctan2(e[:, 1], e[:, 0]))
    print(f"hours: {n}")
    print(f"sub-solar latitude range: {sun_lat.min():.3f} .. {sun_lat.max():.3f} deg  (expect about +-1.54)")
    print(f"sub-Earth latitude range: {e_lat.min():.2f} .. {e_lat.max():.2f} deg  (libration, expect about +-6.7)")
    print(f"sub-Earth longitude range: {e_lon.min():.2f} .. {e_lon.max():.2f} deg (expect about +-8)")
    print(f"Earth distance range: {er.min():.0f} .. {er.max():.0f} km")


if __name__ == "__main__":
    main()
