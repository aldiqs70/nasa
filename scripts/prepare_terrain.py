"""
Prepare compact terrain + NASA reference grids for the website.

Inputs (data/dem/):
  LDEM_80S_80MPP_ADJ.TIF                     LOLA south polar DEM, 80 m/px, 80S-90S (NASA GSFC PGDA)
  AVGVISIB_85S_060M_201608.IMG/.LBL          average Sun visibility, 60 m/px (Mazarico et al. 2011, updated 2016)
  AVGVISIB_85S_060M_201608_EARTH.IMG/.LBL    average Earth visibility

Outputs (data/terrain/):
  terrain.json + dem_L0.bin, dem_L1.bin, dem_L2.bin   Int16 heights (m) on nested polar-stereographic grids
  nasa_sun.json/.bin, nasa_earth.json/.bin            UInt8 percent (255 = no data)

Grid convention (same as the LOLA products and js/terrain.js):
  +proj=stere +lat_0=-90 +lon_0=0 +R=1737400 ; x = rho sin(lon), y = rho cos(lon)
  row 0 = largest y; pixel (i, j) centre = (xmin + (i+0.5) res, ymax - (j+0.5) res)

Usage:  python scripts/prepare_terrain.py
Needs:  pip install numpy rasterio
"""
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data", "dem")
OUT = os.path.join(ROOT, "data", "terrain")
R = 1737400.0
CRS = "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
NODATA = -32768

# name, half-width (m), resolution (m)
LEVELS = [("L0", 40_000, 80), ("L1", 150_000, 160), ("L2", 300_000, 640)]


def find(name):
    for f in os.listdir(SRC):
        if f.lower() == name.lower():
            return os.path.join(SRC, f)
    return None


