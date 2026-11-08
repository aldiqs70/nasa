/*
 * حافة النور · Edge of Light — main application.
 * Views: home (natural Sun/Earth/Moon + overview map), 3D explorer (Cesium Moon), mission planner,
 * site comparison, water-ice regions, methods & sources.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const HOUR = 3600e3, DAY = 24 * HOUR, R_KM = 1737.4;
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = (t) => { const d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
  const fmtLat = (d) => Math.abs(d).toFixed(4) + '°' + (d < 0 ? 'S' : 'N');
  const fmtLon = (d) => Math.abs(d).toFixed(4) + '°' + (d < 0 ? 'W' : 'E');
  const fmtLL = (lat, lon) => fmtLat(lat) + ' · ' + fmtLon(lon);
  const dur = (h) => h >= 48 ? (h / 24).toFixed(1) + ' يوم' : Math.round(h) + ' ساعة';
  const durNum = (h) => h >= 48 ? '<span class="num">' + (h / 24).toFixed(1) + '</span> <small>يوم</small>' : '<span class="num">' + Math.round(h) + '</span> <small>ساعة</small>';
  const pct = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(v >= 99.95 || v < 9.95 ? 1 : 0) + '%');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tag = (cls, txt) => '<span class="tag ' + cls + '">' + txt + '</span>';
  const CLS_AR = { safe: 'مناسب', caution: 'بحذر', risky: 'غير مناسب' };
  const V = window.__v || Date.now();

  // ------------------------------------------------------------------ shared state
  const S = {
    eph: null, range: [Date.now(), Date.now()], ice: null, iceMap: null, grid: null, rocks: null,
    terrain: null, terrainP: null, cand: null, candP: null, worker: null, workerReady: null,
    top: [], cls: null, lastRank: null, sites: (window.SiteData && window.SiteData.SITES) || [],
    picks: {}, // custom points chosen on maps: {name: {lat, lon}}
  };
  const fetchJSON = (u) => fetch(u + (u.includes('?') ? '&' : '?') + 'v=' + V).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  const fetchBuf = (u) => fetch(u + '?v=' + V).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); });

  async function loadBase() {
    const [meta, bin, ice] = await Promise.all([fetchJSON('data/out/ephem.json'), fetchBuf('data/out/ephem.bin'), fetchJSON('data/ice/psr_ice.json')]);
    S.ephMeta = meta; S.ephBuf = bin;
    S.eph = new SunEarth.Ephemeris(meta, new Float32Array(bin));
    S.range = S.eph.range();
    S.ice = ice; S.iceMap = new Planner.IceMap(ice);
  }
  async function loadGrid() {
    if (S.grid) return S.grid;
    const meta = await fetchJSON('data/grid/grid.json');
    const [lit, earth, maxLit, slope4, darkh] = await Promise.all(['lit.bin', 'earth.bin', 'maxlit.bin', 'slope4.bin', 'darkh.bin'].map((f) => fetchBuf('data/grid/' + f)));
    S.grid = { meta, lit: new Uint8Array(lit), earth: new Uint8Array(earth), maxLit: new Uint8Array(maxLit), slope4: new Uint8Array(slope4), darkH: new Uint16Array(darkh) };
    return S.grid;
  }
  function gridAt(lat, lon) {
    const g = S.grid; if (!g) return null;
    const [x, y] = Planner.ll2xy(lat, lon), m = g.meta;
    const c = Math.floor((x - m.xmin) / m.res), r = Math.floor((m.ymax - y) / m.res);
    if (c < 0 || r < 0 || c >= m.nx || r >= m.ny) return null;
    const k = r * m.nx + c; return { lit: g.lit[k], earth: g.earth[k], maxLit: g.maxLit[k], slope: g.slope4[k] / 4, darkH: g.darkH[k] };
  }
  function loadTerrain() {
    if (!S.terrainP) S.terrainP = Terrain.load('data/terrain/').then((t) => (S.terrain = t)).catch((e) => { console.warn('terrain', e); return null; });
    return S.terrainP;
  }
  async function decodeMasks() {
    const r = await fetch('data/grid/cand_masks.gz?v=' + V); if (!r.ok) throw new Error('cand_masks.gz ' + r.status);
    let buf;
    if (typeof DecompressionStream !== 'undefined') buf = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    else throw new Error('هالمتصفح قديم وما بيدعم فك الضغط. جرّب Chrome أو Edge أو Firefox حديث.');
    const out = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i += 360) { let v = 0; for (let b = 0; b < 360; b++) { v = (v + buf[i + b]) & 255; out[i + b] = v; } }
    return out;
  }
  function loadCandidates() {
    if (!S.candP) S.candP = (async () => {
      const [meta, masks] = await Promise.all([fetchJSON('data/grid/cand.json'), decodeMasks()]);
      S.candMeta = meta; S.cand = new Planner.Candidates(meta, masks.buffer.slice(0));
      S.cand.attachIce(S.iceMap, 1);
      S.masksBuf = masks.buffer;
      return S.cand;
    })();
    return S.candP;
  }
  function loadRocks() { if (!S.rocksP) S.rocksP = RockMap.load('data/rocks/lp_south.json').then((r) => (S.rocks = r)).catch(() => null); return S.rocksP; }

  // nearest named place for a point
  function placeName(lat, lon) {
    const [x, y] = Planner.ll2xy(lat, lon);
    let best = null;
    for (const p of S.ice.psr) { if (!p.name) continue; const d = Math.hypot(p.x - x, p.y - y) / 1000; if (!best || d < best.d) best = { d, name: p.name }; }
    for (const s of S.sites) { const [sx, sy] = Planner.ll2xy(s.lat, s.lon); const d = Math.hypot(sx - x, sy - y) / 1000; if (!best || d < best.d) best = { d, name: s.name }; }
    if (best && best.d < 30) return 'قرب ' + best.name;
    return fmtLL(lat, lon);
  }
  function nearestIce(lat, lon, minM3) {
    const [x, y] = Planner.ll2xy(lat, lon); const r = S.iceMap.distance(x, y, minM3 || 1);
    return r.id >= 0 ? { km: r.km, p: S.ice.psr[r.id] } : null;
  }
  const iceName = (p) => p.name || ('منطقة ظل #' + p.id);

  // ------------------------------------------------------------------ site model (horizon) + series
  async function siteModel(lat, lon) {
    const t = await loadTerrain();
    if (!t) return { lat, lon, h: 0, slope: null, elev: new Float32Array(360), hfn: null, flat: true };
    const hz = t.horizon(lat, lon, { mast: 2 });
    if (!hz) return { lat, lon, h: 0, slope: null, elev: new Float32Array(360), hfn: null, outside: true };
    const sl = t.slope(lat, lon, 1);
    return { lat, lon, h: hz.h0, slope: sl ? sl.deg : null, elev: hz.elev, hfn: Terrain.horizonFn(hz) };
  }
  function series(model, t0, hours, stepH) {
    const SS = Planner.sampleEphem(S.eph, t0, hours, stepH || 1);
    return Planner.siteSeries(SS, model.lat, model.lon, model.h, model.hfn);
  }
  function stats(ser, i0, i1) {
    i0 = i0 || 0; i1 = i1 == null ? ser.n : i1; const n = i1 - i0, st = ser.stepH;
    let lit = 0, comm = 0, both = 0, E = 0;
    for (let k = i0; k < i1; k++) {
      lit += ser.lit[k]; comm += ser.comm[k]; if (ser.lit[k] > 0.5 && ser.comm[k]) both++;
      E += ser.flux[k] * 0.3 * ser.lit[k] * Math.max(0, Math.cos(ser.sunAlt[k] * Math.PI / 180)) * st;
    }
    return { litPct: 100 * lit / n, commPct: 100 * comm / n, bothPct: 100 * both / n, meanW: E / (n * st), energyKWh: E / 1000,
      darkH: Planner.longestRun(ser.lit, (v) => v < 0.01, st, i0, i1), gapH: Planner.longestRun(ser.comm, (v) => v === 0, st, i0, i1) };
  }
  const clampT = (t) => Math.min(Math.max(t, S.range[0]), S.range[1] - HOUR);

  // ------------------------------------------------------------------ lander settings (shared)
  const PRESETS = {
    small: { cap: 1500, load: 60, area: 1, eff: 30 },
    medium: { cap: 5000, load: 200, area: 3, eff: 30 },
    large: { cap: 20000, load: 600, area: 8, eff: 30 },
  };
  function setPreset(k) {
    const p = PRESETS[k]; $('lCap').value = p.cap; $('lLoad').value = p.load; $('lArea').value = p.area; $('lEff').value = p.eff;
    $$('#presetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === k));
  }
  function lander() {
    const mode = $$('#panelSeg button').find((b) => b.classList.contains('on')).dataset.m;
    return {
      capWh: Math.max(1, +$('lCap').value || 1), loadW: Math.max(0.1, +$('lLoad').value || 0.1), minSoc: (+$('lMin').value || 0) / 100,
      panel: { mode, azimuth: +$('lAz').value || 0, area: Math.max(0.01, +$('lArea').value || 0.01), efficiency: Math.min(0.5, Math.max(0.01, (+$('lEff').value || 30) / 100)) },
    };
  }
  // run the battery over [i0, i1) and, if it fails, find what would fix it
  function batteryReport(ser, L, i0, i1) {
    const gen = Planner.panelPower(ser, L.panel);
    const b = Planner.battery(gen, ser.stepH, L.loadW, L.capWh, L.minSoc, i0, i1);
    const r = { b, gen };
    if (!b.ok) {
      r.needCap = Math.ceil(b.neededCapWh / 100) * 100;
      // panel area that would make it (same battery), if any
      let lo = L.panel.area, hi = L.panel.area, ok = false;
      for (let k = 0; k < 7 && !ok; k++) { hi *= 2; const g2 = gen.map((v) => v * hi / L.panel.area); ok = Planner.battery(g2, ser.stepH, L.loadW, L.capWh, L.minSoc, i0, i1).ok; }
      if (ok) { for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2, g2 = gen.map((v) => v * mid / L.panel.area); if (Planner.battery(g2, ser.stepH, L.loadW, L.capWh, L.minSoc, i0, i1).ok) hi = mid; else lo = mid; } r.needArea = Math.ceil(hi * 10) / 10; }
    }
    return r;
  }
  function batteryHTML(rep, ser, L, i0) {
    const b = rep.b, t0 = ser.t[i0];
    let h = '';
    if (b.ok) h += '<div class="callout ok"><b>✔ الطاقة كافية.</b> أقل شحن بتوصله البطارية <b class="num">' + Math.round(b.minSoc * 100) + '%</b> (الحد المسموح ' + Math.round(L.minSoc * 100) + '%).</div>';
    else {
      const when = new Date(t0 + b.failHour * HOUR);
      h += '<div class="callout bad"><b>✘ الطاقة مش كافية.</b> البطارية بتنزل تحت ' + Math.round(L.minSoc * 100) + '% بعد <b>' + dur(b.failHour) + '</b> من الهبوط (<span class="num">' + isoDate(when) + ' ' + pad2(when.getUTCHours()) + ':00 UTC</span>).<br>' +
        'عشان تنجح المهمة: بطارية ≥ <b class="num">' + rep.needCap.toLocaleString('en-US') + ' Wh</b>' +
        (rep.needArea ? ' أو ألواح ≥ <b class="num">' + rep.needArea + ' m²</b> (مع نفس البطارية)' : '، لأنه في فترة ظلمة طويلة والألواح لحالها ما بتحلّها') +
        '، أو خفّف الاستهلاك.</div>';
    }
    return h;
  }

  // ------------------------------------------------------------------ router
  const VIEWS = ['home', 'explore', 'planner', 'compare', 'ice', 'about'];
  const inited = {};
  function route() {
    let v = (location.hash || '#home').slice(1).split('?')[0]; if (!VIEWS.includes(v)) v = 'home';
    $$('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === v));
    $('nav').classList.remove('open');
    Home.active(v === 'home');
    if (!inited[v]) { inited[v] = true; ({ home: Home.init, explore: Explore.init, planner: Plan.init, compare: Cmp.init, ice: Ice.init, about: About.init })[v](); }
    if (v === 'explore') Explore.shown(); if (v === 'planner') Plan.shown(); if (v === 'compare') Cmp.shown(); if (v === 'ice') Ice.shown();
    window.scrollTo(0, 0);
  }
  const go = (v) => { if (location.hash === '#' + v) route(); else location.hash = '#' + v; };

  // ================================================================== HOME
  const Home = (() => {
    let tex = null, earthTex = null, playing = false, t = Date.now(), rot = 0, raf = null, on = false, last = 0, stars = null;
    function layout() {
      const cv = $('heroCanvas'), W = cv.clientWidth, H = cv.clientHeight;
      const small = W < 980;
      return {
        W, H,
        sun: { x: small ? W * 0.02 : -W * 0.03, y: H * (small ? 0.62 : 0.34), r: H * (small ? 0.12 : 0.17) },
        moon: { x: small ? W * 0.5 : W * 0.38, y: H * (small ? 0.68 : 0.53), r: Math.min(H * (small ? 0.2 : 0.28), W * (small ? 0.3 : 0.2)) },
        earth: { x: small ? W * 0.84 : W * 0.66, y: H * (small ? 0.86 : 0.76), r: Math.min(H, W) * (small ? 0.06 : 0.075) },
      };
    }
    function drawScene() {
      const cv = $('heroCanvas'); if (!cv.clientWidth) return;
      if (!stars || stars.w !== cv.clientWidth || stars.h !== cv.clientHeight) {
        const sc = document.createElement('canvas'); Sky.stars(sc, { density: 2200, W: cv.clientWidth, H: cv.clientHeight });
        stars = { c: sc, w: cv.clientWidth, h: cv.clientHeight };
        const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
      }
      const L = layout(), g = cv.getContext('2d'), dpr = cv.width / L.W;
      g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(stars.c, 0, 0, cv.width, cv.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // orbit lines
      g.strokeStyle = 'rgba(214,164,81,0.22)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse((L.moon.x + L.earth.x) / 2, (L.moon.y + L.earth.y) / 2 - L.H * 0.04, Math.abs(L.earth.x - L.moon.x) * 0.72, L.H * 0.16, -0.32, 0, 7); g.stroke();
      g.strokeStyle = 'rgba(194,184,200,0.10)';
      g.beginPath(); g.ellipse(L.W * 0.52, L.H * 0.56, L.W * 0.52, L.H * 0.36, -0.12, 0, 7); g.stroke();
      Sky.sun(g, L.sun.x, L.sun.y, L.sun.r, performance.now() / 1000);
      if (tex) {
        const lv = (b) => Sky.norm([L.sun.x - b.x, -(L.sun.y - b.y), Math.hypot(L.sun.x - b.x, L.sun.y - b.y) * 0.32]);
        Sky.sphere(g, L.moon.x, L.moon.y, L.moon.r, tex, { kind: 'moon', basis: Sky.basisFromAngles(rot, -24), lightView: lv(L.moon) });
        if (earthTex) Sky.sphere(g, L.earth.x, L.earth.y, L.earth.r, earthTex, { kind: 'earth', basis: Sky.basisFromAngles(rot * 6 + 30, 18), lightView: lv(L.earth) });
      }
      const place = (id, b, dx, dy) => { const el = $(id); el.style.left = (b.x + dx) + 'px'; el.style.top = (b.y + dy) + 'px'; };
      place('lblSun', { x: Math.max(L.sun.x, 0) + L.sun.r * 0.6, y: L.sun.y }, 0, L.sun.r * 0.9);
      place('lblMoon', L.moon, L.moon.r * 0.62, -L.moon.r * 0.95);
      place('lblEarth', L.earth, -L.earth.r * 0.4, L.earth.r + 8);
    }
    function moonCard() {
      if (!S.eph) return;
      const tt = clampT(t), g = S.eph.at(tt), e = g.earth, en = Math.hypot(e[0], e[1], e[2]), eh = [e[0] / en, e[1] / en, e[2] / en];
      const cosA = Sky.dot(g.sun, eh), k = (1 + cosA) / 2;
      const g2 = S.eph.at(clampT(tt + 6 * HOUR)), e2 = g2.earth, en2 = Math.hypot(e2[0], e2[1], e2[2]);
      const k2 = (1 + Sky.dot(g2.sun, [e2[0] / en2, e2[1] / en2, e2[2] / en2])) / 2, waxing = k2 > k;
      const name = k < 0.03 ? 'محاق' : k < 0.35 ? (waxing ? 'هلال متزايد' : 'هلال متناقص') : k < 0.65 ? (waxing ? 'تربيع أول' : 'تربيع أخير') : k < 0.97 ? (waxing ? 'أحدب متزايد' : 'أحدب متناقص') : 'بدر';
      $('phaseName').textContent = name;
      $('hcIllum').textContent = (k * 100).toFixed(0) + '%';
      $('hcDist').textContent = Math.round(en).toLocaleString('en-US') + ' km';
      $('hcPoleSun').textContent = (Math.asin(-g.sun[2]) * 180 / Math.PI).toFixed(2) + '°';
      const cv = $('phaseCanvas'); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = 54 * dpr; cv.height = 54 * dpr;
      const gc = cv.getContext('2d'); gc.setTransform(dpr, 0, 0, dpr, 0, 0); gc.clearRect(0, 0, 54, 54);
      if (tex) Sky.sphere(gc, 27, 27, 26, tex, { kind: 'moon', basis: Sky.basisFromView(eh, [0, 0, 1]), light: g.sun, ambient: 0.04 });
      const d = new Date(t);
      $('heroDate').textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      $('heroClock').textContent = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }
    function loop(ts) {
      raf = null; if (!on) return;
      if (ts - last > 110 && !document.hidden) {
        const dt = Math.min(0.2, (ts - last) / 1000); last = ts;
        rot += dt * 3;
        if (playing) { t = clampT(t + dt * 4 * DAY); if (t >= S.range[1] - 2 * HOUR) t = S.range[0]; moonCard(); }
        drawScene();
      }
      raf = requestAnimationFrame(loop);
    }
    async function miniMap() {
      await loadGrid();
      const m = new PolarMap($('homeMap'), { interactive: true, onClick: (p) => { Explore.openAt(p.lat, p.lon, placeName(p.lat, p.lon)); } });
      const G = S.grid;
      m.add(PolarMap.raster(G.meta, G.lit, (v, k) => {
        if (v === 255) return null;
        if (G.maxLit[k] === 0) return [40, 60, 110, 150];
        const sl = G.slope4[k] / 4, e = G.earth[k];
        if (v >= 50 && e >= 50 && sl <= 8) return [82, 196, 142, 175];
        if (v >= 30 && sl <= 15) return [227, 179, 65, 140];
        return [224, 96, 94, 70];
      }, 0.85));
      m.add(PolarMap.psr(S.ice, { labels: false }));
      m.add(PolarMap.graticule());
      m.add(PolarMap.markers(() => S.sites.map((s) => ({ lat: s.lat, lon: s.lon, label: s.name, color: '#c2b8c8', r: 4.5 }))));
      let best = 0; for (let k = 0; k < G.lit.length; k++) if (G.lit[k] !== 255 && G.lit[k] > best) best = G.lit[k];
      $('stLit').textContent = best + '%';
      $('stIce').textContent = S.ice.psr.length;
    }
    return {
      async init() {
        Promise.all([Sky.texture('img/moon.jpg?v=1', 2048), Sky.texture('img/earth.jpg?v=1', 1024)]).then(([a, b]) => { tex = a; earthTex = b; moonCard(); drawScene(); }).catch((e) => console.warn(e));
        $('heroPlay').onclick = () => { playing = !playing; $('heroPlay').innerHTML = playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>'; };
        window.addEventListener('resize', () => { stars = null; drawScene(); });
        moonCard(); miniMap().catch((e) => console.warn(e));
      },
      active(v) { on = v; if (on && !raf) raf = requestAnimationFrame(loop); },
    };
  })();

  // ================================================================== 3D EXPLORER
  const Explore = (() => {
    let viewer = null, tileset = null, light = null, ready = null, tNow = Date.now(), sel = null, marker = null, lastSer = null, lastRose = null;
    let siteEnts = [], iceEnts = [], topEnts = [], pendingOpen = null, playTimer = null, curTab = 'light';
    const MOON = () => Cesium.Ellipsoid.MOON;
    const deg = (lon, lat, h) => Cesium.Cartesian3.fromDegrees(lon, lat, h, MOON());
    const status = (t) => { $('status').textContent = t || ''; $('status').classList.toggle('hidden', !t); };
    const err = (h) => { $('err').innerHTML = h; $('err').style.display = 'block'; };
    const redraw = () => viewer && viewer.scene.requestRender();

    function loadCesium() {
      if (window.Cesium) return Promise.resolve();
      return new Promise((res, rej) => {
        window.CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1/Build/Cesium/';
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = window.CESIUM_BASE_URL + 'Widgets/widgets.css'; document.head.appendChild(l);
        const s = document.createElement('script'); s.src = window.CESIUM_BASE_URL + 'Cesium.js'; s.onload = res; s.onerror = () => rej(new Error('Cesium.js')); document.head.appendChild(s);
      });
    }
    async function boot() {
      status('جاري تحميل القمر…');
      const token = (window.CESIUM_ION_TOKEN || '').trim();
      try { await loadCesium(); } catch (e) { status(''); err('ما قدرت أحمّل مكتبة Cesium. تأكد من الإنترنت وحدّث الصفحة.'); return; }
      if (!token || token.startsWith('PASTE')) { status(''); err('لازم مفتاح Cesium ion بملف <code>config.js</code> عشان يشتغل القمر ثلاثي الأبعاد.'); return; }
      Cesium.Ion.defaultAccessToken = token;
      Cesium.Ellipsoid.default = MOON();
      viewer = new Cesium.Viewer('cesium', {
        globe: false, baseLayer: false, baseLayerPicker: false, geocoder: false, sceneModePicker: false, homeButton: false, navigationHelpButton: false,
        timeline: false, animation: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, skyAtmosphere: false,
        requestRenderMode: true, maximumRenderTimeChange: Infinity, targetFrameRate: 30,
      });
      viewer.resolutionScale = 0.85;
      if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) viewer.scene.postProcessStages.fxaa.enabled = false;
      if (!viewer.scene.skyBox && Cesium.SkyBox && Cesium.SkyBox.createEarthSkyBox) viewer.scene.skyBox = Cesium.SkyBox.createEarthSkyBox();
      if (viewer.scene.sun) viewer.scene.sun.show = false; if (viewer.scene.moon) viewer.scene.moon.show = false;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0d0a11');
      light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.clone(viewer.scene.camera.directionWC), intensity: 2.2 });
      viewer.scene.light = light;
      viewer.scene.preRender.addEventListener((scene) => { if (!$('sunLight').checked) light.direction = Cesium.Cartesian3.clone(scene.camera.directionWC, light.direction); });
      try {
        tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2684829, { maximumScreenSpaceError: 24, cacheBytes: 192 * 1024 * 1024, maximumCacheOverflowBytes: 64 * 1024 * 1024, dynamicScreenSpaceError: true, foveatedScreenSpaceError: true, preloadFlightDestinations: false });
        viewer.scene.primitives.add(tileset);
      } catch (e) { console.error(e); status(''); err('ما قدرت أحمّل قمر Cesium. تأكد إنه <b>Cesium Moon</b> مضاف لحسابك وإنه المفتاح صحيح.<br><code>' + esc(e.message || e) + '</code>'); return; }
      tileset.loadProgress.addEventListener((p, q) => status(p + q > 0 ? 'جاري تحميل التفاصيل… (' + (p + q) + ')' : ''));
      tileset.allTilesLoaded.addEventListener(() => status(''));
      // markers
      const pt = (lon, lat, name, color, extra, size) => viewer.entities.add(Object.assign({
        position: deg(lon, lat, 2500),
        point: { pixelSize: size || 9, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.fromCssColorString('#120f17'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: name ? { text: name, font: '600 13px "IBM Plex Sans Arabic", "Space Grotesk", Arial', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, translucencyByDistance: new Cesium.NearFarScalar(3e5, 1, 1.6e6, 0) } : undefined,
      }, extra || {}));
      pt(0, -90, 'القطب الجنوبي', '#ff8f7a');
      siteEnts = S.sites.map((s) => { const e = pt(s.lon, s.lat, s.name, '#c2b8c8'); e.siteId = s.id; return e; });
      iceEnts = S.ice.psr.filter((p) => p.m3 >= 5).map((p) => { const e = pt(p.lon, p.lat, p.name ? p.name + ' ❄' : '❄', '#7fc3ff', null, 7); e.iceId = p.id; return e; });
      refreshTop();
      $$('[data-cam]').forEach((b) => (b.onclick = () => cam[b.dataset.cam]()));
      try { await viewer.zoomTo(tileset); } catch (e) { /* ignore */ }
      if (!pendingOpen) setTimeout(cam.pole, 900);
      // picking
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      let mt = null;
      handler.setInputAction((m) => { const pos = Cesium.Cartesian2.clone(m.endPosition); clearTimeout(mt); mt = setTimeout(() => hover(pos), 140); }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      handler.setInputAction((m) => {
        const hit = viewer.scene.pick(m.position);
        if (hit && hit.id && hit.id.siteId) { const s = S.sites.find((x) => x.id === hit.id.siteId); return open(s.lat, s.lon, s.name, s); }
        if (hit && hit.id && hit.id.iceId != null) { const p = S.ice.psr[hit.id.iceId]; return open(p.lat, p.lon, iceName(p)); }
        if (hit && hit.id && hit.id.topIdx != null) { const r = S.top[hit.id.topIdx]; return open(r.lat, r.lon, 'الموقع المقترح ' + (hit.id.topIdx + 1)); }
        const p = pickLL(m.position); if (p) open(p.lat, p.lon, null);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      setTime(Date.now());
      if (pendingOpen) { const o = pendingOpen; pendingOpen = null; open(o.lat, o.lon, o.name, o.site); }
    }
    const fly = (lon, lat, h, pitch, heading) => viewer.camera.flyTo({ destination: deg(lon, lat, h), orientation: { heading: Cesium.Math.toRadians(heading || 0), pitch: Cesium.Math.toRadians(pitch), roll: 0 }, duration: 2.2 });
    const cam = {
      global: () => fly(0, -20, 6000000, -90),
      pole: () => fly(0, -80, 260000, -35, 180),
      top: () => fly(0, -90, 230000, -90),
      site: (lat, lon) => fly(lon, Math.min(lat + 0.5, -80), 24000, -40, 180),
    };
    function pickLL(pos) {
      if (!viewer.scene.pickPositionSupported) return null;
      const c3 = viewer.scene.pickPosition(pos); if (!Cesium.defined(c3)) return null;
      const c = Cesium.Cartographic.fromCartesian(c3, MOON()); if (!c) return null;
      return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), h: c.height };
    }
    function hover(pos) {
      const p = pickLL(pos);
      if (!p) { ['rLat', 'rLon', 'rElev', 'rSlope'].forEach((i) => ($(i).textContent = '—')); return; }
      $('rLat').textContent = fmtLat(p.lat); $('rLon').textContent = fmtLon(p.lon);
      const h = S.terrain ? S.terrain.height(p.lat, p.lon) : NaN;
      $('rElev').textContent = Math.round(isNaN(h) ? p.h : h).toLocaleString('en-US') + ' m';
      const sl = S.terrain ? S.terrain.slope(p.lat, p.lon, 1) : null; $('rSlope').textContent = sl ? sl.deg.toFixed(1) + '°' : '—';
    }
    function refreshTop() {
      if (!viewer) return;
      topEnts.forEach((e) => viewer.entities.remove(e)); topEnts = [];
      S.top.forEach((r, i) => {
        const e = viewer.entities.add({ position: deg(r.lon, r.lat, 2500),
          point: { pixelSize: 14, color: Cesium.Color.fromCssColorString('#d6a451'), outlineColor: Cesium.Color.fromCssColorString('#120f17'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: { text: String(i + 1), font: '700 12px "Space Grotesk", Arial', fillColor: Cesium.Color.fromCssColorString('#1d1408'), disableDepthTestDistance: Number.POSITIVE_INFINITY, verticalOrigin: Cesium.VerticalOrigin.CENTER },
          show: $('lyTop').checked });
        e.topIdx = i; topEnts.push(e);
      });
      redraw();
    }
    function updateLight() {
      if (!viewer) return;
      if ($('sunLight').checked && S.eph) { const s = S.eph.at(tNow).sun; light.direction = new Cesium.Cartesian3(-s[0], -s[1], -s[2]); }
      redraw();
    }
    function setShadows(on) {
      try { viewer.shadows = on; tileset.shadows = on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
        if (on && viewer.shadowMap) { viewer.shadowMap.softShadows = false; viewer.shadowMap.size = 2048; viewer.shadowMap.maximumDistance = 300000; viewer.shadowMap.darkness = 0.15; } } catch (e) { console.warn(e); }
      redraw();
    }
    function setTime(t) {
      tNow = clampT(Math.floor(t / HOUR) * HOUR);
      $('dateIn').value = isoDate(tNow); $('hourIn').value = new Date(tNow).getUTCHours(); $('clock').textContent = pad2(new Date(tNow).getUTCHours()) + ':00 UTC';
      updateLight(); if (sel) nowPanel();
    }

    // ---------------- selection
    async function open(lat, lon, name, site) {
      if (!viewer) { pendingOpen = { lat, lon, name, site }; return; }
      if (marker) viewer.entities.remove(marker);
      marker = viewer.entities.add({ position: deg(lon, lat, 2500), point: { pixelSize: 13, color: Cesium.Color.fromCssColorString('#ffd98a'), outlineColor: Cesium.Color.fromCssColorString('#120f17'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      cam.site(lat, lon);
      sel = { lat, lon, name: name || placeName(lat, lon), site: site || null };
      $('dTitle').textContent = sel.name; $('dCoords').textContent = fmtLL(lat, lon);
      $('dEmpty').classList.add('hidden'); $('dBody').classList.remove('hidden');
      $('dElev').textContent = '…';
      sel.model = await siteModel(lat, lon);
      const m = sel.model;
      $('dElev').textContent = m.flat ? '—' : Math.round(m.h).toLocaleString('en-US') + ' m';
      $('dSlope').innerHTML = m.slope == null ? '—' : m.slope.toFixed(1) + '° ' + (m.slope > 15 ? tag('risky', 'شديد') : m.slope > 8 ? tag('caution', 'متوسط') : tag('safe', 'مريح'));
      $('dPole').textContent = ((90 + lat) * Math.PI / 180 * R_KM).toFixed(1) + ' km';
      const ni = nearestIce(lat, lon, 1); $('dIce').textContent = ni ? (ni.km < 0.05 ? 'داخل ' : ni.km.toFixed(1) + ' km · ') + iceName(ni.p) : '—';
      lastRose = null; nowPanel();
      if ($('sheet').classList.contains('open')) analyse();
    }
    function nowPanel() {
      if (!sel || !sel.model || !S.eph) return;
      const m = sel.model, ser = series(m, tNow, 1, 1), k = 0;
      const sAlt = ser.sunAlt[k], sAz = ser.sunAz[k], lit = ser.lit[k], eAlt = ser.earthAlt[k], eAz = ser.earthAz[k];
      $('dSun').textContent = sAlt.toFixed(2) + '° / ' + sAz.toFixed(0) + '°';
      $('dSunState').innerHTML = lit >= 0.999 ? tag('safe', 'مضاء') : lit > 0 ? tag('caution', 'جزئي ' + Math.round(lit * 100) + '%') : tag('risky', sAlt > 0 ? 'محجوبة بالجبال' : 'تحت الأفق');
      $('dEarth').textContent = eAlt.toFixed(2) + '° / ' + eAz.toFixed(0) + '°';
      $('dEarthState').innerHTML = ser.comm[k] ? tag('safe', 'اتصال متاح') : tag('risky', eAlt > 0 ? 'محجوبة بالجبال' : 'تحت الأفق');
      const P = ser.flux[k] * 0.3 * lit * Math.cos(sAlt * Math.PI / 180);
      $('dPower').textContent = Math.round(P) + ' W/m²';
      compass(sAz, eAz, lit, ser.comm[k], lastRose ? lastRose.bestAz : null);
      earthView(m, eAlt, ser.comm[k]);
    }
    function compass(sAz, eAz, lit, comm, bestAz) {
      const cv = $('compass'), { g, W, H } = Charts.setup(cv, 118), cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14;
      g.strokeStyle = 'rgba(194,184,200,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, R * 0.55, 0, 7); g.stroke();
      const P = (az, f) => [cx + Math.sin(az * Math.PI / 180) * R * f, cy - Math.cos(az * Math.PI / 180) * R * f];
      g.fillStyle = '#a79db0'; g.font = '600 10px "Space Grotesk", Arial'; g.textAlign = 'center';
      for (const [az, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) { const [x, y] = P(az, 1.2); g.fillText(l, x, y + 4); }
      if (bestAz != null) { const [bx, by] = P(bestAz, 0.85); g.setLineDash([3, 3]); g.strokeStyle = 'rgba(214,164,81,0.7)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(bx, by); g.stroke(); g.setLineDash([]); }
      // panel (perpendicular bar) facing the Sun
      const [sx, sy] = P(sAz, 0.92); g.strokeStyle = lit > 0 ? '#ffd98a' : 'rgba(255,217,138,0.35)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(sx, sy); g.stroke();
      g.save(); g.translate(cx, cy); g.rotate(sAz * Math.PI / 180); g.fillStyle = '#c2b8c8'; g.fillRect(-13, -3, 26, 6); g.restore();
      g.fillStyle = lit > 0 ? '#ffd98a' : '#6a5f55'; g.shadowColor = '#ffb84d'; g.shadowBlur = lit > 0 ? 10 : 0; g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill(); g.shadowBlur = 0;
      const [ex, ey] = P(eAz, 0.92); g.fillStyle = comm ? '#6fa8dc' : 'rgba(111,168,220,0.35)'; g.beginPath(); g.arc(ex, ey, 5, 0, 7); g.fill();
    }
    let earthTex = null;
    function earthView(m, eAlt, comm) {
      const cv = $('earthView'); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = 64 * dpr; cv.height = 64 * dpr;
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, 64, 64);
      const gg = S.eph.at(tNow), e = gg.earth, en = Math.hypot(e[0], e[1], e[2]), eh = [e[0] / en, e[1] / en, e[2] / en];
      const k = (1 - Sky.dot(gg.sun, eh)) / 2;
      // view basis at the site: looking at Earth, zenith up
      const f = m.lat * Math.PI / 180, l = m.lon * Math.PI / 180, up = [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
      const F = [-eh[0], -eh[1], -eh[2]], B = Sky.basisFromView(F, up), s = gg.sun;
      const Lv = [Sky.dot(s, B.R), Sky.dot(s, B.U), Sky.dot(s, B.F)];
      const draw = () => { g.clearRect(0, 0, 64, 64); Sky.sphere(g, 32, 32, 22, earthTex, { kind: 'earth', basis: Sky.basisFromAngles(-Sky.gmst(tNow), 10), lightView: Lv }); if (!comm) { g.fillStyle = 'rgba(21,18,26,0.55)'; g.fillRect(0, 0, 64, 64); } };
      if (earthTex) draw(); else Sky.texture('img/earth.jpg?v=1', 512).then((t) => { earthTex = t; draw(); });
      const ph = k < 0.03 ? 'أرض جديدة (معتمة)' : k < 0.35 ? 'هلال أرضي' : k < 0.65 ? 'نصف مضاءة' : k < 0.97 ? 'أحدب' : 'بدر أرضي كامل';
      $('earthNote').innerHTML = 'الأرض من هون: <b>' + ph + '</b> (<span class="num">' + Math.round(k * 100) + '%</span> مضاءة). ' +
        (comm ? 'ظاهرة فوق الأفق، فالاتصال المباشر ممكن.' : eAlt > 0 ? 'فوق الأفق بس الجبال حاجبتها.' : 'تحت الأفق هلأ.');
    }

    // ---------------- full analysis sheet
    function periodRange() {
      const v = $('period').value;
      if (v === 'all') return [S.range[0], Math.floor((S.range[1] - S.range[0]) / HOUR) - 1];
      const t0 = clampT(Date.parse(isoDate(tNow) + 'T00:00:00Z')); const h = Math.min(+v, Math.floor((S.range[1] - t0) / HOUR) - 1); return [t0, h];
    }
    function analyse() {
      if (!sel || !sel.model) return;
      $('sheet').classList.add('open');
      const [t0, hours] = periodRange(), st = hours > 9000 ? 2 : 1;
      const ser = series(sel.model, t0, hours, st); lastSer = ser;
      const a = stats(ser);
      $('sTitle').textContent = sel.name; $('sSub').textContent = isoDate(t0) + ' → ' + isoDate(t0 + hours * HOUR);
      $('mLit').innerHTML = pct(a.litPct); $('mDark').innerHTML = durNum(a.darkH); $('mPow').innerHTML = Math.round(a.meanW) + ' <small>W/m²</small>';
      $('mComm').innerHTML = pct(a.commPct); $('mGap').innerHTML = durNum(a.gapH); $('mBoth').innerHTML = pct(a.bothPct);
      const gs = gridAt(sel.lat, sel.lon);
      Charts.horizon($('cHorizon'), sel.model.elev, ser, { sunAz: ser.sunAz[0], sunAlt: ser.sunAlt[0], earthAz: ser.earthAz[0], earthAlt: ser.earthAlt[0] }, { height: 180 });
      Charts.timeline($('cTimeline'), ser, { height: 180 });
      // panels
      const L = lander();
      const rose = Planner.panelRose(ser, { area: 1, efficiency: 0.3 }); lastRose = rose;
      Charts.rose($('cRose'), rose, ser.sunAz[0], 260);
      const fx = 100 * rose.bestWh / Math.max(1, rose.trackWh), two = 100 * rose.twoFacedWh / Math.max(1, rose.trackWh);
      $('pTrack').innerHTML = (rose.trackWh / 1000).toFixed(0) + ' <small>kWh/m²</small>'; $('pFixed').innerHTML = fx.toFixed(0) + '<small>%</small>'; $('pFixedAz').textContent = 'باتجاه ' + rose.bestAz + '° من الشمال';
      $('pTwo').innerHTML = two.toFixed(0) + '<small>%</small>';
      const dirAr = (az) => ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'][Math.round(az / 45) % 8];
      $('panelAdvice').innerHTML = '<b>التوصية:</b> لوح عمودي بيلف مع الشمس (بيلحق سمتها) بيعطي أعلى طاقة. إذا لازم يكون اللوح ثابت، وجّهه نحو <b>' + dirAr(rose.bestAz) + '</b> (السمت <b class="num">' + rose.bestAz + '°</b>)، وبيعطيك تقريباً <b class="num">' + fx.toFixed(0) + '%</b> من طاقة اللوح المتحرك. لوحين ظهر لظهر بنفس الاتجاه بيوصلوا <b class="num">' + two.toFixed(0) + '%</b>.' +
        '<br><span class="muted">الشمس هلأ بالسمت <span class="num">' + ser.sunAz[0].toFixed(0) + '°</span>، فاللوح المتحرك لازم يكون موجّه لهناك.</span>';
      renderBattery(); renderIceNear(); renderGeo();
      nowPanel();
      setTimeout(() => { Charts.horizon($('cHorizon'), sel.model.elev, ser, { sunAz: ser.sunAz[0], sunAlt: ser.sunAlt[0], earthAz: ser.earthAz[0], earthAlt: ser.earthAlt[0] }, { height: 180 }); Charts.timeline($('cTimeline'), ser, { height: 180 }); }, 30);
    }
    function renderBattery() {
      const L = lander(), box = $('batteryBox');
      box.innerHTML = '<div class="grid3" style="grid-template-columns:repeat(5,1fr)">' +
        '<label class="fld"><span>البطارية (Wh)</span><input type="number" class="inp" id="bxCap" value="' + L.capWh + '"></label>' +
        '<label class="fld"><span>الاستهلاك (W)</span><input type="number" class="inp" id="bxLoad" value="' + L.loadW + '"></label>' +
        '<label class="fld"><span>الألواح (m²)</span><input type="number" class="inp" id="bxArea" value="' + L.panel.area + '"></label>' +
        '<label class="fld"><span>مدة المهمة (يوم)</span><input type="number" class="inp" id="bxDays" value="' + $('pDays').value + '"></label>' +
        '<div style="display:flex;align-items:flex-end"><button class="btn gold" id="bxRun" style="width:100%">احسب</button></div></div><div id="bxOut" style="margin-top:12px"></div>';
      const run = () => {
        $('lCap').value = $('bxCap').value; $('lLoad').value = $('bxLoad').value; $('lArea').value = $('bxArea').value; $('pDays').value = $('bxDays').value; $('pDays').oninput();
        const L2 = lander(), days = Math.max(1, +$('bxDays').value || 14), t0 = clampT(Date.parse(isoDate(tNow) + 'T00:00:00Z'));
        const ser = series(sel.model, t0, days * 24, 1), rep = batteryReport(ser, L2, 0, ser.n);
        const a = stats(ser);
        $('bxOut').innerHTML = batteryHTML(rep, ser, L2, 0) +
          '<div class="metrics" style="grid-template-columns:repeat(4,1fr); margin-top:10px"><div class="metric"><div class="lab">طاقة داخلة</div><div class="val">' + (rep.b.energyInWh / 1000).toFixed(1) + ' <small>kWh</small></div></div>' +
          '<div class="metric"><div class="lab">طاقة مستهلكة</div><div class="val">' + (rep.b.energyOutWh / 1000).toFixed(1) + ' <small>kWh</small></div></div>' +
          '<div class="metric"><div class="lab">الشمس ظاهرة</div><div class="val">' + pct(a.litPct) + '</div></div><div class="metric"><div class="lab">أطول ظلمة</div><div class="val">' + durNum(a.darkH) + '</div></div></div>' +
          '<div class="muted small" style="margin:12px 0 4px">شحن البطارية من تاريخ الهبوط <span class="num">' + isoDate(t0) + '</span> (التاريخ من شريط الوقت تحت)</div><canvas class="chart" id="bxSoc"></canvas>';
        Charts.soc($('bxSoc'), [{ soc: rep.b.soc, stepH: 1, t0, color: '#d6a451' }], L2.minSoc, { height: 150 });
      };
      $('bxRun').onclick = run; run();
    }
    function renderIceNear() {
      const [x, y] = Planner.ll2xy(sel.lat, sel.lon);
      const rows = S.ice.psr.map((p, i) => ({ p, d: S.iceMap.distanceOne(i, x, y) })).sort((a, b) => a.d - b.d).slice(0, 6);
      $('iceNear').innerHTML = '<table class="tbl"><tr><th>المنطقة</th><th>المسافة</th><th>رصدات الجليد</th><th>المساحة</th><th>الحرارة (أعلى)</th><th></th></tr>' +
        rows.map((r) => '<tr><td>' + esc(iceName(r.p)) + '</td><td class="num">' + (r.d < 0.05 ? 'داخلها' : r.d.toFixed(1) + ' km') + '</td><td class="num">' + r.p.m3 + '</td><td class="num">' + r.p.area_km2 + ' km²</td><td class="num">' + (r.p.T_max ? Math.round(r.p.T_max) + ' K' : '—') + '</td>' +
          '<td><button class="btn sm" data-ice="' + r.p.id + '">على الخريطة</button></td></tr>').join('') + '</table>' +
        '<p class="note">المسافة لأقرب حافة لمنطقة الظل الدائم (خط مستقيم). الحرارة السنوية من Diviner: الجليد بيضل ثابت على السطح تحت تقريباً 110 كلفن.</p>';
      $$('#iceNear [data-ice]').forEach((b) => (b.onclick = () => { go('ice'); setTimeout(() => Ice.select(+b.dataset.ice), 60); }));
    }
    function renderGeo() {
      const s = sel.site; let h = '';
      if (s) h += '<h3 style="margin-top:0">الجيولوجيا (من فريق الجيولوجيا)</h3><p class="note"><b>التضاريس:</b> ' + s.terrain + '<br><b>الصخور:</b> ' + s.rock + '<br><b>ملاحظة الهبوط:</b> ' + s.landing + '</p>';
      $('geoBox').innerHTML = h + '<div id="rockMix" class="note">…</div>';
      loadRocks().then((rm) => {
        if (!rm) return;
        const r = rm.at(sel.lat, sel.lon);
        if (!r) { $('rockMix').textContent = 'النقطة خارج خريطة الكيمياء.'; return; }
        const MIX = [{ k: 'anorthosite', ar: 'أنورثوسيت (فاتح، غني بالفلسبار)', c: '#e9e4d6' }, { k: 'mafic', ar: 'بازلت / نوريت (غني بالحديد)', c: '#6b6f80' }, { k: 'kreep', ar: 'KREEP (غني بالثوريوم)', c: '#d6a451' }];
        $('rockMix').innerHTML = '<h3>التركيب الصخري التقديري من المدار</h3><div style="display:flex;height:16px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">' + MIX.map((m) => '<span style="width:' + r[m.k].toFixed(1) + '%;background:' + m.c + '"></span>').join('') + '</div>' +
          '<div class="legend" style="margin-top:8px">' + MIX.map((m) => '<span><i style="background:' + m.c + '"></i>' + m.ar + ' <b class="num">' + Math.round(r[m.k]) + '%</b></span>').join('') + '</div>' +
          '<p class="note">FeO <span class="num">' + r.FeO.toFixed(1) + ' wt%</span> · Th <span class="num">' + r.Th.toFixed(2) + ' ppm</span>، من مطياف أشعة غاما على Lunar Prospector. الدقة حوالي 45 كم، يعني هاي نسب المنطقة بشكل عام، مش صخرة بعينها. <a href="data/rocks/south_pole_rock_mix.csv" download>تنزيل الجدول (CSV)</a></p>';
      });
    }
    function setTab(t) {
      curTab = t; $$('#sheetTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      $$('#sheet [data-p]').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t));
      if (t === 'light' && lastSer) { Charts.horizon($('cHorizon'), sel.model.elev, lastSer, { sunAz: lastSer.sunAz[0], sunAlt: lastSer.sunAlt[0], earthAz: lastSer.earthAz[0], earthAlt: lastSer.earthAlt[0] }, { height: 180 }); Charts.timeline($('cTimeline'), lastSer, { height: 180 }); }
      if (t === 'panel' && lastRose && lastSer) Charts.rose($('cRose'), lastRose, lastSer.sunAz[0], 260);
    }

    return {
      init() {
        $('siteSel').innerHTML = '<option value="">— اختار —</option>' + S.sites.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
        $('siteSel').onchange = () => { const s = S.sites.find((x) => x.id === $('siteSel').value); if (s) open(s.lat, s.lon, s.name, s); };
        $('dateIn').min = isoDate(S.range[0]); $('dateIn').max = isoDate(S.range[1] - HOUR);
        $('dateIn').onchange = () => setTime(Date.parse($('dateIn').value + 'T00:00:00Z') + (+$('hourIn').value) * HOUR);
        $('hourIn').oninput = () => setTime(Date.parse(isoDate(tNow) + 'T00:00:00Z') + (+$('hourIn').value) * HOUR);
        $('btnNow').onclick = () => setTime(Date.now());
        $('btnPlay').onclick = () => {
          if (playTimer) { clearInterval(playTimer); playTimer = null; $('btnPlay').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>'; return; }
          $('btnPlay').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
          playTimer = setInterval(() => setTime(tNow + 3 * HOUR), 220);
        };
        $('sunLight').onchange = () => { if (!$('sunLight').checked && $('shadows').checked) { $('shadows').checked = false; setShadows(false); } updateLight(); };
        $('shadows').onchange = () => { if ($('shadows').checked && !$('sunLight').checked) { $('sunLight').checked = true; updateLight(); } setShadows($('shadows').checked); };
        $('hiQ').onchange = () => { if (!tileset) return; tileset.maximumScreenSpaceError = $('hiQ').checked ? 8 : 24; viewer.resolutionScale = $('hiQ').checked ? 1 : 0.85; redraw(); };
        $('lySites').onchange = () => { siteEnts.forEach((e) => (e.show = $('lySites').checked)); redraw(); };
        $('lyIce').onchange = () => { iceEnts.forEach((e) => (e.show = $('lyIce').checked)); redraw(); };
        $('lyTop').onchange = () => { topEnts.forEach((e) => (e.show = $('lyTop').checked)); redraw(); };
        $('btnAnalyse').onclick = () => { setTab('light'); analyse(); };
        $('btnToBattery').onclick = () => { analyse(); setTab('battery'); };
        $('btnToCompare').onclick = () => { if (!sel) return; S.picks.A = { lat: sel.lat, lon: sel.lon, name: sel.name }; go('compare'); setTimeout(() => Cmp.setSlot('A', 'pick:A'), 50); };
        $('sheetClose').onclick = () => $('sheet').classList.remove('open');
        $('period').onchange = analyse;
        $$('#sheetTabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
        loadTerrain();
        ready = boot();
      },
      shown() { if (viewer) { viewer.resize(); redraw(); } },
      openAt(lat, lon, name, site) { pendingOpen = viewer ? null : { lat, lon, name, site }; go('explore'); if (viewer) setTimeout(() => open(lat, lon, name, site), 80); },
      refreshTop,
    };
  })();

  // ================================================================== PLANNER
  const Plan = (() => {
    let map = null, clsLayer = null, iceLayer = null, picked = null;
    const wLab = (v) => (v <= 0 ? 'مش مهم' : v <= 3 ? 'منخفضة' : v <= 6 ? 'متوسطة' : 'عالية');
    function bindForm() {
      const f = clampT(Date.parse(isoDate(Date.now()) + 'T00:00:00Z'));
      $('pFrom').value = isoDate(f); $('pTo').value = isoDate(clampT(f + 30 * DAY));
      for (const id of ['pFrom', 'pTo', 'bDate', 'cmpFrom']) { $(id).min = isoDate(S.range[0]); $(id).max = isoDate(S.range[1] - DAY); }
      $('pDays').oninput = () => ($('pDaysLab').textContent = $('pDays').value + ' يوم');
      $('lMin').oninput = () => ($('lMinLab').textContent = $('lMin').value + '%');
      $('lAz').oninput = () => ($('lAzLab').textContent = $('lAz').value + '°');
      $('mxSlope').oninput = () => ($('mxSlopeLab').textContent = $('mxSlope').value + '°');
      $('mxIce').oninput = () => ($('mxIceLab').textContent = $('mxIce').value + ' كم');
      for (const k of ['wIce', 'wComm', 'wLit']) $(k).oninput = () => ($(k + 'Lab').textContent = wLab(+$(k).value));
      $$('#presetSeg button').forEach((b) => (b.onclick = () => setPreset(b.dataset.p)));
      for (const id of ['lCap', 'lLoad', 'lArea', 'lEff']) $(id).addEventListener('input', () => $$('#presetSeg button').forEach((b) => b.classList.remove('on')));
      $$('#panelSeg button').forEach((b) => (b.onclick = () => { $$('#panelSeg button').forEach((x) => x.classList.toggle('on', x === b)); $('fixedAzBox').classList.toggle('hidden', b.dataset.m !== 'fixed'); }));
      setPreset('medium');
      $('btnRun').onclick = run;
      $('btnCheck').onclick = check;
      $('bDate').value = $('pFrom').value;
      fillSiteSelect();
    }
    function fillSiteSelect() {
      const opts = [];
      S.top.forEach((r, i) => opts.push(['top:' + i, 'الموقع المقترح ' + (i + 1) + ' · ' + placeName(r.lat, r.lon)]));
      if (picked) opts.push(['pick', 'النقطة اللي اخترتها على الخريطة']);
      S.sites.forEach((s) => opts.push(['site:' + s.id, s.name]));
      const cur = $('bSite').value;
      $('bSite').innerHTML = opts.map(([v, t]) => '<option value="' + v + '">' + esc(t) + '</option>').join('');
      if (opts.some((o) => o[0] === cur)) $('bSite').value = cur;
    }
    function siteFrom(v) {
      if (v.startsWith('top:')) { const r = S.top[+v.slice(4)]; return r && { lat: r.lat, lon: r.lon, name: 'الموقع المقترح ' + (+v.slice(4) + 1), cand: r.i, start: r.startMs }; }
      if (v === 'pick' && picked) return { lat: picked.lat, lon: picked.lon, name: placeName(picked.lat, picked.lon) };
      if (v.startsWith('site:')) { const s = S.sites.find((x) => x.id === v.slice(5)); return s && { lat: s.lat, lon: s.lon, name: s.name, site: s }; }
      return null;
    }
    async function initMap() {
      await Promise.all([loadGrid(), loadCandidates()]);
      const C = S.cand;
      map = new PolarMap($('plMap'), {
        onClick: (p) => { if (Math.abs(p.x) > 160000 || Math.abs(p.y) > 160000) return; picked = { lat: p.lat, lon: p.lon }; fillSiteSelect(); $('bSite').value = 'pick'; map.render(); check(); },
        onHover: (p) => {
          const el = $('plHover'); if (!p || !p.inside) { el.classList.add('hidden'); return; }
          const g = gridAt(p.lat, p.lon); el.classList.remove('hidden');
          el.textContent = fmtLL(p.lat, p.lon) + (g ? '  ·  Sun ' + g.lit + '%  ·  Earth ' + g.earth + '%  ·  slope ' + g.slope.toFixed(0) + '°' + (g.maxLit === 0 ? '  ·  PSR' : '') : '');
        },
      });
      const G = S.grid;
      map.add(PolarMap.raster(G.meta, G.maxLit, (v) => (v === 0 ? [50, 80, 150, 120] : null), 1));
      clsLayer = map.add(PolarMap.classes(C, () => S.cls, 2000));
      iceLayer = map.add(PolarMap.psr(S.ice, { labels: true, lcross: true }));
      map.add(PolarMap.graticule());
      map.add(PolarMap.markers(() => {
        const L = S.sites.map((s) => ({ lat: s.lat, lon: s.lon, label: s.name, color: '#c2b8c8', r: 4 }));
        S.top.forEach((r, i) => L.push({ lat: r.lat, lon: r.lon, num: i + 1, color: '#d6a451', r: 10, halo: 'rgba(214,164,81,0.25)' }));
        if (picked) L.push({ lat: picked.lat, lon: picked.lon, color: '#ffffff', r: 6, label: 'اختيارك' });
        return L;
      }));
      map.add(PolarMap.scaleBar());
      $$('#view-planner .map-tools button').forEach((b) => (b.onclick = () => (b.dataset.z === 'fit' ? map.fit() : map.zoom(b.dataset.z === 'in' ? 0.7 : 1.4))));
    }
    function worker() {
      if (S.workerReady) return S.workerReady;
      S.workerReady = (async () => {
        await loadCandidates();
        const w = new Worker('js/planner-worker.js?v=' + V);
        S.worker = w;
        await new Promise((res, rej) => {
          w.onmessage = (e) => { if (e.data.type === 'ready') res(); if (e.data.type === 'error') rej(new Error(e.data.message)); };
          w.onerror = (e) => rej(new Error(e.message || 'worker'));
          w.postMessage({ type: 'init', ephMeta: S.ephMeta, ephData: S.ephBuf.slice(0), candMeta: S.candMeta, masks: S.masksBuf.slice(0), ice: S.ice });
        });
        return w;
      })();
      return S.workerReady;
    }
    async function run() {
      const from = Date.parse($('pFrom').value + 'T00:00:00Z'), to = Date.parse($('pTo').value + 'T00:00:00Z');
      const days = +$('pDays').value;
      if (!(to >= from)) { $('runMsg').textContent = 'تاريخ النهاية لازم يكون بعد البداية.'; return; }
      if (to + days * DAY > S.range[1]) { $('runMsg').textContent = 'جدول مواقع الشمس والأرض بيغطي لحد نهاية 2030؛ قصّر النافذة أو المدة.'; return; }
      $('btnRun').disabled = true; $('runMsg').textContent = 'جاري تحميل بيانات المواقع…'; $('runProg').style.width = '3%';
      let w; try { w = await worker(); } catch (e) { $('runMsg').textContent = 'صار خطأ: ' + e.message; $('btnRun').disabled = false; return; }
      const L = lander(), windowH = (to - from) / HOUR, missionH = days * 24, total = windowH + missionH;
      const opts = {
        t0: from, windowH, missionH, stepH: total > 2400 ? 3 : total > 1200 ? 2 : 1, startEveryH: windowH > 60 * 24 ? 48 : 24,
        loadW: L.loadW, capWh: L.capWh, minSoc: L.minSoc, panel: L.panel,
        weights: { ice: (+$('wIce').value / 10) * 0.5, comm: (+$('wComm').value / 10) * 0.45, light: (+$('wLit').value / 10) * 0.45, iceMaxKm: +$('mxIce').value },
        maxSlope: +$('mxSlope').value, minM3: $('iceStrong').checked ? 5 : 1, minSepKm: 6,
      };
      $('runMsg').textContent = 'جاري حساب ' + S.cand.n.toLocaleString('en-US') + ' موقع × كل أيام النافذة…';
      const t0 = performance.now();
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') $('runProg').style.width = (5 + 95 * m.f).toFixed(0) + '%';
        if (m.type === 'error') { $('runMsg').textContent = 'صار خطأ: ' + m.message; $('btnRun').disabled = false; }
        if (m.type === 'result') {
          $('runProg').style.width = '100%'; $('btnRun').disabled = false;
          S.cls = m.cls; S.top = m.top; S.lastRank = { opts, L, days };
          if (iceLayer) iceLayer.minM3 = opts.minM3;
          $('cSafe').textContent = '(' + m.counts.safe + ')'; $('cCaution').textContent = '(' + m.counts.caution + ')'; $('cRisky').textContent = '(' + m.counts.risky + ')';
          $('runMsg').textContent = 'خلص بـ ' + ((performance.now() - t0) / 1000).toFixed(1) + ' ثانية.';
          renderTop(); fillSiteSelect(); if (S.top.length) { $('bSite').value = 'top:0'; $('bDate').value = isoDate(S.top[0].startMs); check(); }
          map.render(); Explore.refreshTop(); Cmp.refreshOptions();
        }
      };
      w.postMessage({ type: 'rank', opts });
    }
    function renderTop() {
      const L = S.lastRank.L;
      if (!S.top.length) { $('topList').innerHTML = '<div class="callout bad">ما في ولا موقع بينجح بهاي الإعدادات. جرّب بطارية أكبر، أو استهلاك أقل، أو مهمة أقصر، أو نافذة هبوط بالصيف القطبي.</div>'; return; }
      $('topList').innerHTML = S.top.map((r, i) => {
        const ice = r.iceId >= 0 ? S.ice.psr[r.iceId] : null;
        return '<div class="result' + (i === 0 ? ' sel' : '') + '" style="margin-bottom:10px">' +
          '<div class="r-head"><div class="rank">' + (i + 1) + '</div><div style="flex:1"><b>' + esc(placeName(r.lat, r.lon)) + '</b><div class="muted small num" style="text-align:right">' + fmtLL(r.lat, r.lon) + '</div></div>' + tag(r.cls, CLS_AR[r.cls]) + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><i style="width:' + r.score.toFixed(0) + '%"></i></div><b class="num">' + r.score.toFixed(0) + '/100</b></div>' +
          '<div class="mini"><div>الهبوط<b>' + isoDate(r.startMs).slice(5) + '</b></div><div>شمس<b>' + pct(r.litPct) + '</b></div><div>اتصال<b>' + pct(r.commPct) + '</b></div>' +
          '<div>أقل شحن<b>' + Math.round(r.minSoc * 100) + '%</b></div><div>انحدار<b>' + r.slope.toFixed(1) + '°</b></div><div>للجليد<b>' + (r.iceKm < 0.05 ? '0' : r.iceKm.toFixed(1)) + ' km</b></div></div>' +
          '<div class="note" style="line-height:1.6">أقرب جليد: ' + (ice ? esc(iceName(ice)) + ' (' + ice.m3 + ' رصد)' : '—') + ' · أطول ظلمة خلال المهمة ' + dur(r.longestDarkH) + ' · أطول انقطاع اتصال ' + dur(r.longestNoCommH) + '</div>' +
          '<div class="acts"><button class="btn sm gold" data-act="3d" data-i="' + i + '">افتح ثلاثي الأبعاد</button><button class="btn sm" data-act="chk" data-i="' + i + '">فحص الطاقة</button><button class="btn sm" data-act="cmp" data-i="' + i + '">قارن</button><button class="btn sm" data-act="zoom" data-i="' + i + '">على الخريطة</button></div></div>';
      }).join('') + '<p class="note">الموقع لازم يكون بعيد 6 كم على الأقل عن غيره، عشان تطلعلك 3 خيارات مختلفة فعلاً. العلامة بتجمع: الإضاءة، والاتصال، وهامش البطارية، والانحدار، والقرب من الجليد حسب الأولويات اللي اخترتها.</p>';
      $$('#topList [data-act]').forEach((b) => (b.onclick = () => {
        const i = +b.dataset.i, r = S.top[i];
        if (b.dataset.act === '3d') Explore.openAt(r.lat, r.lon, 'الموقع المقترح ' + (i + 1));
        if (b.dataset.act === 'chk') { $('bSite').value = 'top:' + i; $('bDate').value = isoDate(r.startMs); check(); $('btnCheck').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        if (b.dataset.act === 'cmp') { go('compare'); setTimeout(() => Cmp.setSlot('A', 'top:' + i), 60); }
        if (b.dataset.act === 'zoom') { const [x, y] = Planner.ll2xy(r.lat, r.lon); map.focus(x, y, 20000); }
      }));
    }
    async function check() {
      const s = siteFrom($('bSite').value); if (!s) return;
      const L = lander(), days = +$('pDays').value;
      let t0 = Date.parse(($('bDate').value || $('pFrom').value) + 'T00:00:00Z');
      if (s.start && $('bDate').value === isoDate(s.start)) t0 = s.start;
      t0 = clampT(t0);
      $('checkOut').innerHTML = '<p class="note">جاري الحساب…</p>';
      let model;
      if (s.cand != null && S.cand) model = { lat: s.lat, lon: s.lon, h: S.cand.h[s.cand], hfn: S.cand.horizonFn(s.cand), elev: S.cand.horizonArray(s.cand), slope: S.cand.slope[s.cand] };
      else model = await siteModel(s.lat, s.lon);
      const ser = series(model, t0, days * 24, 1), rep = batteryReport(ser, L, 0, ser.n), a = stats(ser);
      const ni = nearestIce(s.lat, s.lon, 1), rose = Planner.panelRose(ser, L.panel);
      $('checkOut').innerHTML = '<div class="muted small" style="margin-bottom:8px"><b>' + esc(s.name) + '</b> · هبوط <span class="num">' + isoDate(t0) + '</span> · ' + days + ' يوم · بطارية <span class="num">' + L.capWh + ' Wh</span> · استهلاك <span class="num">' + L.loadW + ' W</span> · ألواح <span class="num">' + L.panel.area + ' m²</span></div>' +
        batteryHTML(rep, ser, L, 0) +
        '<canvas class="chart" id="chkSoc" style="margin-top:10px"></canvas>' +
        '<div class="metrics" style="margin-top:10px"><div class="metric"><div class="lab">الشمس ظاهرة</div><div class="val">' + pct(a.litPct) + '</div></div><div class="metric"><div class="lab">الأرض ظاهرة</div><div class="val">' + pct(a.commPct) + '</div></div><div class="metric"><div class="lab">أطول ظلمة</div><div class="val">' + durNum(a.darkH) + '</div></div>' +
        '<div class="metric"><div class="lab">طاقة داخلة</div><div class="val">' + (rep.b.energyInWh / 1000).toFixed(1) + ' <small>kWh</small></div></div><div class="metric"><div class="lab">مستهلكة</div><div class="val">' + (rep.b.energyOutWh / 1000).toFixed(1) + ' <small>kWh</small></div></div><div class="metric"><div class="lab">للجليد</div><div class="val">' + (ni ? (ni.km < 0.05 ? '0' : ni.km.toFixed(1)) : '—') + ' <small>km</small></div></div></div>' +
        '<div class="callout info" style="margin-top:10px">☀ <b>اتجاه الألواح بهاي المهمة:</b> إذا الألواح ثابتة، أفضل اتجاه هو السمت <b class="num">' + rose.bestAz + '°</b>، وبيعطي <b class="num">' + Math.round(100 * rose.bestWh / Math.max(1, rose.trackWh)) + '%</b> من طاقة لوح بيلف مع الشمس.' + (L.panel.mode === 'fixed' ? ' (أنت مختار سمت <span class="num">' + L.panel.azimuth + '°</span>.)' : '') + '</div>';
      Charts.soc($('chkSoc'), [{ soc: rep.b.soc, stepH: 1, t0, color: '#d6a451' }], L.minSoc, { height: 140 });
    }
    return {
      bindForm,
      init() { initMap().catch((e) => { console.error(e); $('runMsg').textContent = 'ما قدرت أحمّل بيانات الخريطة: ' + e.message; }); },
      shown() { if (map) { map.resize(); map.render(); } },
    };
  })();

  // ================================================================== COMPARE
  const Cmp = (() => {
    let map = null, pickSlot = 'A';
    function options() {
      const o = [];
      S.top.forEach((r, i) => o.push(['top:' + i, 'الموقع المقترح ' + (i + 1) + ' · ' + placeName(r.lat, r.lon)]));
      if (S.picks.A) o.push(['pick:A', 'نقطتك A · ' + placeName(S.picks.A.lat, S.picks.A.lon)]);
      if (S.picks.B) o.push(['pick:B', 'نقطتك B · ' + placeName(S.picks.B.lat, S.picks.B.lon)]);
      S.sites.forEach((s) => o.push(['site:' + s.id, s.name]));
      S.ice.psr.filter((p) => p.name && p.m3 >= 10).forEach((p) => o.push(['ice:' + p.id, 'داخل ' + p.name + ' (ظل دائم)']));
      return o;
    }
    function refreshOptions() {
      for (const id of ['cmpA', 'cmpB']) {
        const cur = $(id).value; $(id).innerHTML = options().map(([v, t]) => '<option value="' + v + '">' + esc(t) + '</option>').join('');
        if (cur && [...$(id).options].some((x) => x.value === cur)) $(id).value = cur;
      }
      coords();
    }
    function resolve(v) {
      if (!v) return null;
      if (v.startsWith('top:')) { const r = S.top[+v.slice(4)]; return r && { lat: r.lat, lon: r.lon, name: 'الموقع المقترح ' + (+v.slice(4) + 1) }; }
      if (v.startsWith('pick:')) { const p = S.picks[v.slice(5)]; return p && { lat: p.lat, lon: p.lon, name: p.name || placeName(p.lat, p.lon) }; }
      if (v.startsWith('site:')) { const s = S.sites.find((x) => x.id === v.slice(5)); return s && { lat: s.lat, lon: s.lon, name: s.name }; }
      if (v.startsWith('ice:')) { const p = S.ice.psr[+v.slice(4)]; return p && { lat: p.lat, lon: p.lon, name: p.name }; }
      return null;
    }
    function coords() { for (const k of ['A', 'B']) { const s = resolve($('cmp' + k).value); $('cmp' + k + 'c').textContent = s ? fmtLL(s.lat, s.lon) : ''; } if (map) map.render(); }
    async function run() {
      const A = resolve($('cmpA').value), B = resolve($('cmpB').value); if (!A || !B) return;
      $('cmpTable').innerHTML = '<p class="note">جاري الحساب (تحميل التضاريس أول مرة بياخد ثواني)…</p>';
      const days = +$('cmpDays').value, t0 = clampT(Date.parse($('cmpFrom').value + 'T00:00:00Z')), hours = Math.min(days * 24, Math.floor((S.range[1] - t0) / HOUR) - 1), st = days > 90 ? 2 : 1;
      const L = lander();
      const [mA, mB] = [await siteModel(A.lat, A.lon), await siteModel(B.lat, B.lon)];
      const sA = series(mA, t0, hours, st), sB = series(mB, t0, hours, st);
      const aA = stats(sA), aB = stats(sB), bA = batteryReport(sA, L, 0, sA.n), bB = batteryReport(sB, L, 0, sB.n);
      const iA = nearestIce(A.lat, A.lon, 1), iB = nearestIce(B.lat, B.lon, 1);
      const rA = Planner.panelRose(sA, L.panel), rB = Planner.panelRose(sB, L.panel);
      const rows = [
        ['الارتفاع', Math.round(mA.h) + ' m', Math.round(mB.h) + ' m', 0],
        ['الانحدار', mA.slope != null ? mA.slope.toFixed(1) + '°' : '—', mB.slope != null ? mB.slope.toFixed(1) + '°' : '—', mA.slope != null && mB.slope != null ? Math.sign(mB.slope - mA.slope) : 0],
        ['الشمس ظاهرة', pct(aA.litPct), pct(aB.litPct), Math.sign(aA.litPct - aB.litPct)],
        ['أطول ظلمة', dur(aA.darkH), dur(aB.darkH), Math.sign(aB.darkH - aA.darkH)],
        ['متوسط الطاقة (لوح 1 م²)', Math.round(aA.meanW) + ' W', Math.round(aB.meanW) + ' W', Math.sign(aA.meanW - aB.meanW)],
        ['الأرض ظاهرة (اتصال)', pct(aA.commPct), pct(aB.commPct), Math.sign(aA.commPct - aB.commPct)],
        ['أطول انقطاع اتصال', dur(aA.gapH), dur(aB.gapH), Math.sign(aB.gapH - aA.gapH)],
        ['شمس وأرض معاً', pct(aA.bothPct), pct(aB.bothPct), Math.sign(aA.bothPct - aB.bothPct)],
        ['البطارية (' + L.capWh + ' Wh، ' + L.loadW + ' W)', bA.b.ok ? '✔ أقل شحن ' + Math.round(bA.b.minSoc * 100) + '%' : '✘ بتفضى بعد ' + dur(bA.b.failHour), bB.b.ok ? '✔ أقل شحن ' + Math.round(bB.b.minSoc * 100) + '%' : '✘ بتفضى بعد ' + dur(bB.b.failHour),
          Math.sign((bA.b.ok ? 1 + bA.b.minSoc : bA.b.failHour / 1e5) - (bB.b.ok ? 1 + bB.b.minSoc : bB.b.failHour / 1e5))],
        ['أفضل اتجاه للوح ثابت', rA.bestAz + '° (' + Math.round(100 * rA.bestWh / Math.max(1, rA.trackWh)) + '%)', rB.bestAz + '° (' + Math.round(100 * rB.bestWh / Math.max(1, rB.trackWh)) + '%)', Math.sign(rA.bestWh / Math.max(1, rA.trackWh) - rB.bestWh / Math.max(1, rB.trackWh))],
        ['أقرب جليد مرصود', iA ? (iA.km < 0.05 ? 'داخله' : iA.km.toFixed(1) + ' km') : '—', iB ? (iB.km < 0.05 ? 'داخله' : iB.km.toFixed(1) + ' km') : '—', iA && iB ? Math.sign(iB.km - iA.km) : 0],
      ];
      let wa = 0, wb = 0; rows.forEach((r) => { if (r[3] > 0) wa++; if (r[3] < 0) wb++; });
      $('cmpTable').innerHTML = '<table class="tbl cmp"><tr><th>المعيار</th><th><span class="badge" style="display:inline-grid;width:22px;height:22px;border-radius:7px;background:var(--gold);color:#1d1408;place-items:center">A</span> ' + esc(A.name) + '</th><th><span class="badge" style="display:inline-grid;width:22px;height:22px;border-radius:7px;background:var(--earth);color:#0b1a2a;place-items:center">B</span> ' + esc(B.name) + '</th></tr>' +
        rows.map((r) => '<tr><td>' + r[0] + '</td><td class="num' + (r[3] > 0 ? ' win' : '') + '">' + r[1] + '</td><td class="num' + (r[3] < 0 ? ' win' : '') + '">' + r[2] + '</td></tr>').join('') + '</table>' +
        '<div class="callout ' + (wa === wb ? 'info' : 'ok') + '" style="margin-top:12px">' + (wa === wb ? 'الموقعين متعادلين: ' + wa + ' معايير لكل واحد.' : '<b>' + esc(wa > wb ? A.name : B.name) + '</b> أفضل بـ <b class="num">' + Math.max(wa, wb) + '</b> معايير من أصل ' + rows.length + '.') +
        ' <span class="muted">الفترة <span class="num">' + isoDate(t0) + '</span> لمدة ' + days + ' يوم.</span></div>';
      $('cmpCharts').classList.remove('hidden');
      Charts.horizon($('cmpHz'), mA.elev, null, null, { second: mB.elev, height: 170 });
      Charts.soc($('cmpSoc'), [{ soc: bA.b.soc, stepH: st, t0, color: '#d6a451' }, { soc: bB.b.soc, stepH: st, t0, color: '#6fa8dc' }], L.minSoc, { height: 150 });
      Charts.timeline($('cmpTlA'), sA, { height: 130 }); Charts.timeline($('cmpTlB'), sB, { height: 130 });
    }
    async function initMap() {
      await loadGrid();
      map = new PolarMap($('cmpMap'), { onClick: (p) => { if (Math.abs(p.x) > 160000 || Math.abs(p.y) > 160000) return; S.picks[pickSlot] = { lat: p.lat, lon: p.lon }; refreshOptions(); $('cmp' + pickSlot).value = 'pick:' + pickSlot; coords(); const o = pickSlot === 'A' ? 'B' : 'A'; setPick(o); } });
      const G = S.grid;
      map.add(PolarMap.raster(G.meta, G.lit, (v, k) => (v === 255 ? null : G.maxLit[k] === 0 ? [50, 80, 150, 140] : [214, 164, 81, Math.round(v * 2.2)]), 0.9));
      map.add(PolarMap.psr(S.ice, { labels: true }));
      map.add(PolarMap.graticule());
      map.add(PolarMap.markers(() => {
        const out = [];
        for (const [k, col] of [['A', '#d6a451'], ['B', '#6fa8dc']]) { const s = resolve($('cmp' + k).value); if (s) out.push({ lat: s.lat, lon: s.lon, num: k, color: col, r: 10, halo: col === '#d6a451' ? 'rgba(214,164,81,0.25)' : 'rgba(111,168,220,0.25)' }); }
        return out;
      }));
      map.add(PolarMap.scaleBar());
      $$('#view-compare .map-tools button').forEach((b) => (b.onclick = () => (b.dataset.z === 'fit' ? map.fit() : map.zoom(b.dataset.z === 'in' ? 0.7 : 1.4))));
    }
    function setPick(s) { pickSlot = s; $$('#cmpPickSeg button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); }
    return {
      init() {
        $('cmpFrom').value = isoDate(clampT(Date.parse(isoDate(Date.now()) + 'T00:00:00Z')));
        refreshOptions();
        if (!$('cmpA').value || $('cmpA').value === $('cmpB').value) { const o = options(); $('cmpA').value = o[0][0]; $('cmpB').value = (o[1] || o[0])[0]; }
        $('cmpA').onchange = coords; $('cmpB').onchange = coords; $('btnCmp').onclick = run;
        $$('#cmpPickSeg button').forEach((b) => (b.onclick = () => setPick(b.dataset.s)));
        coords(); initMap().catch((e) => console.error(e));
      },
      shown() { if (map) { map.resize(); map.render(); } },
      setSlot(slot, v) { refreshOptions(); if ([...$('cmp' + slot).options].some((x) => x.value === v)) $('cmp' + slot).value = v; coords(); },
      refreshOptions() { if (inited.compare) refreshOptions(); },
    };
  })();

  // ================================================================== ICE
  const Ice = (() => {
    let map = null, layer = null, own = null, cur = -1, sortKey = 'm3', sortDir = -1;
    const COLS = [['name', 'المنطقة'], ['lat', 'العرض'], ['lon', 'الطول'], ['area_km2', 'المساحة km²'], ['m3', 'رصدات M3'], ['T_max', 'أعلى حرارة K'], ['WEH_max_wt', 'هيدروجين WEH %']];
    function table() {
      const strong = $('iceStrongOnly').checked;
      const rows = S.ice.psr.filter((p) => !strong || p.m3 >= 5).slice().sort((a, b) => {
        const va = sortKey === 'name' ? (a.name || '~') : (a[sortKey] == null ? -1e9 : a[sortKey]), vb = sortKey === 'name' ? (b.name || '~') : (b[sortKey] == null ? -1e9 : b[sortKey]);
        return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
      });
      $('iceTable').innerHTML = '<tr>' + COLS.map(([k, t]) => '<th data-k="' + k + '">' + t + (sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr>' +
        rows.map((p) => '<tr data-id="' + p.id + '"' + (p.id === cur ? ' class="sel"' : '') + ' style="cursor:pointer"><td>' + esc(iceName(p)) + '</td><td class="num">' + p.lat.toFixed(2) + '</td><td class="num">' + p.lon.toFixed(2) + '</td><td class="num">' + p.area_km2 + '</td><td class="num"><b>' + p.m3 + '</b></td><td class="num">' + (p.T_max ? Math.round(p.T_max) : '—') + '</td><td class="num">' + (p.WEH_max_wt != null ? p.WEH_max_wt : '—') + '</td></tr>').join('');
      $$('#iceTable th').forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; } table(); }));
      $$('#iceTable tr[data-id]').forEach((tr) => (tr.onclick = () => select(+tr.dataset.id, true)));
    }
    function select(id, zoom) {
      cur = id; const p = S.ice.psr[id]; if (!p) return;
      if (layer) layer.highlight = id;
      if (map && zoom !== false) map.focus(p.x, p.y, Math.max(12000, Math.sqrt(p.area_km2) * 1500));
      const d = p.dist_m || [], il = p.illum_max || [];
      $('iceDetail').innerHTML = '<div class="sec-title" style="margin-bottom:4px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M4 6l16 12M20 6L4 18"/></svg>' + esc(iceName(p)) + ' ' + tag('ice', p.m3 + ' رصد جليد') + '</div>' +
        '<div class="muted small num" style="text-align:right">' + fmtLL(p.lat, p.lon) + '</div>' +
        '<div class="metrics" style="margin-top:12px"><div class="metric"><div class="lab">المساحة</div><div class="val">' + p.area_km2 + ' <small>km²</small></div></div>' +
        '<div class="metric"><div class="lab">الحرارة (أدنى / أعلى)</div><div class="val" style="font-size:18px">' + (p.T_min ? Math.round(p.T_min) + ' / ' + Math.round(p.T_max) + ' <small>K</small>' : '—') + '</div></div>' +
        '<div class="metric"><div class="lab">هيدروجين (متوسط)</div><div class="val">' + (p.H_mean_ppm != null ? Math.round(p.H_mean_ppm) : '—') + ' <small>ppm</small></div></div></div>' +
        '<dl class="kv" style="margin-top:12px"><dt>أقصى ماء مكافئ (WEH)</dt><dd>' + (p.WEH_max_wt != null ? p.WEH_max_wt + ' wt%' : '—') + '</dd>' +
        '<dt>انحدار الوصول</dt><dd>' + esc(p.access || '—') + '°</dd>' +
        '<dt>أقرب موقع هبوط (انحدار ≤ 10° / 15° / 20°)</dt><dd>' + (d.length ? d.slice(0, 3).map((v) => (v ? (v / 1000).toFixed(1) + ' km' : '—')).join(' / ') : '—') + '</dd>' +
        '<dt>أعلى إضاءة ضمن 1 / 5 / 10 كم</dt><dd>' + (il.length ? il.map((v) => Math.round(v * 100) + '%').join(' / ') : '—') + '</dd></dl>' +
        '<p class="note">' + (p.T_max && p.T_max < 110 ? 'أعلى حرارة هون أقل من 110 كلفن طول السنة، فالجليد بيقدر يضل ثابت حتى على السطح.' : p.T_max ? 'الحرارة بتطلع فوق 110 كلفن بأجزاء من المنطقة، فالجليد غالباً بيكون مدفون تحت السطح شوي.' : '') + '</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold sm" id="iceTo3d">افتح ثلاثي الأبعاد</button><button class="btn sm" id="iceToCmp">استخدمها بالمقارنة</button></div>';
      $('iceTo3d').onclick = () => Explore.openAt(p.lat, p.lon, iceName(p));
      $('iceToCmp').onclick = () => { S.picks.B = { lat: p.lat, lon: p.lon, name: iceName(p) }; go('compare'); setTimeout(() => Cmp.setSlot('B', 'pick:B'), 60); };
      table(); if (map) map.render();
    }
    async function initMap() {
      await loadGrid();
      map = new PolarMap($('iceMap'), {
        onClick: (p) => {
          let best = -1, bd = Infinity;
          S.ice.psr.forEach((q, i) => { const d = S.iceMap.distanceOne(i, p.x, p.y); if (d < bd) { bd = d; best = i; } });
          if (best >= 0 && bd < 4 * map.scale / 1000 + 1) select(best, false);
        },
      });
      const G = S.grid;
      own = map.add(PolarMap.raster(G.meta, G.maxLit, (v) => (v === 0 ? [30, 60, 140, 170] : null), 1)); own.visible = false;
      layer = map.add(PolarMap.psr(S.ice, { labels: true, lcross: true }));
      map.add(PolarMap.graticule()); map.add(PolarMap.scaleBar());
      $$('#view-ice .map-tools button').forEach((b) => (b.onclick = () => (b.dataset.z === 'fit' ? map.fit() : map.zoom(b.dataset.z === 'in' ? 0.7 : 1.4))));
      $('icePsrOwn').onchange = () => { own.visible = $('icePsrOwn').checked; map.render(); };
      $('iceStrongOnly').onchange = () => { layer.minM3 = $('iceStrongOnly').checked ? 5 : 1; map.render(); table(); };
      if (cur >= 0) select(cur);
    }
    return {
      init() { $('iceDet').textContent = S.ice.psr.reduce((a, p) => a + p.m3, 0); table(); initMap().catch((e) => console.error(e)); },
      shown() { if (map) { map.resize(); map.render(); } },
      select,
    };
  })();

  // ================================================================== ABOUT
  const About = {
    init() {
      const src = (window.SiteData && window.SiteData.SOURCES) || [];
      const cards = [
        ['البيانات', '<ul><li><b>التضاريس:</b> خريطة ارتفاعات LOLA على مركبة LRO لكل اللي جنوب خط 80° (دقة 80 م). صغّرناها لثلاث طبقات متداخلة: 80 م قرب القطب، و160 م، و640 م للجبال البعيدة.</li><li><b>مواقع الشمس والأرض:</b> من ملفات NAIF SPICE التابعة لـ JPL (DE421)، ساعة بساعة من 2026 لـ 2030، بنفس إطار إحداثيات LOLA (MOON_ME). قارنّاها بـ SPICE والفرق أقل من 0.001°.</li><li><b>الجليد:</b> 169 منطقة ظل دائم فيها رصدات جليد من M3، مع الحرارة (Diviner) والهيدروجين (Lemelin وزملاؤه 2021).</li><li><b>الصخور:</b> الحديد والثوريوم من Lunar Prospector.</li></ul>'],
        ['الإضاءة وخط الأفق', 'لكل نقطة بنرمي 720 شعاع حواليها (كل نص درجة) لمسافة 300 كم، وبنحسب أعلى زاوية للجبال باتجاه كل شعاع، مع انحناء القمر. الشمس قرص قطره نص درجة تقريباً، فبنحسب <b>جزء القرص الظاهر</b> فوق الجبال، مش بس مركزه. هيك بتطلع الإضاءة الجزئية لما الشمس بتلمس قمة جبل.'],
        ['الاتصال مع الأرض', 'الاتصال المباشر ممكن لما يكون <b>مركز الأرض فوق خط الأفق الحقيقي</b> من الموقع، وبنحسب موقع الأرض من نفس النقطة على السطح (مش من مركز القمر). هاي هندسة بس: ما بنحسب قوة الإشارة ولا جدول محطات الاستقبال على الأرض.'],
        ['الطاقة واتجاه الألواح', 'الشمس بالقطب واطية جداً (أقل من 2° فوق الأفق)، فاللوح الأنسب يكون <b>عمودي</b>. الطاقة = 1361 W/m² × (1 AU / المسافة)² × الكفاءة × المساحة × جزء القرص الظاهر × جيب تمام ارتفاع الشمس. للوح الثابت بنضرب كمان بجيب تمام الفرق بين اتجاه الشمس واتجاه اللوح، وبنجرب 72 اتجاه عشان نلاقي الأفضل.'],
        ['البطارية', 'محاكاة ساعة بساعة: الطاقة الداخلة من الألواح ناقص الاستهلاك، والبطارية بتبدأ مليانة وما بتتعدى سعتها. المهمة بتفشل إذا نزل الشحن تحت الحد اللي اخترته. وإذا فشلت، بنحسب أصغر بطارية بتنجّحها، وأصغر مساحة ألواح (إذا في وحدة بتنفع).'],
        ['اختيار أفضل 3 مواقع', 'حسبنا مسبقاً خط الأفق لـ <b>11,844</b> نقطة على شبكة كل 2 كم حوالين القطب (انحدارها ≤ 15° وإضاءتها على المدى الطويل ≥ 20%). بتشغيل المخطط، كل نقطة بتنجرب بكل يوم هبوط بالنافذة. الشرط الأساسي إنه البطارية تكفي كل المهمة، وبعدها العلامة بتجمع: الإضاءة، والاتصال، وهامش البطارية، والانحدار، والقرب من الجليد حسب الأولويات. وبنختار 3 مواقع بينهم 6 كم على الأقل.'],
        ['حدود الدقة (بصراحة)', '<ul><li>الشبكة كل 2 كم، فالقمم الصغيرة جداً ممكن تفوتنا. افتح أي موقع بالمستكشف لحساب دقيق على 80 م.</li><li>الانحدار على مسافة 160 م، يعني ما بيشوف الصخور الصغيرة والحفر. هاي بدها صور LROC NAC بدقة متر.</li><li>الإضاءة على ارتفاع 2 م فوق السطح. البرج الأعلى بيشوف شمس أكثر.</li><li>نموذج تعليمي وبحثي، مش بديل عن التحليل الهندسي الرسمي.</li></ul>'],
        ['تنزيل البيانات (للطلاب والباحثين)', '<ul><li><a href="data/grid/grid.json" target="_blank">خرائط القطب كل 1 كم</a>: الإضاءة، ورؤية الأرض، والظل الدائم، والانحدار، وأطول ظلمة (ملفات .bin، والشرح جوا grid.json).</li><li><a href="data/grid/cand.json" target="_blank">نقاط الهبوط المرشحة</a> مع خط الأفق لكل نقطة (cand_masks.gz).</li><li><a href="data/ice/psr_ice.json" target="_blank">مناطق الجليد</a> (CC BY 4.0، Lemelin وزملاؤه 2021).</li><li><a href="data/rocks/south_pole_rock_mix.csv" download>نسب الصخور (CSV)</a>.</li><li>الكود كامل على <a href="https://github.com/aldiqs70/nasa" target="_blank">GitHub</a>.</li></ul>'],
      ];
      $('methods').innerHTML = cards.map(([t, b]) => '<div class="card pad"><h2>' + t + '</h2><div style="color:var(--lavender)">' + b + '</div></div>').join('') +
        '<div class="card pad" style="grid-column:1/-1"><h2>المصادر</h2><ul>' +
        [
          ['Lemelin et al. (2021), Planetary Science Journal 2:103: Framework for coordinated efforts in the exploration of volatiles in the south polar region of the Moon', 'https://doi.org/10.3847/PSJ/abf3c5'],
          ['Database of water ice-bearing PSRs (Zenodo, CC BY 4.0)', 'https://doi.org/10.5281/zenodo.4646092'],
          ['Li et al. (2018), PNAS: Direct evidence of surface exposed water ice in the lunar polar regions', 'https://doi.org/10.1073/pnas.1802345115'],
          ['Colaprete et al. (2010), Science: Detection of water in the LCROSS ejecta plume', 'https://doi.org/10.1126/science.1186986'],
          ['Mazarico et al. (2011), Icarus: Illumination conditions of the lunar polar regions using LOLA topography', 'https://doi.org/10.1016/j.icarus.2010.10.030'],
          ['Lawrence et al. (2002), JGR: Iron abundances on the lunar surface (Lunar Prospector)', 'https://doi.org/10.1029/2001JE001530'],
        ].concat(src.map((s) => [s.name, s.url])).map(([t, u]) => '<li><a href="' + u + '" target="_blank" rel="noopener">' + esc(t) + '</a></li>').join('') + '</ul>' +
        '<p class="note">صور الأرض والقمر بالواجهة: NASA Blue Marble وخريطة القمر من NASA (LRO). تمت بواسطة فريق <b>شباب شهاب</b> بالجمعية الفلكية الأردنية لتحدي NASA Space Apps 2026 (CLPS Lunar Mission Browser).</p></div>';
    },
  };

  // ================================================================== boot
  $('menuBtn').onclick = () => $('nav').classList.toggle('open');
  window.addEventListener('hashchange', route);
  loadBase().then(() => { Plan.bindForm(); route(); }).catch((e) => {
    console.error(e);
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<div class="card pad" style="margin:20px">ما قدرت أحمّل البيانات الأساسية: <code>' + esc(e.message) + '</code>. لازم الموقع ينفتح من خلال سيرفر (GitHub Pages أو localhost)، مش بفتح الملف مباشرة.</div>');
  });
})();
