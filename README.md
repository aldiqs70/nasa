# Lunar South Pole Planner — شباب شهاب

**NASA Space Apps Challenge 2026 · Challenge: CLPS Lunar Mission Browser**
Team **Shabab Shihab** (شباب شهاب), the youth team of the Jordanian Astronomical Society.

An interactive 3-D Moon for planning missions to the lunar south pole. Point anywhere near the pole to see the
Sun and Earth positions above the local horizon, whether the site is lit, how much solar power a panel would
produce, and whether direct communication with Earth is possible. Click a site for a full analysis over time.

## Features
- 3-D Moon (Cesium Moon, LRO data) with live latitude / longitude / elevation under the mouse
- Sun and Earth positions from NASA/JPL SPICE (DE421, MOON_ME frame — the same frame as the LOLA terrain), hourly 2026–2030
- Terrain horizon from LOLA DEMs out to 300 km, including lunar curvature → real shadows in craters
- Illumination %, longest darkness, solar energy, Earth-visibility %, longest communication gap
- Horizon view: terrain silhouette with the Sun and Earth paths
- Candidate sites with geology notes, landing-criteria checklist (no invented safety score), rock guide
- Validation against NASA's published LOLA illumination maps (Mazarico et al. 2011)

## Run locally
1. Put your Cesium ion token in `config.js`
2. `python -m http.server 8000` in this folder, then open http://localhost:8000

## Data
- NAIF SPICE kernels (`data/kernels/`), regenerate the ephemeris with `python scripts/make_ephemeris.py`
- LOLA polar DEM + illumination products (see `data/dem/README.txt`), prepare with `python scripts/prepare_terrain.py`

Research and education prototype — not flight certification. Earth visibility is geometric, not RF link quality.

Live site: https://aldiqs70.github.io/nasa/ · Terrain preparation tool: https://aldiqs70.github.io/nasa/prepare.html
