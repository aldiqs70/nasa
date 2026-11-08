# حافة النور · Edge of Light — Lunar South Pole Mission Browser

**NASA Space Apps Challenge 2026 · Challenge: CLPS Lunar Mission Browser**
Team **Shabab Shihab** (شباب شهاب), the youth team of the Jordanian Astronomical Society.

At the lunar south pole the Sun never rises or sets: it circles the horizon. Mountain tops stay lit for months,
crater floors have not seen sunlight for billions of years and hold water ice. This site lets anyone, from the
curious public to students and researchers, explore where the light reaches, where Earth can be seen, where the
ice is, and plan a lander mission. Arabic first, with English data labels.

Live site: https://aldiqs70.github.io/nasa/

## What it does
- **Home**: natural Sun, Earth and Moon (NASA Blue Marble and LRO textures, lit per pixel), tonight's real Moon phase, and a long-term landing-suitability map of the pole.
- **3D explorer**: Cesium Moon with real-Sun lighting and shadows. Click any point for its terrain-aware Sun / Earth state now, a compass showing where to point the solar panel and the antenna, Earth's phase seen from the site, and a full analysis: illumination, communication, horizon panorama, **solar panel direction** (energy of a fixed vertical panel for every azimuth vs a Sun-tracking panel), **battery check**, nearest ice, and rock mix.
- **Mission planner**: choose a landing window, mission length and lander (battery Wh, load W, panel area / efficiency, tracking or fixed panels). Every one of 11,844 precomputed candidate sites (2 km grid, real LOLA horizons) is tried for every landing day; the battery must last the whole mission. Sites are coloured suitable / caution / unsuitable and the **top 3** (≥ 6 km apart) are ranked by light, Earth contact, battery margin, slope and **distance to water ice**. A "is the energy enough?" box checks any site and tells you the battery or panel size that would work.
- **Compare two sites** side by side for the same period and lander.
- **Water ice**: all 169 permanently shadowed regions with Moon Mineralogy Mapper ice detections (Lemelin et al. 2021), with outlines, temperatures and hydrogen, plus the LCROSS impact site.
- **Methods & sources** with downloadable data for student and research projects.

## Data and methods
- Terrain: LOLA `LDEM_80S_80MPP_ADJ` (NASA GSFC PGDA), nested grids 80 / 160 / 640 m (`data/terrain/`).
- Sun / Earth: NAIF SPICE DE421 in the MOON_ME frame, hourly 2026–2030 (`data/out/ephem.*`, `scripts/make_ephemeris.py`).
- Horizons: 720 rays to 300 km with lunar curvature; visible fraction of the solar disc (`js/terrain.js`, `js/sunearth.js`).
- Pole maps every 1 km (light %, Earth %, permanent shadow, slope, longest darkness) and planner candidates: `node scripts/precompute_grid.js` → `data/grid/`.
- Mission planner, panel model and battery simulation: `js/planner.js` (runs in a Web Worker, `js/planner-worker.js`).
- Ice: Lemelin et al. (2021) PSJ 2:103, dataset doi:10.5281/zenodo.4646092 (CC BY 4.0) → `data/ice/psr_ice.json`.
- Rocks: Lunar Prospector GRS FeO / Th → `data/rocks/`.

## Run locally
1. Put your Cesium ion token in `config.js` (needed only for the 3D view).
2. `python -m http.server 8000` in this folder, then open http://localhost:8000

Research and education prototype — not flight certification. Earth visibility is geometric, not radio link quality.