def build_dem():
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_origin

    path = find("LDEM_80S_80MPP_ADJ.TIF")
    if not path:
        sys.exit("missing data/dem/LDEM_80S_80MPP_ADJ.TIF")
    with rasterio.open(path) as src:
        print("DEM:", src.width, "x", src.height, src.dtypes[0], src.crs, src.res, src.bounds)
        sample = src.read(1, window=((src.height // 2 - 50, src.height // 2 + 50), (src.width // 2 - 50, src.width // 2 + 50)))
        scale = 1000.0 if np.nanmax(np.abs(sample)) < 30 else 1.0   # km -> m if needed
        print("height units scale:", scale, "sample range", float(np.nanmin(sample)), float(np.nanmax(sample)))
        meta = {"version": 1, "radius_m": R, "crs": CRS, "source": os.path.basename(path),
                "source_url": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF", "levels": []}
        for name, half, res in LEVELS:
            n = int(round(2 * half / res))
            dst = np.full((n, n), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(src, 1), destination=dst,
                src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                dst_transform=from_origin(-half, half, res, res), dst_crs=CRS, dst_nodata=np.nan,
                resampling=Resampling.average if res > src.res[0] * 1.01 else Resampling.bilinear,
            )
            dst *= scale
            h = np.where(np.isfinite(dst), np.clip(np.round(dst), -32000, 32000), NODATA).astype("<i2")
            fn = f"dem_{name}.bin"
            h.tofile(os.path.join(OUT, fn))
            valid = h[h != NODATA]
            print(f"  {name}: {n}x{n} @ {res} m, valid {valid.size / h.size:.1%}, h {valid.min()}..{valid.max()} m")
            meta["levels"].append({"name": name, "file": fn, "res": res, "nx": n, "ny": n, "xmin": -half, "ymax": half})
    with open(os.path.join(OUT, "terrain.json"), "w") as f:
        json.dump(meta, f, indent=2)


def parse_lbl(path):
    txt = open(path, "r", errors="ignore").read()
    def get(key, cast=str):
        m = re.search(r"^\s*" + key + r"\s*=\s*\"?([^\"\r\n<]+)", txt, re.M)
        if not m:
            return None
        v = m.group(1).strip()
        try:
            return cast(v)
        except ValueError:
            return cast(v.split()[0])
    return {
        "lines": get("LINES", int), "samples": get("LINE_SAMPLES", int),
        "type": get("SAMPLE_TYPE"), "bits": get("SAMPLE_BITS", int),
        "scale": get("SCALING_FACTOR", float) or 1.0, "offset": get("OFFSET", float) or 0.0,
        "map_scale_km": get("MAP_SCALE", float),
        "line_off": get("LINE_PROJECTION_OFFSET", float), "sample_off": get("SAMPLE_PROJECTION_OFFSET", float),
        "center_lat": get("CENTER_LATITUDE", float), "center_lon": get("CENTER_LONGITUDE", float),
        "missing": get("MISSING_CONSTANT", float), "proj": get("MAP_PROJECTION_TYPE"),
        "a_radius": get("A_AXIS_RADIUS", float),
        "_txt": txt,
    }


def build_ref(stem, out_name, res=150):
    img, lbl = find(stem + ".IMG"), find(stem + ".LBL")
    if not (img and lbl):
        print("skip (missing):", stem)
        return
    L = parse_lbl(lbl)
    print(stem, {k: v for k, v in L.items() if k != "_txt"})
    t = (L["type"] or "").upper()
    if "REAL" in t:
        dt = "<f4" if L["bits"] == 32 else "<f8"
    elif "UNSIGNED" in t:
        dt = {8: "u1", 16: "<u2", 32: "<u4"}[L["bits"]]
    else:
        dt = {8: "i1", 16: "<i2", 32: "<i4"}[L["bits"]]
    if "MSB" in t:
        dt = dt.replace("<", ">")
    a = np.fromfile(img, dtype=dt, count=L["lines"] * L["samples"]).reshape(L["lines"], L["samples"]).astype(np.float64)
    bad = ~np.isfinite(a)
    if L["missing"] is not None:
        bad |= a == L["missing"]
    a = a * L["scale"] + L["offset"]
    a[bad] = np.nan
    vmax = np.nanmax(a)
    print("  value range", np.nanmin(a), vmax)
    frac = a if vmax <= 1.0001 else a / 100.0
    ms = L["map_scale_km"] * 1000.0
    # PDS polar stereographic: x = (sample - S0 - 1) * scale, y = (1 - line + L0) * scale  (1-based sample/line)
    # grid edge coordinates of pixel (row j, col i) centre with 1-based line=j+1, sample=i+1:
    xmin_c = (1 - L["sample_off"] - 1) * ms          # centre of first column
    ymax_c = (1 - 1 + L["line_off"]) * ms            # centre of first row
    # block-average to `res`
    f = int(round(res / ms))
    ny, nx = (frac.shape[0] // f) * f, (frac.shape[1] // f) * f
    blk = frac[:ny, :nx].reshape(ny // f, f, nx // f, f)
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(blk, axis=(1, 3))
    out = np.where(np.isfinite(mean), np.clip(np.round(mean * 100), 0, 100), 255).astype("u1")
    resm = ms * f
    xmin = xmin_c - ms / 2
    ymax = ymax_c + ms / 2
    out.tofile(os.path.join(OUT, out_name + ".bin"))
    meta = {"file": out_name + ".bin", "res": resm, "nx": out.shape[1], "ny": out.shape[0], "xmin": xmin, "ymax": ymax,
            "units": "percent of time visible (255 = no data)", "source": os.path.basename(img),
            "source_url": "https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/" + os.path.basename(img),
            "reference": "Mazarico et al. 2011, Icarus 211, 1066; LOLA illumination products (2016 release), 18.6-yr average"}
    with open(os.path.join(OUT, out_name + ".json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    # sanity: pole should be inside the grid centre
    print(f"  -> {out_name}: {out.shape[1]}x{out.shape[0]} @ {resm:.0f} m, x {xmin:.0f}..{xmin + out.shape[1] * resm:.0f}, y {ymax - out.shape[0] * resm:.0f}..{ymax:.0f}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    build_dem()
    build_ref("AVGVISIB_85S_060M_201608", "nasa_sun")
    build_ref("AVGVISIB_85S_060M_201608_EARTH", "nasa_earth")
