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
  const EN = window.LANG === 'en';
  const T = (ar, en) => (EN ? en : ar);
  const SEP = T('، ', ', ');
  const dur = (h) => h >= 48 ? (h / 24).toFixed(1) + T(' يوم', ' days') : Math.round(h) + T(' ساعة', ' h');
  const durNum = (h) => h >= 48 ? '<span class="num">' + (h / 24).toFixed(1) + '</span> <small>' + T('يوم', 'days') + '</small>' : '<span class="num">' + Math.round(h) + '</span> <small>' + T('ساعة', 'h') + '</small>';
  const times = (n) => T(n + ' ' + (n === 1 ? 'مرة' : 'مرات'), n + (n === 1 ? ' time' : ' times'));
  const daysTxt = (n) => T(n + ' يوم', n + (n === 1 ? ' day' : ' days'));
  const suggested = (i) => T('الموقع المقترح ', 'Suggested site ') + i;
  const pct = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(v >= 99.95 || v < 9.95 ? 1 : 0) + '%');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tag = (cls, txt) => '<span class="tag ' + cls + '">' + txt + '</span>';
  const CLS_AR = { safe: T('مناسب', 'Suitable'), caution: T('بحذر', 'Caution'), risky: T('غير مناسب', 'Unsuitable') };
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
    else throw new Error(T('هالمتصفح قديم وما بيدعم فك الضغط. جرّب Chrome أو Edge أو Firefox حديث.', 'This browser is too old to decompress the data. Please use a recent Chrome, Edge or Firefox.'));
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
    if (best && best.d < 30) return T('قرب ', 'Near ') + best.name;
    return fmtLL(lat, lon);
  }
  function nearestIce(lat, lon, minM3) {
    const [x, y] = Planner.ll2xy(lat, lon); const r = S.iceMap.distance(x, y, minM3 || 1);
    return r.id >= 0 ? { km: r.km, p: S.ice.psr[r.id] } : null;
  }
  const iceName = (p) => p.name || (T('منطقة ظل #', 'Shadowed region #') + p.id);

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
      hibernate: $('lHib').checked, sleepW: Math.max(0, +$('lSleep').value || 0), wakeSoc: Math.min(1, Math.max(0.1, (+$('lWake').value || 50) / 100)),
      panel: { mode, azimuth: +$('lAz').value || 0, area: Math.max(0.01, +$('lArea').value || 0.01), efficiency: Math.min(0.5, Math.max(0.01, (+$('lEff').value || 30) / 100)) },
    };
  }
  const fmtWh = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + ' kWh' : Math.round(n).toLocaleString('en-US') + ' Wh');
  // run the lander over [i0, i1) (work / sleep / lost) and, if it does not work the whole time, find what would fix it
  function batteryReport(ser, L, i0, i1) {
    i0 = i0 || 0; i1 = i1 == null ? ser.n : i1;
    const st = ser.stepH, gen = Planner.panelPower(ser, L.panel);
    const b = Planner.operate(gen, st, L, i0, i1);
    const r = { b, gen, i0, i1, dark: Planner.firstRun(ser.lit, (v) => v < 0.01, st, i0, i1) };
    if (!b.ok) {
      r.needCap = Math.ceil(b.neededCapWh / 100) * 100;
      const strict = Object.assign({}, L, { hibernate: false }), scaled = (a) => gen.map((v) => v * a / L.panel.area);
      let lo = L.panel.area, hi = lo, ok = false;
      for (let k = 0; k < 7 && !ok; k++) { hi *= 2; ok = Planner.operate(scaled(hi), st, strict, i0, i1).ok; }
      if (ok) { for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (Planner.operate(scaled(mid), st, strict, i0, i1).ok) hi = mid; else lo = mid; } r.needArea = Math.ceil(hi * 10) / 10; }
      if (L.hibernate && !b.alive && L.sleepW > 0) {
        let a = 0, c = L.sleepW;
        for (let k = 0; k < 14; k++) { const mid = (a + c) / 2; if (Planner.operate(gen, st, Object.assign({}, L, { sleepW: mid }), i0, i1).alive) a = mid; else c = mid; }
        r.maxSleepW = Math.floor(a * 10) / 10;
      }
    }
    return r;
  }
  function batteryHTML(rep, ser, L) {
    const b = rep.b, t0 = ser.t[rep.i0], d = rep.dark;
    const at = (h) => { const x = new Date(t0 + h * HOUR); return '<span class="num">' + isoDate(x) + ' ' + pad2(x.getUTCHours()) + ':00 UTC</span>'; };
    const usableH = L.capWh * (1 - L.minSoc) / L.loadW, U = (v) => '<b class="num">' + Math.round(v) + '%</b>';
    let h;
    if (b.ok) h = '<div class="callout ok"><b>' + T('✔ اشتغلت كل المهمة بدون ما تنام.', '✔ Worked through the whole mission without sleeping.') + '</b> ' + T('أقل شحن وصلته البطارية ', 'Lowest battery charge: ') + U(b.minSoc * 100) + T(' (الحد ', ' (limit ') + Math.round(L.minSoc * 100) + '%).</div>';
    else if (!L.hibernate) h = '<div class="callout bad"><b>' + T('✘ انتهت المهمة بعد ', '✘ Mission ended after ') + dur(b.deadHour) + '</b> (' + at(b.deadHour) + '). ' +
      T('البطارية بتكفي <b>' + dur(usableH) + '</b> بالظلمة بالاستهلاك الكامل، والمركبة مش مصممة تنام وتستنى الشمس.', 'The battery lasts <b>' + dur(usableH) + '</b> in the dark at full power draw, and this lander is not designed to sleep and wait for the Sun.') + '</div>';
    else if (b.alive) h = '<div class="callout warn"><b>' + T('⏾ نامت ' + times(b.sleeps) + ' وصحيت مع رجوع الشمس.', '⏾ Slept ' + times(b.sleeps) + ' and woke up when the Sun returned.') + '</b> ' +
      T('اشتغلت ' + U(b.uptimePct) + ' من وقت المهمة، وأطول نوم كان <b>' + dur(b.longestSleepH) + '</b>. أول نوم بعد ' + dur(b.firstSleepHour) + ' من الهبوط.', 'Worked ' + U(b.uptimePct) + ' of the mission time; the longest sleep was <b>' + dur(b.longestSleepH) + '</b>. First sleep began ' + dur(b.firstSleepHour) + ' after landing.') + '</div>';
    else h = '<div class="callout bad"><b>' + T('✘ نامت بعد ' + dur(b.firstSleepHour) + '، وبعدين خلصت البطارية وهي نايمة', '✘ Went to sleep after ' + dur(b.firstSleepHour) + ', then the battery ran flat while asleep') + '</b> (' + at(b.deadHour) + '). ' +
      T('السخانات طفت والبرد أتلف المركبة قبل ما ترجع الشمس. اشتغلت ' + U(b.uptimePct) + ' من الوقت قبل ما تنتهي.', 'The heaters stopped and the cold destroyed the lander before the Sun came back. It worked ' + U(b.uptimePct) + ' of the time before it was lost.') + '</div>';
    h += '<p class="note" style="margin:8px 0 0">' + (d
      ? (d.startH === 0 ? T('الموقع كان <b>بالظلمة لحظة الهبوط</b>', 'The site was <b>in darkness at landing</b>') : T('أول ظلمة بلّشت <b>بعد ' + dur(d.startH) + '</b> من الهبوط', 'The first darkness began <b>' + dur(d.startH) + '</b> after landing')) +
        T('، وطولها <b>', ' and lasted <b>') + dur(d.durH) + (d.toEnd ? T(' (لآخر المهمة)', ' (to the end of the mission)') : '') + '</b>. ' + T('البطارية بتكفي ' + dur(usableH) + ' شغل بالظلمة.', 'The battery covers ' + dur(usableH) + ' of work in the dark.')
      : T('الشمس ما غابت ولا مرة خلال المهمة.', 'The Sun never set during the mission.')) + '</p>';
    if (!b.ok) {
      const fx = [];
      if (rep.needCap) fx.push(T('بطارية ≥ ', 'a battery ≥ ') + '<b class="num">' + fmtWh(rep.needCap) + '</b>' + T(' عشان ما تنام أبداً', ' so it never sleeps'));
      if (rep.needArea) fx.push(T('أو ألواح ≥ ', 'or panels ≥ ') + '<b class="num">' + rep.needArea + ' m²</b>');
      else if (fx.length) fx[fx.length - 1] += T(' (الألواح لحالها ما بتحل الظلمة)', ' (more panels alone cannot fix the darkness)');
      if (rep.maxSleepW != null) fx.push(T('أو وضع نوم ≤ ', 'or a sleep mode ≤ ') + '<b class="num">' + (rep.maxSleepW < 1 ? '1' : rep.maxSleepW) + ' W</b>' + T(' عشان تضل عايشة لحد ما ترجع الشمس', ' so it survives until the Sun returns'));
      if (!L.hibernate) fx.push(T('أو مركبة مصممة تنام وتصحى', 'or a lander designed to sleep and wake up'));
      h += '<p class="note" style="margin:4px 0 0">' + T('الحلول الممكنة: ', 'Possible fixes: ') + fx.join(SEP) + '.</p>';
    }
    return h;
  }
  const STATE_LEGEND = '<div class="legend" style="margin:10px 0 4px"><span><i style="background:var(--gold)"></i>' + T('شغّالة', 'Working') + '</span><span><i style="background:#8a6a8f"></i>' + T('نايمة', 'Asleep') + '</span><span><i style="background:var(--risky)"></i>' + T('انتهت', 'Lost') + '</span><span><i style="background:rgba(214,164,81,.45)"></i>' + T('شمس', 'Sun') + '</span><span><i style="background:var(--earth)"></i>' + T('اتصال', 'Contact') + '</span></div>';

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
    let gl = null, playing = false, t = Date.now(), on = false, body = 'moon', tex = null, earthTex = null, timer = null;
    const ttl = { moon: T('تفاصيل القمر', 'Moon details'), earth: T('تفاصيل الأرض', 'Earth details'), sun: T('تفاصيل الشمس', 'Sun details') };
    const kvHTML = (rows) => rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
    const phaseName = (k, waxing) => EN
      ? (k < 0.03 ? 'New' : k < 0.35 ? (waxing ? 'Waxing crescent' : 'Waning crescent') : k < 0.65 ? (waxing ? 'First quarter' : 'Last quarter') : k < 0.97 ? (waxing ? 'Waxing gibbous' : 'Waning gibbous') : 'Full')
      : (k < 0.03 ? 'محاق' : k < 0.35 ? (waxing ? 'هلال متزايد' : 'هلال متناقص') : k < 0.65 ? (waxing ? 'تربيع أول' : 'تربيع أخير') : k < 0.97 ? (waxing ? 'أحدب متزايد' : 'أحدب متناقص') : 'بدر');
    function geo(tt) {
      const g = S.eph.at(clampT(tt)), e = g.earth, en = Math.hypot(e[0], e[1], e[2]), eh = [e[0] / en, e[1] / en, e[2] / en];
      const k = (1 + Sky.dot(g.sun, eh)) / 2;
      // altitude of the Sun / Earth above the horizon at the south pole (up = -z)
      const P = [0, 0, -R_KM], ev = [e[0] - P[0], e[1] - P[1], e[2] - P[2]], evn = Math.hypot(ev[0], ev[1], ev[2]);
      return { g, en, eh, k, sunPole: Math.asin(-g.sun[2]) * 180 / Math.PI, earthPole: Math.asin(-ev[2] / evn) * 180 / Math.PI };
    }
    function thumb(G) {
      const cv = $('phaseCanvas'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = 72 * dpr; cv.height = 72 * dpr;
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, 72, 72);
      if (body === 'moon' && tex) Sky.sphere(g, 36, 36, 33, tex, { kind: 'moon', basis: Sky.basisFromView(G.eh, [0, 0, 1]), light: G.g.sun, ambient: 0.12 });
      if (body === 'earth' && earthTex) { const B = Sky.basisFromView([-G.eh[0], -G.eh[1], -G.eh[2]], [0, 0, 1]); Sky.sphere(g, 36, 36, 30, earthTex, { kind: 'earth', basis: Sky.basisFromAngles(-Sky.gmst(t), 12), lightView: [Sky.dot(G.g.sun, B.R), Sky.dot(G.g.sun, B.U), Sky.dot(G.g.sun, B.F)] }); }
      if (body === 'sun') {
        const halo = g.createRadialGradient(36, 36, 18, 36, 36, 36); halo.addColorStop(0, 'rgba(255,170,70,0.55)'); halo.addColorStop(1, 'rgba(255,140,50,0)');
        g.fillStyle = halo; g.fillRect(0, 0, 72, 72);
        const ph = g.createRadialGradient(32, 32, 2, 36, 36, 24); ph.addColorStop(0, '#fff6dc'); ph.addColorStop(0.55, '#ffc35c'); ph.addColorStop(1, '#e0661c');
        g.fillStyle = ph; g.beginPath(); g.arc(36, 36, 24, 0, 7); g.fill();
      }
    }
    function card() {
      if (!S.eph) return;
      const G = geo(t), G2 = geo(t + 6 * HOUR), waxing = G2.k > G.k;
      $('bcTitle').textContent = ttl[body];
      if (body === 'moon') {
        $('bcStatic').innerHTML = kvHTML([[T('القطر', 'Diameter'), '3,474 km'], [T('الجاذبية', 'Gravity'), '1.62 m/s²'], [T('اليوم القمري', 'Lunar day'), T('29.5 يوم', '29.5 days')]]);
        $('bcLive').innerHTML = kvHTML([[T('الطور الآن', 'Phase now'), phaseName(G.k, waxing)], [T('الجزء المضاء', 'Illuminated'), (G.k * 100).toFixed(0) + '%'], [T('البعد عن الأرض', 'Distance from Earth'), Math.round(G.en).toLocaleString('en-US') + ' km'], [T('الشمس فوق القطب الجنوبي', 'Sun above the south pole'), G.sunPole.toFixed(2) + '°']]);
        $('phaseName').textContent = T('الطور والبعد محسوبين لهاي اللحظة من مواقع الشمس والأرض الحقيقية (JPL DE421).', 'Phase and distance are computed for this moment from the real Sun and Earth positions (JPL DE421).');
      } else if (body === 'earth') {
        const ke = 1 - G.k;
        $('bcStatic').innerHTML = kvHTML([[T('القطر', 'Diameter'), '12,742 km'], [T('الجاذبية', 'Gravity'), '9.81 m/s²'], [T('اليوم', 'Day'), '24 h']]);
        $('bcLive').innerHTML = kvHTML([[T('طورها من القمر', 'Phase seen from the Moon'), EN ? phaseName(ke, !waxing) : phaseName(ke, !waxing).replace('هلال', 'هلال أرضي')], [T('الجزء المضاء', 'Illuminated'), (ke * 100).toFixed(0) + '%'], [T('ارتفاعها فوق أفق القطب', 'Altitude above the pole horizon'), G.earthPole.toFixed(2) + '°'], [T('الاتصال من القطب', 'Contact from the pole'), G.earthPole > 0 ? T('ممكن (فوق الأفق)', 'Possible (above horizon)') : T('لا (تحت الأفق)', 'No (below horizon)')]]);
        $('phaseName').textContent = T('من القمر، الأرض بتمر بأطوار عكس أطوار القمر: لما يكون عنّا محاق، الأرض من القمر بتكون بدر.', 'Seen from the Moon, Earth shows the opposite phases: when we have a new Moon, the Moon sees a full Earth.');
      } else {
        const au = G.g.sunAU;
        $('bcStatic').innerHTML = kvHTML([[T('القطر', 'Diameter'), '1,392,700 km'], [T('حرارة السطح', 'Surface temperature'), '5,772 K'], [T('ضوءها بيوصل', 'Light travel time'), T('8.3 دقيقة', '8.3 min')]]);
        $('bcLive').innerHTML = kvHTML([[T('البعد عن القمر', 'Distance from the Moon'), (au * 149.598).toFixed(1) + T(' مليون كم', ' million km')], [T('شدة الإشعاع', 'Irradiance'), Math.round(1361 / (au * au)) + ' W/m²'], [T('ارتفاعها فوق القطب الجنوبي', 'Altitude above the south pole'), G.sunPole.toFixed(2) + '°']]);
        $('phaseName').textContent = T('محور القمر مايل 1.5° بس، فالشمس بالقطب الجنوبي ما بتعلى أكثر من 1.6° فوق الأفق. عشان هيك الظلال طويلة جداً، وفي فوهات ما بتشوف الشمس أبداً.', 'The Moon’s axis is tilted only 1.5°, so at the south pole the Sun never rises more than about 1.6° above the horizon. Shadows are extremely long, and some craters never see the Sun at all.');
      }
      thumb(G);
      const d = new Date(t);
      $('heroDate').textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      $('heroClock').textContent = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }
    function labels(sc) {
      const hero = $('hero'), W = hero.clientWidth, H = hero.clientHeight;
      for (const [id, mesh, k] of [['lblMoon', sc.moon, 1.12], ['lblEarth', sc.earth, 1.35], ['lblSun', sc.sun, 0.75]]) {
        const R = mesh.geometry.parameters.radius, p = sc.project(mesh, R * k), el = $(id);
        let x = Math.min(W - 90, Math.max(90, p.x)), y = Math.min(H - 40, Math.max(56, p.y - 6));
        el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%, -100%)';
        el.style.opacity = p.vis ? '' : '0';
      }
    }
    function startGL() {
      if (gl || !window.Hero3D) return !!gl;
      gl = window.Hero3D.mount($('heroGL'));
      if (!gl) return false;
      $('hero').classList.add('gl'); gl.onFrame = labels; gl.setActive(on);
      return true;
    }
    function fallback() {
      // no WebGL: a still star field and the labels hidden
      $('hero').classList.add('no-labels');
      const cv = $('heroCanvas'); Sky.stars(cv, { density: 2200 });
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
        Promise.all([Sky.texture('img/moon_2k.jpg?v=1', 1024), Sky.texture('img/earth_day.jpg?v=1', 1024)]).then(([a, b]) => { tex = a; earthTex = b; card(); }).catch((e) => console.warn(e));
        if (!startGL()) {
          window.addEventListener('hero3d-ready', startGL, { once: true });
          setTimeout(() => { if (!gl) fallback(); }, 6000);
        }
        $$('#bodySeg button').forEach((b) => (b.onclick = () => {
          body = b.dataset.b; $$('#bodySeg button').forEach((x) => x.classList.toggle('on', x === b));
          if (window.Hero3D) window.Hero3D.focus(body === 'moon' ? 'all' : body); card();
        }));
        $$('#sysPanel [data-t]').forEach((c) => (c.onchange = () => {
          if (c.dataset.t === 'labels') $('hero').classList.toggle('no-labels', !c.checked);
          else if (window.Hero3D) window.Hero3D.toggle(c.dataset.t, c.checked);
        }));
        $('heroPlay').onclick = () => {
          playing = !playing;
          $('heroPlay').innerHTML = playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
          clearInterval(timer); if (playing) timer = setInterval(() => { t = clampT(t + 3 * HOUR); if (t >= S.range[1] - 2 * HOUR) t = S.range[0]; card(); }, 120);
        };
        card(); miniMap().catch((e) => console.warn(e));
      },
      active(v) { on = v; if (gl) gl.setActive(v); },
    };
  })();

  // ================================================================== 3D EXPLORER
  const Explore = (() => {
    let viewer = null, tileset = null, light = null, ready = null, tNow = Date.now(), sel = null, marker = null, lastSer = null, lastRose = null;
    let siteEnts = [], iceEnts = [], topEnts = [], pendingOpen = null, playTimer = null, curTab = 'light', redrawBattery = null;
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
      status(T('جاري تحميل القمر…', 'Loading the Moon…'));
      const token = (window.CESIUM_ION_TOKEN || '').trim();
      try { await loadCesium(); } catch (e) { status(''); err(T('ما قدرت أحمّل مكتبة Cesium. تأكد من الإنترنت وحدّث الصفحة.', 'Could not load the Cesium library. Check your connection and reload the page.')); return; }
      if (!token || token.startsWith('PASTE')) { status(''); err(T('لازم مفتاح Cesium ion بملف <code>config.js</code> عشان يشتغل القمر ثلاثي الأبعاد.', 'The 3D Moon needs a Cesium ion token in <code>config.js</code>.')); return; }
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
      } catch (e) { console.error(e); status(''); err(T('ما قدرت أحمّل قمر Cesium. تأكد إنه <b>Cesium Moon</b> مضاف لحسابك وإنه المفتاح صحيح.', 'Could not load the Cesium Moon. Make sure <b>Cesium Moon</b> is added to your account and the token is correct.') + '<br><code>' + esc(e.message || e) + '</code>'); return; }
      tileset.loadProgress.addEventListener((p, q) => status(p + q > 0 ? T('جاري تحميل التفاصيل… (', 'Loading detail… (') + (p + q) + ')' : ''));
      tileset.allTilesLoaded.addEventListener(() => status(''));
      // markers
      const pt = (lon, lat, name, color, extra, size) => viewer.entities.add(Object.assign({
        position: deg(lon, lat, 2500),
        point: { pixelSize: size || 9, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.fromCssColorString('#120f17'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: name ? { text: name, font: '600 13px "IBM Plex Sans Arabic", "Space Grotesk", Arial', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, translucencyByDistance: new Cesium.NearFarScalar(3e5, 1, 1.6e6, 0) } : undefined,
      }, extra || {}));
      pt(0, -90, 'South Pole', '#ff8f7a');
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
        if (hit && hit.id && hit.id.topIdx != null) { const r = S.top[hit.id.topIdx]; return open(r.lat, r.lon, suggested(hit.id.topIdx + 1)); }
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
      $('dSlope').innerHTML = m.slope == null ? '—' : m.slope.toFixed(1) + '° ' + (m.slope > 15 ? tag('risky', T('شديد', 'Steep')) : m.slope > 8 ? tag('caution', T('متوسط', 'Moderate')) : tag('safe', T('مريح', 'Gentle')));
      $('dPole').textContent = ((90 + lat) * Math.PI / 180 * R_KM).toFixed(1) + ' km';
      const ni = nearestIce(lat, lon, 1); $('dIce').textContent = ni ? (ni.km < 0.05 ? T('داخل ', 'Inside ') : ni.km.toFixed(1) + ' km · ') + iceName(ni.p) : '—';
      lastRose = null; nowPanel();
      if ($('sheet').classList.contains('open')) analyse();
    }
    function nowPanel() {
      if (!sel || !sel.model || !S.eph) return;
      const m = sel.model, ser = series(m, tNow, 1, 1), k = 0;
      const sAlt = ser.sunAlt[k], sAz = ser.sunAz[k], lit = ser.lit[k], eAlt = ser.earthAlt[k], eAz = ser.earthAz[k];
      $('dSun').textContent = sAlt.toFixed(2) + '° / ' + sAz.toFixed(0) + '°';
      $('dSunState').innerHTML = lit >= 0.999 ? tag('safe', T('مضاء', 'Sunlit')) : lit > 0 ? tag('caution', T('جزئي ', 'Partial ') + Math.round(lit * 100) + '%') : tag('risky', sAlt > 0 ? T('محجوبة بالجبال', 'Blocked by mountains') : T('تحت الأفق', 'Below horizon'));
      $('dEarth').textContent = eAlt.toFixed(2) + '° / ' + eAz.toFixed(0) + '°';
      $('dEarthState').innerHTML = ser.comm[k] ? tag('safe', T('اتصال متاح', 'Contact possible')) : tag('risky', eAlt > 0 ? T('محجوبة بالجبال', 'Blocked by mountains') : T('تحت الأفق', 'Below horizon'));
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
      const ph = EN ? (k < 0.03 ? 'new Earth (dark)' : k < 0.35 ? 'crescent Earth' : k < 0.65 ? 'half lit' : k < 0.97 ? 'gibbous' : 'full Earth')
        : (k < 0.03 ? 'أرض جديدة (معتمة)' : k < 0.35 ? 'هلال أرضي' : k < 0.65 ? 'نصف مضاءة' : k < 0.97 ? 'أحدب' : 'بدر أرضي كامل');
      $('earthNote').innerHTML = T('الأرض من هون: ', 'Earth from here: ') + '<b>' + ph + '</b> (<span class="num">' + Math.round(k * 100) + '%</span>' + T(' مضاءة). ', ' lit). ') +
        (comm ? T('ظاهرة فوق الأفق، فالاتصال المباشر ممكن.', 'Above the horizon, so direct contact is possible.') : eAlt > 0 ? T('فوق الأفق بس الجبال حاجبتها.', 'Above the horizon but hidden by mountains.') : T('تحت الأفق هلأ.', 'Below the horizon right now.'));
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
      $('pTrack').innerHTML = (rose.trackWh / 1000).toFixed(0) + ' <small>kWh/m²</small>'; $('pFixed').innerHTML = fx.toFixed(0) + '<small>%</small>'; $('pFixedAz').textContent = T('باتجاه ' + rose.bestAz + '° من الشمال', 'facing ' + rose.bestAz + '° from north');
      $('pTwo').innerHTML = two.toFixed(0) + '<small>%</small>';
      const dirAr = (az) => (EN ? ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] : ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'])[Math.round(az / 45) % 8];
      const B = (v) => '<b class="num">' + v + '</b>';
      $('panelAdvice').innerHTML = T('<b>التوصية:</b> لوح عمودي بيلف مع الشمس (بيلحق سمتها) بيعطي أعلى طاقة. إذا لازم يكون اللوح ثابت، وجّهه نحو <b>' + dirAr(rose.bestAz) + '</b> (السمت ' + B(rose.bestAz + '°') + ')، وبيعطيك تقريباً ' + B(fx.toFixed(0) + '%') + ' من طاقة اللوح المتحرك. لوحين ظهر لظهر بنفس الاتجاه بيوصلوا ' + B(two.toFixed(0) + '%') + '.',
        '<b>Recommendation:</b> a vertical panel that turns with the Sun (following its azimuth) collects the most energy. If the panel must be fixed, face it <b>' + dirAr(rose.bestAz) + '</b> (azimuth ' + B(rose.bestAz + '°') + '); it gives about ' + B(fx.toFixed(0) + '%') + ' of the tracking panel’s energy. Two back-to-back panels on that line reach ' + B(two.toFixed(0) + '%') + '.') +
        '<br><span class="muted">' + T('الشمس هلأ بالسمت <span class="num">' + ser.sunAz[0].toFixed(0) + '°</span>، فاللوح المتحرك لازم يكون موجّه لهناك.', 'The Sun is now at azimuth <span class="num">' + ser.sunAz[0].toFixed(0) + '°</span>, so a tracking panel should face there.') + '</span>';
      renderBattery(); renderIceNear(); renderGeo();
      nowPanel();
      setTimeout(() => { Charts.horizon($('cHorizon'), sel.model.elev, ser, { sunAz: ser.sunAz[0], sunAlt: ser.sunAlt[0], earthAz: ser.earthAz[0], earthAlt: ser.earthAlt[0] }, { height: 180 }); Charts.timeline($('cTimeline'), ser, { height: 180 }); }, 30);
    }
    function renderBattery() {
      const L = lander(), box = $('batteryBox');
      box.innerHTML = '<div class="grid3" style="grid-template-columns:repeat(5,1fr)">' +
        '<label class="fld"><span>' + T('البطارية (Wh)', 'Battery (Wh)') + '</span><input type="number" class="inp" id="bxCap" value="' + L.capWh + '"></label>' +
        '<label class="fld"><span>' + T('الاستهلاك (W)', 'Power draw (W)') + '</span><input type="number" class="inp" id="bxLoad" value="' + L.loadW + '"></label>' +
        '<label class="fld"><span>' + T('الألواح (m²)', 'Panels (m²)') + '</span><input type="number" class="inp" id="bxArea" value="' + L.panel.area + '"></label>' +
        '<label class="fld"><span>' + T('مدة المهمة (يوم)', 'Mission (days)') + '</span><input type="number" class="inp" id="bxDays" value="' + $('pDays').value + '"></label>' +
        '<div style="display:flex;align-items:flex-end"><button class="btn gold" id="bxRun" style="width:100%">' + T('احسب', 'Run') + '</button></div></div>' +
        '<label class="toggle" style="max-width:420px">' + T('المركبة بتقدر تنام بالظلمة وتصحى مع الشمس', 'Lander can sleep through the dark and wake with the Sun') + '<input type="checkbox" id="bxHib"' + (L.hibernate ? ' checked' : '') + '><i></i></label><div id="bxOut" style="margin-top:8px"></div>';
      const run = () => {
        $('lCap').value = $('bxCap').value; $('lLoad').value = $('bxLoad').value; $('lArea').value = $('bxArea').value; $('pDays').value = $('bxDays').value; $('pDays').oninput();
        $('lHib').checked = $('bxHib').checked; $('lHib').onchange();
        const L2 = lander(), days = Math.max(1, +$('bxDays').value || 14), t0 = clampT(Date.parse(isoDate(tNow) + 'T00:00:00Z'));
        const ser = series(sel.model, t0, days * 24, 1), rep = batteryReport(ser, L2, 0, ser.n);
        const a = stats(ser);
        $('bxOut').innerHTML = batteryHTML(rep, ser, L2) + STATE_LEGEND + '<canvas class="chart" id="bxStates"></canvas>' +
          '<div class="metrics" style="grid-template-columns:repeat(4,1fr); margin-top:10px"><div class="metric"><div class="lab">' + T('طاقة داخلة', 'Energy in') + '</div><div class="val">' + (rep.b.energyInWh / 1000).toFixed(1) + ' <small>kWh</small></div></div>' +
          '<div class="metric"><div class="lab">' + T('طاقة مستهلكة', 'Energy used') + '</div><div class="val">' + (rep.b.energyOutWh / 1000).toFixed(1) + ' <small>kWh</small></div></div>' +
          '<div class="metric"><div class="lab">' + T('الشمس ظاهرة', 'Sun visible') + '</div><div class="val">' + pct(a.litPct) + '</div></div><div class="metric"><div class="lab">' + T('أطول ظلمة', 'Longest darkness') + '</div><div class="val">' + durNum(a.darkH) + '</div></div></div>' +
          '<div class="muted small" style="margin:12px 0 4px">' + T('شحن البطارية من تاريخ الهبوط <span class="num">' + isoDate(t0) + '</span> (التاريخ من شريط الوقت تحت)', 'Battery charge from landing on <span class="num">' + isoDate(t0) + '</span> (date from the time bar below)') + '</div><canvas class="chart" id="bxSoc"></canvas>';
        redrawBattery = () => {
          Charts.states($('bxStates'), ser, rep.b.state, 0);
          Charts.soc($('bxSoc'), [{ soc: rep.b.soc, state: rep.b.state, stepH: 1, t0, color: '#d6a451' }], L2.minSoc, { height: 150 });
        };
        redrawBattery();
      };
      $('bxRun').onclick = run; $('bxHib').onchange = run; run();
    }
    function renderIceNear() {
      const [x, y] = Planner.ll2xy(sel.lat, sel.lon);
      const rows = S.ice.psr.map((p, i) => ({ p, d: S.iceMap.distanceOne(i, x, y) })).sort((a, b) => a.d - b.d).slice(0, 6);
      $('iceNear').innerHTML = '<table class="tbl"><tr><th>' + T('المنطقة', 'Region') + '</th><th>' + T('المسافة', 'Distance') + '</th><th>' + T('رصدات الجليد', 'Ice detections') + '</th><th>' + T('المساحة', 'Area') + '</th><th>' + T('الحرارة (أعلى)', 'Max temperature') + '</th><th></th></tr>' +
        rows.map((r) => '<tr><td>' + esc(iceName(r.p)) + '</td><td class="num">' + (r.d < 0.05 ? T('داخلها', 'inside') : r.d.toFixed(1) + ' km') + '</td><td class="num">' + r.p.m3 + '</td><td class="num">' + r.p.area_km2 + ' km²</td><td class="num">' + (r.p.T_max ? Math.round(r.p.T_max) + ' K' : '—') + '</td>' +
          '<td><button class="btn sm" data-ice="' + r.p.id + '">' + T('على الخريطة', 'On map') + '</button></td></tr>').join('') + '</table>' +
        '<p class="note">' + T('المسافة لأقرب حافة لمنطقة الظل الدائم (خط مستقيم). الحرارة السنوية من Diviner: الجليد بيضل ثابت على السطح تحت تقريباً 110 كلفن.', 'Distance to the nearest edge of the permanently shadowed region (straight line). Yearly temperatures from Diviner: ice stays stable on the surface below about 110 K.') + '</p>';
      $$('#iceNear [data-ice]').forEach((b) => (b.onclick = () => { go('ice'); setTimeout(() => Ice.select(+b.dataset.ice), 60); }));
    }
    function renderGeo() {
      const s = sel.site; let h = '';
      if (s) h += '<h3 style="margin-top:0">' + T('الجيولوجيا (من فريق الجيولوجيا)', 'Geology (from our geology team)') + '</h3><p class="note"><b>' + T('التضاريس:', 'Terrain:') + '</b> ' + T(s.terrain, s.terrain_en || s.terrain) + '<br><b>' + T('الصخور:', 'Rocks:') + '</b> ' + T(s.rock, s.rock_en || s.rock) + '<br><b>' + T('ملاحظة الهبوط:', 'Landing note:') + '</b> ' + T(s.landing, s.landing_en || s.landing) + '</p>';
      $('geoBox').innerHTML = h + '<div id="rockMix" class="note">…</div>';
      loadRocks().then((rm) => {
        if (!rm) return;
        const r = rm.at(sel.lat, sel.lon);
        if (!r) { $('rockMix').textContent = T('النقطة خارج خريطة الكيمياء.', 'This point is outside the chemistry map.'); return; }
        const MIX = [{ k: 'anorthosite', ar: T('أنورثوسيت (فاتح، غني بالفلسبار)', 'Anorthosite (bright, feldspar-rich)'), c: '#e9e4d6' }, { k: 'mafic', ar: T('بازلت / نوريت (غني بالحديد)', 'Basalt / norite (iron-rich)'), c: '#6b6f80' }, { k: 'kreep', ar: T('KREEP (غني بالثوريوم)', 'KREEP (thorium-rich)'), c: '#d6a451' }];
        $('rockMix').innerHTML = '<h3>' + T('التركيب الصخري التقديري من المدار', 'Estimated rock mix from orbit') + '</h3><div style="display:flex;height:16px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">' + MIX.map((m) => '<span style="width:' + r[m.k].toFixed(1) + '%;background:' + m.c + '"></span>').join('') + '</div>' +
          '<div class="legend" style="margin-top:8px">' + MIX.map((m) => '<span><i style="background:' + m.c + '"></i>' + m.ar + ' <b class="num">' + Math.round(r[m.k]) + '%</b></span>').join('') + '</div>' +
          '<p class="note">FeO <span class="num">' + r.FeO.toFixed(1) + ' wt%</span> · Th <span class="num">' + r.Th.toFixed(2) + ' ppm</span>' + T('، من مطياف أشعة غاما على Lunar Prospector. الدقة حوالي 45 كم، يعني هاي نسب المنطقة بشكل عام، مش صخرة بعينها. ', ', from the Lunar Prospector gamma-ray spectrometer. Resolution is about 45 km, so this is the mix for the wider area, not a single rock. ') + '<a href="data/rocks/south_pole_rock_mix.csv" download>' + T('تنزيل الجدول (CSV)', 'Download table (CSV)') + '</a></p>';
      });
    }
    function setTab(t) {
      curTab = t; $$('#sheetTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      $$('#sheet [data-p]').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t));
      if (t === 'light' && lastSer) { Charts.horizon($('cHorizon'), sel.model.elev, lastSer, { sunAz: lastSer.sunAz[0], sunAlt: lastSer.sunAlt[0], earthAz: lastSer.earthAz[0], earthAlt: lastSer.earthAlt[0] }, { height: 180 }); Charts.timeline($('cTimeline'), lastSer, { height: 180 }); }
      if (t === 'panel' && lastRose && lastSer) Charts.rose($('cRose'), lastRose, lastSer.sunAz[0], 260);
      if (t === 'battery' && redrawBattery) redrawBattery();
    }

    return {
      init() {
        $('siteSel').innerHTML = '<option value="">' + T('— اختار —', '— choose —') + '</option>' + S.sites.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
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
        $('layersBtn').onclick = () => $('layersPanel').classList.toggle('open');
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
    const wLab = (v) => (v <= 0 ? T('مش مهم', 'Not important') : v <= 3 ? T('منخفضة', 'Low') : v <= 6 ? T('متوسطة', 'Medium') : T('عالية', 'High'));
    function bindForm() {
      const f = clampT(Date.parse(isoDate(Date.now()) + 'T00:00:00Z'));
      $('pFrom').value = isoDate(f); $('pTo').value = isoDate(clampT(f + 30 * DAY));
      for (const id of ['pFrom', 'pTo', 'bDate', 'cmpFrom']) { $(id).min = isoDate(S.range[0]); $(id).max = isoDate(S.range[1] - DAY); }
      $('pDays').oninput = () => ($('pDaysLab').textContent = daysTxt(+$('pDays').value));
      $('lMin').oninput = () => ($('lMinLab').textContent = $('lMin').value + '%');
      $('lAz').oninput = () => ($('lAzLab').textContent = $('lAz').value + '°');
      $('mxSlope').oninput = () => ($('mxSlopeLab').textContent = $('mxSlope').value + '°');
      $('mxIce').oninput = () => ($('mxIceLab').textContent = $('mxIce').value + T(' كم', ' km'));
      for (const k of ['wIce', 'wComm', 'wLit']) $(k).oninput = () => ($(k + 'Lab').textContent = wLab(+$(k).value));
      $$('#presetSeg button').forEach((b) => (b.onclick = () => setPreset(b.dataset.p)));
      for (const id of ['lCap', 'lLoad', 'lArea', 'lEff']) $(id).addEventListener('input', () => $$('#presetSeg button').forEach((b) => b.classList.remove('on')));
      $$('#panelSeg button').forEach((b) => (b.onclick = () => { $$('#panelSeg button').forEach((x) => x.classList.toggle('on', x === b)); $('fixedAzBox').classList.toggle('hidden', b.dataset.m !== 'fixed'); }));
      $('lHib').onchange = () => { $('hibBox').classList.toggle('hidden', !$('lHib').checked); $('hibNote').classList.toggle('hidden', !$('lHib').checked); };
      setPreset('medium');
      $('btnRun').onclick = run;
      $('btnCheck').onclick = check;
      $('bDate').value = $('pFrom').value;
      fillSiteSelect();
    }
    function fillSiteSelect() {
      const opts = [];
      S.top.forEach((r, i) => opts.push(['top:' + i, suggested(i + 1) + ' · ' + placeName(r.lat, r.lon)]));
      if (picked) opts.push(['pick', T('النقطة اللي اخترتها على الخريطة', 'The point you picked on the map')]);
      S.sites.forEach((s) => opts.push(['site:' + s.id, s.name]));
      const cur = $('bSite').value;
      $('bSite').innerHTML = opts.map(([v, t]) => '<option value="' + v + '">' + esc(t) + '</option>').join('');
      if (opts.some((o) => o[0] === cur)) $('bSite').value = cur;
    }
    function siteFrom(v) {
      if (v.startsWith('top:')) { const r = S.top[+v.slice(4)]; return r && { lat: r.lat, lon: r.lon, name: suggested(+v.slice(4) + 1), cand: r.i, start: r.startMs }; }
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
        if (picked) L.push({ lat: picked.lat, lon: picked.lon, color: '#ffffff', r: 6, label: T('اختيارك', 'Your pick') });
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
      if (!(to >= from)) { $('runMsg').textContent = T('تاريخ النهاية لازم يكون بعد البداية.', 'The end date must be after the start date.'); return; }
      if (to + days * DAY > S.range[1]) { $('runMsg').textContent = T('جدول مواقع الشمس والأرض بيغطي لحد نهاية 2030؛ قصّر النافذة أو المدة.', 'Sun and Earth positions are available until the end of 2030; shorten the window or the mission.'); return; }
      $('btnRun').disabled = true; $('runMsg').textContent = T('جاري تحميل بيانات المواقع…', 'Loading site data…'); $('runProg').style.width = '3%';
      let w; try { w = await worker(); } catch (e) { $('runMsg').textContent = T('صار خطأ: ', 'Error: ') + e.message; $('btnRun').disabled = false; return; }
      const L = lander(), windowH = (to - from) / HOUR, missionH = days * 24, total = windowH + missionH;
      const opts = {
        t0: from, windowH, missionH, stepH: total > 2400 ? 3 : total > 1200 ? 2 : 1, startEveryH: windowH > 60 * 24 ? 48 : 24,
        loadW: L.loadW, capWh: L.capWh, minSoc: L.minSoc, panel: L.panel, hibernate: L.hibernate, sleepW: L.sleepW, wakeSoc: L.wakeSoc,
        weights: { ice: (+$('wIce').value / 10) * 0.5, comm: (+$('wComm').value / 10) * 0.45, light: (+$('wLit').value / 10) * 0.45, iceMaxKm: +$('mxIce').value },
        maxSlope: +$('mxSlope').value, minM3: $('iceStrong').checked ? 5 : 1, minSepKm: 6,
      };
      $('runMsg').textContent = T('جاري حساب ' + S.cand.n.toLocaleString('en-US') + ' موقع × كل أيام النافذة…', 'Testing ' + S.cand.n.toLocaleString('en-US') + ' sites × every day in the window…');
      const t0 = performance.now();
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') $('runProg').style.width = (5 + 95 * m.f).toFixed(0) + '%';
        if (m.type === 'error') { $('runMsg').textContent = T('صار خطأ: ', 'Error: ') + m.message; $('btnRun').disabled = false; }
        if (m.type === 'result') {
          $('runProg').style.width = '100%'; $('btnRun').disabled = false;
          S.cls = m.cls; S.top = m.top; S.lastRank = { opts, L, days };
          if (iceLayer) iceLayer.minM3 = opts.minM3;
          $('cSafe').textContent = '(' + m.counts.safe + ')'; $('cCaution').textContent = '(' + m.counts.caution + ')'; $('cRisky').textContent = '(' + m.counts.risky + ')';
          $('runMsg').textContent = T('خلص بـ ' + ((performance.now() - t0) / 1000).toFixed(1) + ' ثانية.', 'Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s.');
          renderTop(); fillSiteSelect(); if (S.top.length) { $('bSite').value = 'top:0'; $('bDate').value = isoDate(S.top[0].startMs); check(); }
          map.render(); Explore.refreshTop(); Cmp.refreshOptions();
        }
      };
      w.postMessage({ type: 'rank', opts });
    }
    function renderTop() {
      const L = S.lastRank.L;
      if (!S.top.length) { $('topList').innerHTML = '<div class="callout bad">' + T('ما في ولا موقع بتضل فيه المركبة عايشة لآخر المهمة بهاي الإعدادات. جرّب بطارية أكبر، أو استهلاك أقل، أو مهمة أقصر، أو فعّل «بتقدر تنام وتصحى» مع وضع نوم أقل.', 'No site keeps the lander alive to the end of the mission with these settings. Try a bigger battery, a lower power draw, a shorter mission, or turn on “can sleep and wake up” with a lower sleep power.') + '</div>'; return; }
      $('topList').innerHTML = S.top.map((r, i) => {
        const ice = r.iceId >= 0 ? S.ice.psr[r.iceId] : null;
        return '<div class="result' + (i === 0 ? ' sel' : '') + '" style="margin-bottom:10px">' +
          '<div class="r-head"><div class="rank">' + (i + 1) + '</div><div style="flex:1"><b>' + esc(placeName(r.lat, r.lon)) + '</b><div class="muted small num" style="text-align:right">' + fmtLL(r.lat, r.lon) + '</div></div>' + tag(r.cls, CLS_AR[r.cls]) + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><i style="width:' + r.score.toFixed(0) + '%"></i></div><b class="num">' + r.score.toFixed(0) + '/100</b></div>' +
          '<div class="mini"><div>' + T('الهبوط', 'Landing') + '<b>' + isoDate(r.startMs).slice(5) + '</b></div><div>' + T('شمس', 'Sun') + '<b>' + pct(r.litPct) + '</b></div><div>' + T('اتصال', 'Contact') + '<b>' + pct(r.commPct) + '</b></div>' +
          (r.ok ? '<div>' + T('أقل شحن', 'Min charge') + '<b>' + Math.round(r.minSoc * 100) + '%</b></div>' : '<div>' + T('وقت الشغل', 'Uptime') + '<b>' + Math.round(r.uptimePct) + '%</b></div>') + '<div>' + T('انحدار', 'Slope') + '<b>' + r.slope.toFixed(1) + '°</b></div><div>' + T('للجليد', 'To ice') + '<b>' + (r.iceKm < 0.05 ? '0' : r.iceKm.toFixed(1)) + ' km</b></div></div>' +
          '<div class="note" style="line-height:1.6">' + (r.ok ? T('شغّالة طول المهمة بدون نوم. ', 'Works through the whole mission without sleeping. ') : T('بتنام ' + times(r.sleeps) + ' بالظلمة وبتصحى (أطول نوم ' + dur(r.longestSleepH) + '). ', 'Sleeps ' + times(r.sleeps) + ' in the dark and wakes up (longest sleep ' + dur(r.longestSleepH) + '). ')) +
            T('أقرب جليد: ', 'Nearest ice: ') + (ice ? esc(iceName(ice)) + ' (' + ice.m3 + T(' رصد)', ice.m3 === 1 ? ' detection)' : ' detections)') : '—') + '. ' + T('أطول ظلمة ' + dur(r.longestDarkH) + '، وأطول انقطاع اتصال ' + dur(r.longestNoCommH) + '.', 'Longest darkness ' + dur(r.longestDarkH) + ', longest blackout ' + dur(r.longestNoCommH) + '.') + '</div>' +
          '<div class="acts"><button class="btn sm gold" data-act="3d" data-i="' + i + '">' + T('افتح ثلاثي الأبعاد', 'Open in 3D') + '</button><button class="btn sm" data-act="chk" data-i="' + i + '">' + T('فحص الطاقة', 'Power check') + '</button><button class="btn sm" data-act="cmp" data-i="' + i + '">' + T('قارن', 'Compare') + '</button><button class="btn sm" data-act="zoom" data-i="' + i + '">' + T('على الخريطة', 'On map') + '</button></div></div>';
      }).join('') + '<p class="note">' + T('الموقع لازم يكون بعيد 6 كم على الأقل عن غيره، عشان تطلعلك 3 خيارات مختلفة فعلاً. العلامة بتجمع: الإضاءة، والاتصال، وهامش البطارية، والانحدار، والقرب من الجليد حسب الأولويات اللي اخترتها.', 'Sites must be at least 6 km apart so you get 3 genuinely different options. The score combines sunlight, Earth contact, battery margin, slope and distance to ice, weighted by your priorities.') + '</p>';
      $$('#topList [data-act]').forEach((b) => (b.onclick = () => {
        const i = +b.dataset.i, r = S.top[i];
        if (b.dataset.act === '3d') Explore.openAt(r.lat, r.lon, suggested(i + 1));
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
      $('checkOut').innerHTML = '<p class="note">' + T('جاري الحساب…', 'Calculating…') + '</p>';
      let model;
      if (s.cand != null && S.cand) model = { lat: s.lat, lon: s.lon, h: S.cand.h[s.cand], hfn: S.cand.horizonFn(s.cand), elev: S.cand.horizonArray(s.cand), slope: S.cand.slope[s.cand] };
      else model = await siteModel(s.lat, s.lon);
      const ser = series(model, t0, days * 24, 1), rep = batteryReport(ser, L, 0, ser.n), a = stats(ser);
      const ni = nearestIce(s.lat, s.lon, 1), rose = Planner.panelRose(ser, L.panel);
      const lt = (v) => '<span class="ltr">' + v + '</span>';
      $('checkOut').innerHTML = '<div class="muted small" style="margin-bottom:8px;line-height:1.8"><b>' + esc(s.name) + '</b>' +
        T('، هبوط <span class="num">' + isoDate(t0) + '</span> لمدة ' + days + ' يوم. بطارية ' + lt(fmtWh(L.capWh)) + '، استهلاك ' + lt(L.loadW + ' W') + '، ألواح ' + lt(L.panel.area + ' m²') + (L.hibernate ? '، بتنام على ' + lt(L.sleepW + ' W') : '، ما بتنام') + '.',
          ', landing <span class="num">' + isoDate(t0) + '</span> for ' + daysTxt(days) + '. Battery ' + lt(fmtWh(L.capWh)) + ', draw ' + lt(L.loadW + ' W') + ', panels ' + lt(L.panel.area + ' m²') + (L.hibernate ? ', sleeps at ' + lt(L.sleepW + ' W') : ', cannot sleep') + '.') + '</div>' +
        batteryHTML(rep, ser, L) + STATE_LEGEND + '<canvas class="chart" id="chkStates"></canvas>' +
        '<canvas class="chart" id="chkSoc" style="margin-top:10px"></canvas>' +
        '<div class="metrics" style="margin-top:10px"><div class="metric"><div class="lab">' + T('الشمس ظاهرة', 'Sun visible') + '</div><div class="val">' + pct(a.litPct) + '</div></div><div class="metric"><div class="lab">' + T('الأرض ظاهرة', 'Earth visible') + '</div><div class="val">' + pct(a.commPct) + '</div></div><div class="metric"><div class="lab">' + T('أطول ظلمة', 'Longest darkness') + '</div><div class="val">' + durNum(a.darkH) + '</div></div>' +
        '<div class="metric"><div class="lab">' + T('طاقة داخلة', 'Energy in') + '</div><div class="val">' + (rep.b.energyInWh / 1000).toFixed(1) + ' <small>kWh</small></div></div><div class="metric"><div class="lab">' + T('مستهلكة', 'Energy used') + '</div><div class="val">' + (rep.b.energyOutWh / 1000).toFixed(1) + ' <small>kWh</small></div></div><div class="metric"><div class="lab">' + T('للجليد', 'To ice') + '</div><div class="val">' + (ni ? (ni.km < 0.05 ? '0' : ni.km.toFixed(1)) : '—') + ' <small>km</small></div></div></div>' +
        '<div class="callout info" style="margin-top:10px">☀ ' + T('<b>اتجاه الألواح بهاي المهمة:</b> إذا الألواح ثابتة، أفضل اتجاه هو السمت ', '<b>Panel direction for this mission:</b> if the panels are fixed, the best azimuth is ') + '<b class="num">' + rose.bestAz + '°</b>' + T('، وبيعطي ', ', giving ') + '<b class="num">' + Math.round(100 * rose.bestWh / Math.max(1, rose.trackWh)) + '%</b>' + T(' من طاقة لوح بيلف مع الشمس.', ' of the energy of a Sun-tracking panel.') + (L.panel.mode === 'fixed' ? T(' (أنت مختار سمت ', ' (You chose azimuth ') + '<span class="num">' + L.panel.azimuth + '°</span>.)' : '') + '</div>';
      Charts.states($('chkStates'), ser, rep.b.state, 0);
      Charts.soc($('chkSoc'), [{ soc: rep.b.soc, state: rep.b.state, stepH: 1, t0, color: '#d6a451' }], L.minSoc, { height: 140 });
    }
    return {
      bindForm,
      init() { initMap().catch((e) => { console.error(e); $('runMsg').textContent = T('ما قدرت أحمّل بيانات الخريطة: ', 'Could not load the map data: ') + e.message; }); },
      shown() { if (map) { map.resize(); map.render(); } },
    };
  })();

  // ================================================================== COMPARE
  const Cmp = (() => {
    let map = null, pickSlot = 'A';
    function options() {
      const o = [];
      S.top.forEach((r, i) => o.push(['top:' + i, suggested(i + 1) + ' · ' + placeName(r.lat, r.lon)]));
      if (S.picks.A) o.push(['pick:A', T('نقطتك A · ', 'Your point A · ') + placeName(S.picks.A.lat, S.picks.A.lon)]);
      if (S.picks.B) o.push(['pick:B', T('نقطتك B · ', 'Your point B · ') + placeName(S.picks.B.lat, S.picks.B.lon)]);
      S.sites.forEach((s) => o.push(['site:' + s.id, s.name]));
      S.ice.psr.filter((p) => p.name && p.m3 >= 10).forEach((p) => o.push(['ice:' + p.id, T('داخل ' + p.name + ' (ظل دائم)', 'Inside ' + p.name + ' (permanent shadow)')]));
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
      if (v.startsWith('top:')) { const r = S.top[+v.slice(4)]; return r && { lat: r.lat, lon: r.lon, name: suggested(+v.slice(4) + 1) }; }
      if (v.startsWith('pick:')) { const p = S.picks[v.slice(5)]; return p && { lat: p.lat, lon: p.lon, name: p.name || placeName(p.lat, p.lon) }; }
      if (v.startsWith('site:')) { const s = S.sites.find((x) => x.id === v.slice(5)); return s && { lat: s.lat, lon: s.lon, name: s.name }; }
      if (v.startsWith('ice:')) { const p = S.ice.psr[+v.slice(4)]; return p && { lat: p.lat, lon: p.lon, name: p.name }; }
      return null;
    }
    function coords() { for (const k of ['A', 'B']) { const s = resolve($('cmp' + k).value); $('cmp' + k + 'c').textContent = s ? fmtLL(s.lat, s.lon) : ''; } if (map) map.render(); }
    // part of a series as its own series (for panelRose over the mission only)
    function sub(ser, i0, i1) {
      const o = { n: i1 - i0, stepH: ser.stepH };
      for (const k of ['t', 'lit', 'comm', 'flux', 'sunAlt', 'sunAz']) if (ser[k]) o[k] = ser[k].subarray ? ser[k].subarray(i0, i1) : ser[k].slice(i0, i1);
      return o;
    }
    // everything we need about one site for one mission
    function evalSite(model, ser, L, fair, mSteps, windowH) {
      const st = ser.stepH, gen = Planner.panelPower(ser, L.panel);
      let i0 = 0;
      if (fair) { const best = Planner.evaluateMission(ser, gen, Object.assign({ missionH: mSteps * st, windowH, startEveryH: 24 }, L)); if (best) i0 = best.start; }
      const i1 = i0 + mSteps, rep = batteryReport(ser, L, i0, i1), a = stats(ser, i0, i1);
      let E = 0; for (let k = i0; k < i1; k++) E += gen[k];
      const rose = Planner.panelRose(sub(ser, i0, i1), L.panel);
      const ice = nearestIce(model.lat, model.lon, 1);
      return { model, ser, gen, i0, i1, rep, b: rep.b, a, meanW: E / mSteps, rose, ice, t0: ser.t[i0] };
    }
    const slopeTag = (d) => d == null ? '' : d > 15 ? ' <span class="tag risky">' + T('خطر للهبوط', 'Unsafe to land') + '</span>' : d > 8 ? ' <span class="tag caution">' + T('انتبه', 'Careful') + '</span>' : ' <span class="tag safe">' + T('مناسب', 'Good') + '</span>';
    function statusCell(x) {
      const b = x.b;
      if (b.ok) return '<span class="tag safe">' + T('اشتغلت كل المهمة', 'Worked all mission') + '</span>';
      if (b.alive) return '<span class="tag caution">' + T('نامت ' + times(b.sleeps) + ' وصحيت', 'Slept ' + times(b.sleeps) + ', woke up') + '</span>';
      return '<span class="tag risky">' + T('انتهت بعد ', 'Lost after ') + dur(b.deadHour) + '</span>';
    }
    function darkCell(x) {
      const d = x.rep.dark;
      if (!d) return T('ما في ظلمة', 'No darkness');
      return d.startH === 0 ? T('هبطت بالظلمة', 'Landed in darkness') : T('بعد ', 'after ') + durNum(d.startH);
    }
    // weighted score used only when both sites behave the same way for the lander
    function wscore(x) {
      const sl = x.model.slope == null ? 10 : x.model.slope, ik = x.ice ? x.ice.km : 30;
      const batt = x.b.ok ? 0.5 + 0.5 * x.b.minSoc : x.b.alive ? 0.5 * x.b.uptimePct / 100 : 0.25 * x.b.uptimePct / 100;
      return 100 * (0.25 * x.a.litPct / 100 + 0.2 * x.a.commPct / 100 + 0.15 * Math.max(0, 1 - sl / 15) + 0.2 * Math.max(0, 1 - ik / 15) + 0.2 * batt);
    }
    async function run() {
      const A = resolve($('cmpA').value), B = resolve($('cmpB').value); if (!A || !B) return;
      $('cmpTable').innerHTML = '<p class="note">' + T('جاري الحساب (تحميل التضاريس أول مرة بياخد ثواني)…', 'Calculating (the first terrain load takes a few seconds)…') + '</p>';
      await new Promise((r) => setTimeout(r, 30));
      const days = +$('cmpDays').value, fair = $('cmpFair').value === 'best', st = days > 90 ? 2 : 1;
      const tFrom = clampT(Date.parse($('cmpFrom').value + 'T00:00:00Z')), availH = Math.floor((S.range[1] - tFrom) / HOUR) - 2;
      const missionH = Math.min(days * 24, availH), windowH = fair ? Math.max(0, Math.min(30 * 24, availH - missionH)) : 0;
      const mSteps = Math.max(1, Math.floor(missionH / st)), L = lander();
      const [mA, mB] = [await siteModel(A.lat, A.lon), await siteModel(B.lat, B.lon)];
      const sA = series(mA, tFrom, missionH + windowH + st, st), sB = series(mB, tFrom, missionH + windowH + st, st);
      const X = evalSite(mA, sA, L, fair, mSteps, windowH), Y = evalSite(mB, sB, L, fair, mSteps, windowH);

      // ---- rows: [label, A html, B html, winner (+1 A, -1 B, 0 none)]
      const better = (va, vb, tol, lowerWins) => { const d = (lowerWins ? vb - va : va - vb); return Math.abs(d) < tol ? 0 : Math.sign(d); };
      const lander_ok = (x) => x.b.alive;
      const ltr = (t) => '<span class="ltr">' + t + '</span>';
      const P = (v) => '<span class="num">' + Math.round(v) + '%</span>';
      const iceTxt = (x) => !x.ice ? '—' : x.ice.km < 0.05 ? T('داخل منطقة جليد', 'Inside an ice region') : '<span class="num">' + x.ice.km.toFixed(1) + ' km</span>';
      const needTxt = (x) => x.b.ok ? '<span class="muted">' + T('بطاريتك بتكفي', 'Your battery is enough') + '</span>' : '<span class="num">' + fmtWh(Math.ceil(x.b.neededCapWh / 100) * 100) + '</span>';
      const groups = [
        [T('التضاريس', 'Terrain'), [
          [T('الارتفاع', 'Elevation'), '<span class="num">' + Math.round(mA.h) + ' m</span>', '<span class="num">' + Math.round(mB.h) + ' m</span>', 0],
          [T('الانحدار', 'Slope'), (mA.slope != null ? '<span class="num">' + mA.slope.toFixed(1) + '°</span>' : '—') + slopeTag(mA.slope), (mB.slope != null ? '<span class="num">' + mB.slope.toFixed(1) + '°</span>' : '—') + slopeTag(mB.slope),
            mA.slope != null && mB.slope != null ? better(mA.slope, mB.slope, 1, true) : 0],
        ]],
        [T('الشمس والطاقة', 'Sunlight & power'), [
          [T('الشمس ظاهرة', 'Sun visible'), P(X.a.litPct), P(Y.a.litPct), better(X.a.litPct, Y.a.litPct, 2)],
          [T('أول ظلمة بعد الهبوط', 'First darkness after landing'), darkCell(X), darkCell(Y), better(X.rep.dark ? X.rep.dark.startH : 1e9, Y.rep.dark ? Y.rep.dark.startH : 1e9, 12)],
          [T('أطول ظلمة', 'Longest darkness'), durNum(X.a.darkH), durNum(Y.a.darkH), better(X.a.darkH, Y.a.darkH, 6, true)],
          [T('متوسط إنتاج ألواحك (', 'Mean output of your panels (') + ltr(L.panel.area + ' m² · ' + Math.round(L.panel.efficiency * 100) + '%') + ')', '<span class="num">' + Math.round(X.meanW) + ' W</span>', '<span class="num">' + Math.round(Y.meanW) + ' W</span>', better(X.meanW, Y.meanW, Math.max(2, 0.03 * Math.max(X.meanW, Y.meanW)))],
          [T('أفضل اتجاه للوح ثابت', 'Best fixed-panel azimuth'), '<span class="num">' + X.rose.bestAz + '°</span>', '<span class="num">' + Y.rose.bestAz + '°</span>', 0],
        ]],
        [T('الاتصال مع الأرض', 'Contact with Earth'), [
          [T('الأرض ظاهرة', 'Earth visible'), P(X.a.commPct), P(Y.a.commPct), better(X.a.commPct, Y.a.commPct, 2)],
          [T('أطول انقطاع', 'Longest blackout'), durNum(X.a.gapH), durNum(Y.a.gapH), better(X.a.gapH, Y.a.gapH, 6, true)],
        ]],
        [T('المركبة (', 'Lander (') + ltr(fmtWh(L.capWh) + ' · ' + L.loadW + ' W') + ')', [
          [T('حالة المركبة', 'Lander status'), statusCell(X), statusCell(Y), 0],
          [T('وقت الشغل من المهمة', 'Uptime during the mission'), P(X.b.uptimePct), P(Y.b.uptimePct), better(X.b.uptimePct, Y.b.uptimePct, 1)],
          [T('بطارية لازمة عشان ما تنام', 'Battery needed to never sleep'), needTxt(X), needTxt(Y), better(X.b.neededCapWh, Y.b.neededCapWh, 0.05 * Math.max(X.b.neededCapWh, Y.b.neededCapWh, 100), true)],
        ]],
        [T('الجليد', 'Water ice'), [
          [T('أقرب جليد مرصود', 'Nearest detected ice'), iceTxt(X), iceTxt(Y), X.ice && Y.ice ? better(X.ice.km, Y.ice.km, 0.3, true) : 0],
        ]],
      ];
      // no gold on a lander row for a site where the lander is lost
      groups[3][1].forEach((r) => { if ((r[3] > 0 && !lander_ok(X)) || (r[3] < 0 && !lander_ok(Y))) r[3] = 0; });

      // ---- verdict: survival first, then sleeping / uptime, then weighted score
      const nameA = esc(A.name), nameB = esc(B.name), num = (v) => '<span class="num">' + v + '</span>';
      const slopeWarn = (m, n) => m.slope != null && m.slope > 15 ? T(' <b>بس انتبه:</b> انحدار ' + n + ' ' + num(m.slope.toFixed(1) + '°') + ' أعلى من الحد الآمن للهبوط (15°).', ' <b>But note:</b> the slope at ' + n + ' (' + num(m.slope.toFixed(1) + '°') + ') is above the safe landing limit (15°).') : '';
      const wa = wscore(X), wb = wscore(Y);
      let cls = 'ok', msg;
      if (X.b.alive !== Y.b.alive) {
        const [w, l, wn, ln, wm] = X.b.alive ? [X, Y, nameA, nameB, mA] : [Y, X, nameB, nameA, mB];
        msg = T('<b>' + wn + ' أفضل للمهمة.</b> المركبة بتضل عايشة فيه لآخر المهمة' + (w.b.ok ? ' وبتشتغل طول الوقت' : ' (بتنام ' + times(w.b.sleeps) + ' وبتصحى، وشغالة ' + P(w.b.uptimePct) + ' من الوقت)') + '، أما بـ' + ln + ' بتنتهي بعد ' + dur(l.b.deadHour) + '.',
          '<b>' + wn + ' is better for this mission.</b> The lander survives there to the end' + (w.b.ok ? ' and works the whole time' : ' (it sleeps ' + times(w.b.sleeps) + ' and wakes up, working ' + P(w.b.uptimePct) + ' of the time)') + ', while at ' + ln + ' it is lost after ' + dur(l.b.deadHour) + '.') + slopeWarn(wm, wn);
      } else if (!X.b.alive) {
        cls = 'bad';
        const longer = X.b.deadHour === Y.b.deadHour ? null : X.b.deadHour > Y.b.deadHour ? nameA : nameB;
        const capA = '<span class="ltr">' + fmtWh(Math.ceil(X.b.neededCapWh / 100) * 100) + '</span>', capB = '<span class="ltr">' + fmtWh(Math.ceil(Y.b.neededCapWh / 100) * 100) + '</span>';
        msg = T('<b>ولا موقع بتنجح فيه المهمة بهاي المركبة.</b> بـ' + nameA + ' بتنتهي بعد ' + dur(X.b.deadHour) + '، وبـ' + nameB + ' بعد ' + dur(Y.b.deadHour) + (longer ? '، يعني ' + longer + ' بيصمد أطول' : '') + '.' +
            ' عشان تنجح: بطارية حوالي ' + capA + ' لـ A أو ' + capB + ' لـ B، ' + (L.hibernate ? 'أو وضع نوم أقل استهلاكاً.' : 'أو فعّل «المركبة بتقدر تنام وتصحى» من إعدادات المركبة بالمخطط.'),
          '<b>The mission fails at both sites with this lander.</b> At ' + nameA + ' it is lost after ' + dur(X.b.deadHour) + ', at ' + nameB + ' after ' + dur(Y.b.deadHour) + (longer ? ', so ' + longer + ' lasts longer' : '') + '.' +
            ' To succeed: a battery of about ' + capA + ' for A or ' + capB + ' for B, ' + (L.hibernate ? 'or a lower-power sleep mode.' : 'or turn on “can sleep and wake up” in the planner’s lander settings.'));
      } else if (X.b.ok !== Y.b.ok) {
        const [w, l, wn, ln, wm] = X.b.ok ? [X, Y, nameA, nameB, mA] : [Y, X, nameB, nameA, mB];
        msg = T('<b>' + wn + ' أفضل للمهمة.</b> المركبة بتشتغل فيه كل المهمة بدون ما تنام، أما بـ' + ln + ' بتنام ' + times(l.b.sleeps) + ' وبتشتغل ' + P(l.b.uptimePct) + ' بس من الوقت.',
          '<b>' + wn + ' is better for this mission.</b> The lander works there for the whole mission without sleeping, while at ' + ln + ' it sleeps ' + times(l.b.sleeps) + ' and works only ' + P(l.b.uptimePct) + ' of the time.') + slopeWarn(wm, wn);
      } else if (Math.abs(X.b.uptimePct - Y.b.uptimePct) >= 5) {
        const [w, l, wn, ln, wm] = X.b.uptimePct > Y.b.uptimePct ? [X, Y, nameA, nameB, mA] : [Y, X, nameB, nameA, mB];
        cls = 'warn';
        msg = T('<b>' + wn + ' أفضل للمهمة.</b> بالموقعين المركبة بتنام بالظلمة وبتصحى، بس بـ' + wn + ' بتشتغل ' + P(w.b.uptimePct) + ' من الوقت مقابل ' + P(l.b.uptimePct) + ' بـ' + ln + '.',
          '<b>' + wn + ' is better for this mission.</b> At both sites the lander sleeps through the dark and wakes up, but at ' + wn + ' it works ' + P(w.b.uptimePct) + ' of the time versus ' + P(l.b.uptimePct) + ' at ' + ln + '.') + slopeWarn(wm, wn);
      } else if (Math.abs(wa - wb) < 2) {
        cls = 'info';
        msg = T('<b>الموقعين متقاربين جداً.</b> المركبة بتتصرف بنفس الطريقة بالاثنين، والعلامة الكلية متقاربة (' + num(Math.round(wa)) + ' مقابل ' + num(Math.round(wb)) + '). اختار حسب الإشي الأهم لمهمتك:',
          '<b>The two sites are very close.</b> The lander behaves the same way at both, and the overall scores are close (' + num(Math.round(wa)) + ' vs ' + num(Math.round(wb)) + '). Choose by what matters most for your mission:');
      } else {
        const [wn, m, hi, lo] = wa > wb ? [nameA, mA, wa, wb] : [nameB, mB, wb, wa];
        msg = T('<b>' + wn + ' أفضل.</b> المركبة بتتصرف بنفس الطريقة بالموقعين، فالحسم كان بالعلامة الكلية (الشمس والاتصال والانحدار والجليد): ' + num(Math.round(hi)) + ' مقابل ' + num(Math.round(lo)) + ' من 100.',
          '<b>' + wn + ' is better.</b> The lander behaves the same way at both sites, so the overall score decides (sunlight, contact, slope and ice): ' + num(Math.round(hi)) + ' vs ' + num(Math.round(lo)) + ' out of 100.') + slopeWarn(m, wn);
      }
      const short = (t) => t.replace(/<[^>]+>/g, '').replace(/\s*\(.*\)\s*$/, '');
      const wins = (sg) => groups.flatMap(([, rows]) => rows.filter((r) => r[3] === sg).map((r) => short(r[0])));
      const wA = wins(1), wB = wins(-1), betterAt = T(' أحسن بـ: ', ' is better at: ');
      if (wA.length || wB.length) msg += '<div class="small" style="margin-top:8px;line-height:1.9">' + (wA.length ? '<b style="color:var(--gold2)">A</b>' + betterAt + wA.join(SEP) + '.' : '') + (wA.length && wB.length ? '<br>' : '') + (wB.length ? '<b style="color:var(--earth)">B</b>' + betterAt + wB.join(SEP) + '.' : '') + '</div>';
      const mDays = Math.round(missionH / 24);
      const when = fair
        ? T('كل موقع انحسب بأفضل يوم هبوط خلال شهر من ' + num(isoDate(tFrom)) + ': هبوط A ' + num(isoDate(X.t0)) + '، وهبوط B ' + num(isoDate(Y.t0)) + '. مدة المهمة ' + mDays + ' يوم.',
          'Each site uses its best landing day within a month of ' + num(isoDate(tFrom)) + ': A lands ' + num(isoDate(X.t0)) + ', B lands ' + num(isoDate(Y.t0)) + '. Mission length ' + daysTxt(mDays) + '.')
        : T('الموقعين بنفس يوم الهبوط ' + num(isoDate(tFrom)) + ' لمدة ' + mDays + ' يوم.', 'Both sites land on ' + num(isoDate(tFrom)) + ' for ' + daysTxt(mDays) + '.');
      const head = (k, n) => '<span class="badge" style="display:inline-grid;width:22px;height:22px;border-radius:7px;background:' + (k === 'A' ? 'var(--gold);color:#1d1408' : 'var(--earth);color:#0b1a2a') + ';place-items:center;font-size:12px;font-weight:700">' + k + '</span> ' + n;
      $('cmpTable').innerHTML =
        '<div class="callout ' + cls + '" style="margin-bottom:12px">' + msg + '</div>' +
        '<table class="tbl cmp"><tr><th>' + T('المعيار', 'Criterion') + '</th><th>' + head('A', nameA) + '</th><th>' + head('B', nameB) + '</th></tr>' +
        groups.map(([g, rows]) => '<tr class="grp"><td colspan="3">' + g + '</td></tr>' +
          rows.map((r) => '<tr><td>' + r[0] + '</td><td' + (r[3] > 0 ? ' class="win"' : '') + '>' + r[1] + '</td><td' + (r[3] < 0 ? ' class="win"' : '') + '>' + r[2] + '</td></tr>').join('')).join('') +
        '</table><p class="note" style="margin-top:10px">' + when + T(' الذهبي يعني الأفضل بهذا المعيار. القرار بيمشي بالترتيب: هل المركبة بتضل عايشة؟ هل بتنام؟ كم بتشتغل من الوقت؟ وبعدها العلامة الكلية.', ' Gold marks the better value for each criterion. The verdict goes in order: does the lander survive? does it have to sleep? how much of the time does it work? and only then the overall score.') + '</p>';
      $('cmpCharts').classList.remove('hidden');
      Charts.horizon($('cmpHz'), mA.elev, null, null, { second: mB.elev, height: 170 });
      Charts.soc($('cmpSoc'), [{ soc: X.b.soc, stepH: st, t0: X.t0, color: '#d6a451' }, { soc: Y.b.soc, stepH: st, t0: Y.t0, color: '#6fa8dc' }], L.minSoc, { height: 150, relative: fair });
      Charts.states($('cmpTlA'), sA, X.b.state, X.i0); Charts.states($('cmpTlB'), sB, Y.b.state, Y.i0);
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
    const COLS = [['name', T('المنطقة', 'Region')], ['lat', T('العرض', 'Lat')], ['lon', T('الطول', 'Lon')], ['area_km2', T('المساحة km²', 'Area km²')], ['m3', T('رصدات M3', 'M3 detections')], ['T_max', T('أعلى حرارة K', 'Max temp K')], ['WEH_max_wt', T('هيدروجين WEH %', 'Hydrogen WEH %')]];
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
      $('iceDetail').innerHTML = '<div class="sec-title" style="margin-bottom:4px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M4 6l16 12M20 6L4 18"/></svg>' + esc(iceName(p)) + ' ' + tag('ice', p.m3 + T(' رصد جليد', p.m3 === 1 ? ' ice detection' : ' ice detections')) + '</div>' +
        '<div class="muted small num" style="text-align:right">' + fmtLL(p.lat, p.lon) + '</div>' +
        '<div class="metrics" style="margin-top:12px"><div class="metric"><div class="lab">' + T('المساحة', 'Area') + '</div><div class="val">' + p.area_km2 + ' <small>km²</small></div></div>' +
        '<div class="metric"><div class="lab">' + T('الحرارة (أدنى / أعلى)', 'Temperature (min / max)') + '</div><div class="val" style="font-size:18px">' + (p.T_min ? Math.round(p.T_min) + ' / ' + Math.round(p.T_max) + ' <small>K</small>' : '—') + '</div></div>' +
        '<div class="metric"><div class="lab">' + T('هيدروجين (متوسط)', 'Hydrogen (mean)') + '</div><div class="val">' + (p.H_mean_ppm != null ? Math.round(p.H_mean_ppm) : '—') + ' <small>ppm</small></div></div></div>' +
        '<dl class="kv" style="margin-top:12px"><dt>' + T('أقصى ماء مكافئ (WEH)', 'Max water-equivalent hydrogen (WEH)') + '</dt><dd>' + (p.WEH_max_wt != null ? p.WEH_max_wt + ' wt%' : '—') + '</dd>' +
        '<dt>' + T('انحدار الوصول', 'Access slope') + '</dt><dd>' + esc(p.access || '—') + '°</dd>' +
        '<dt>' + T('أقرب موقع هبوط (انحدار ≤ 10° / 15° / 20°)', 'Nearest landing spot (slope ≤ 10° / 15° / 20°)') + '</dt><dd>' + (d.length ? d.slice(0, 3).map((v) => (v ? (v / 1000).toFixed(1) + ' km' : '—')).join(' / ') : '—') + '</dd>' +
        '<dt>' + T('أعلى إضاءة ضمن 1 / 5 / 10 كم', 'Best illumination within 1 / 5 / 10 km') + '</dt><dd>' + (il.length ? il.map((v) => Math.round(v * 100) + '%').join(' / ') : '—') + '</dd></dl>' +
        '<p class="note">' + (p.T_max && p.T_max < 110 ? T('أعلى حرارة هون أقل من 110 كلفن طول السنة، فالجليد بيقدر يضل ثابت حتى على السطح.', 'The maximum temperature here stays below 110 K all year, so ice can stay stable even on the surface.') : p.T_max ? T('الحرارة بتطلع فوق 110 كلفن بأجزاء من المنطقة، فالجليد غالباً بيكون مدفون تحت السطح شوي.', 'Parts of the region rise above 110 K, so ice there is most likely buried a little below the surface.') : '') + '</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold sm" id="iceTo3d">' + T('افتح ثلاثي الأبعاد', 'Open in 3D') + '</button><button class="btn sm" id="iceToCmp">' + T('استخدمها بالمقارنة', 'Use in comparison') + '</button></div>';
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
      const cards = EN ? [
        ['Data', '<ul><li><b>Terrain:</b> the LOLA elevation map from LRO for everything south of 80° (80 m resolution). We reduced it to three nested layers: 80 m near the pole, 160 m, and 640 m for distant mountains.</li><li><b>Sun and Earth positions:</b> from JPL’s NAIF SPICE kernels (DE421), hour by hour from 2026 to 2030, in the same frame as LOLA (MOON_ME). Checked against SPICE to better than 0.001°.</li><li><b>Ice:</b> 169 permanently shadowed regions with M3 ice detections, with temperature (Diviner) and hydrogen (Lemelin et al. 2021).</li><li><b>Rocks:</b> iron and thorium from Lunar Prospector.</li></ul>'],
        ['Light and horizon', 'For every point we cast 720 rays around it (every half degree) out to 300 km, and find the highest mountain angle in each direction, including the Moon’s curvature. The Sun is a disc about half a degree wide, so we compute the <b>visible fraction of the disc</b> above the mountains, not just its centre. This captures partial light when the Sun grazes a peak.'],
        ['Contact with Earth', 'Direct contact is possible when <b>the centre of Earth is above the real horizon</b> seen from the site, with Earth’s position computed from that point on the surface (not from the Moon’s centre). This is geometry only: we do not model signal strength or ground-station schedules on Earth.'],
        ['Power and panel direction', 'The Sun at the pole is very low (under 2° above the horizon), so the best panel is <b>vertical</b>. Power = 1361 W/m² × (1 AU / distance)² × efficiency × area × visible fraction of the disc × cosine of the Sun’s altitude. For a fixed panel we also multiply by the cosine of the angle between the Sun and the panel’s facing, and try 72 directions to find the best one.'],
        ['Battery and sleep', 'An hour-by-hour simulation: energy from the panels minus consumption, with the battery starting full and never exceeding its capacity. The lander has 3 states: <b>working</b>; <b>asleep</b> (when the charge drops below the limit it turns everything off except the heaters and waits for the Sun, waking when the charge recovers to the level you chose); and <b>lost</b> (if the battery runs flat while asleep the heaters stop and the cold destroys the electronics; a lander that cannot sleep is lost as soon as the charge falls below the limit). This shows whether a site keeps the lander alive, how much of the time it works, and how big a battery it needs to never sleep.'],
        ['Choosing the top 3 sites', 'We precomputed the horizon for <b>11,844</b> points on a 2 km grid around the pole (slope ≤ 15° and long-term illumination ≥ 20%). When you run the planner, each point is tested on every landing day in the window. Landing must be in sunlight when possible. The first condition is that the lander survives to the end of the mission (best if it never sleeps, then the most uptime); then the score combines sunlight, Earth contact, battery margin, slope and distance to ice according to your priorities. The 3 sites are at least 6 km apart.'],
        ['Limits of accuracy (honestly)', '<ul><li>The grid is 2 km, so very small peaks can be missed. Open any site in the explorer for an exact calculation at 80 m.</li><li>Slope is measured over 160 m, so it does not see small boulders or pits. That needs LROC NAC images at metre scale.</li><li>Illumination is computed 2 m above the surface. A taller mast sees more Sun.</li><li>An educational and research model, not a replacement for formal engineering analysis.</li></ul>'],
        ['Download the data (for students and researchers)', '<ul><li><a href="data/grid/grid.json" target="_blank">1 km polar maps</a>: illumination, Earth visibility, permanent shadow, slope and longest darkness (.bin files, described in grid.json).</li><li><a href="data/grid/cand.json" target="_blank">Candidate landing points</a> with a horizon for each point (cand_masks.gz).</li><li><a href="data/ice/psr_ice.json" target="_blank">Ice regions</a> (CC BY 4.0, Lemelin et al. 2021).</li><li><a href="data/rocks/south_pole_rock_mix.csv" download>Rock mix (CSV)</a>.</li><li>The full code is on <a href="https://github.com/aldiqs70/nasa" target="_blank">GitHub</a>.</li></ul>'],
      ] : [
        ['البيانات', '<ul><li><b>التضاريس:</b> خريطة ارتفاعات LOLA على مركبة LRO لكل اللي جنوب خط 80° (دقة 80 م). صغّرناها لثلاث طبقات متداخلة: 80 م قرب القطب، و160 م، و640 م للجبال البعيدة.</li><li><b>مواقع الشمس والأرض:</b> من ملفات NAIF SPICE التابعة لـ JPL (DE421)، ساعة بساعة من 2026 لـ 2030، بنفس إطار إحداثيات LOLA (MOON_ME). قارنّاها بـ SPICE والفرق أقل من 0.001°.</li><li><b>الجليد:</b> 169 منطقة ظل دائم فيها رصدات جليد من M3، مع الحرارة (Diviner) والهيدروجين (Lemelin وزملاؤه 2021).</li><li><b>الصخور:</b> الحديد والثوريوم من Lunar Prospector.</li></ul>'],
        ['الإضاءة وخط الأفق', 'لكل نقطة بنرمي 720 شعاع حواليها (كل نص درجة) لمسافة 300 كم، وبنحسب أعلى زاوية للجبال باتجاه كل شعاع، مع انحناء القمر. الشمس قرص قطره نص درجة تقريباً، فبنحسب <b>جزء القرص الظاهر</b> فوق الجبال، مش بس مركزه. هيك بتطلع الإضاءة الجزئية لما الشمس بتلمس قمة جبل.'],
        ['الاتصال مع الأرض', 'الاتصال المباشر ممكن لما يكون <b>مركز الأرض فوق خط الأفق الحقيقي</b> من الموقع، وبنحسب موقع الأرض من نفس النقطة على السطح (مش من مركز القمر). هاي هندسة بس: ما بنحسب قوة الإشارة ولا جدول محطات الاستقبال على الأرض.'],
        ['الطاقة واتجاه الألواح', 'الشمس بالقطب واطية جداً (أقل من 2° فوق الأفق)، فاللوح الأنسب يكون <b>عمودي</b>. الطاقة = 1361 W/m² × (1 AU / المسافة)² × الكفاءة × المساحة × جزء القرص الظاهر × جيب تمام ارتفاع الشمس. للوح الثابت بنضرب كمان بجيب تمام الفرق بين اتجاه الشمس واتجاه اللوح، وبنجرب 72 اتجاه عشان نلاقي الأفضل.'],
        ['البطارية والنوم', 'محاكاة ساعة بساعة: الطاقة الداخلة من الألواح ناقص الاستهلاك، والبطارية بتبدأ مليانة وما بتتعدى سعتها. المركبة إلها 3 حالات: <b>شغّالة</b>، و<b>نايمة</b> (إذا نزل الشحن تحت الحد بتطفي كل إشي إلا السخانات وبتستنى الشمس، وبتصحى لما الشحن يرجع للمستوى اللي اخترته)، و<b>انتهت</b> (إذا البطارية فضيت وهي نايمة، السخانات بتطفي والبرد بيتلف الإلكترونيات؛ والمركبة اللي مش مصممة تنام بتنتهي أول ما ينزل الشحن تحت الحد). هيك بتعرف إذا الموقع بيخلي المركبة تعيش، وكم من الوقت بتشتغل، وكم بطارية بتلزمها عشان ما تنام أبداً.'],
        ['اختيار أفضل 3 مواقع', 'حسبنا مسبقاً خط الأفق لـ <b>11,844</b> نقطة على شبكة كل 2 كم حوالين القطب (انحدارها ≤ 15° وإضاءتها على المدى الطويل ≥ 20%). بتشغيل المخطط، كل نقطة بتنجرب بكل يوم هبوط بالنافذة، والهبوط لازم يكون بالشمس إذا ممكن. الشرط الأساسي إنه المركبة تضل عايشة لآخر المهمة (والأفضل اللي ما بتنام أبداً، وبعدها الأكثر وقت شغل)، وبعدها العلامة بتجمع: الإضاءة، والاتصال، وهامش البطارية، والانحدار، والقرب من الجليد حسب الأولويات. وبنختار 3 مواقع بينهم 6 كم على الأقل.'],
        ['حدود الدقة (بصراحة)', '<ul><li>الشبكة كل 2 كم، فالقمم الصغيرة جداً ممكن تفوتنا. افتح أي موقع بالمستكشف لحساب دقيق على 80 م.</li><li>الانحدار على مسافة 160 م، يعني ما بيشوف الصخور الصغيرة والحفر. هاي بدها صور LROC NAC بدقة متر.</li><li>الإضاءة على ارتفاع 2 م فوق السطح. البرج الأعلى بيشوف شمس أكثر.</li><li>نموذج تعليمي وبحثي، مش بديل عن التحليل الهندسي الرسمي.</li></ul>'],
        ['تنزيل البيانات (للطلاب والباحثين)', '<ul><li><a href="data/grid/grid.json" target="_blank">خرائط القطب كل 1 كم</a>: الإضاءة، ورؤية الأرض، والظل الدائم، والانحدار، وأطول ظلمة (ملفات .bin، والشرح جوا grid.json).</li><li><a href="data/grid/cand.json" target="_blank">نقاط الهبوط المرشحة</a> مع خط الأفق لكل نقطة (cand_masks.gz).</li><li><a href="data/ice/psr_ice.json" target="_blank">مناطق الجليد</a> (CC BY 4.0، Lemelin وزملاؤه 2021).</li><li><a href="data/rocks/south_pole_rock_mix.csv" download>نسب الصخور (CSV)</a>.</li><li>الكود كامل على <a href="https://github.com/aldiqs70/nasa" target="_blank">GitHub</a>.</li></ul>'],
      ];
      $('methods').innerHTML = cards.map(([t, b]) => '<div class="card pad"><h2>' + t + '</h2><div style="color:var(--lavender)">' + b + '</div></div>').join('') +
        '<div class="card pad" style="grid-column:1/-1"><h2>' + T('المصادر', 'Sources') + '</h2><ul>' +
        [
          ['Lemelin et al. (2021), Planetary Science Journal 2:103: Framework for coordinated efforts in the exploration of volatiles in the south polar region of the Moon', 'https://doi.org/10.3847/PSJ/abf3c5'],
          ['Database of water ice-bearing PSRs (Zenodo, CC BY 4.0)', 'https://doi.org/10.5281/zenodo.4646092'],
          ['Li et al. (2018), PNAS: Direct evidence of surface exposed water ice in the lunar polar regions', 'https://doi.org/10.1073/pnas.1802345115'],
          ['Colaprete et al. (2010), Science: Detection of water in the LCROSS ejecta plume', 'https://doi.org/10.1126/science.1186986'],
          ['Mazarico et al. (2011), Icarus: Illumination conditions of the lunar polar regions using LOLA topography', 'https://doi.org/10.1016/j.icarus.2010.10.030'],
          ['Lawrence et al. (2002), JGR: Iron abundances on the lunar surface (Lunar Prospector)', 'https://doi.org/10.1029/2001JE001530'],
        ].concat(src.map((s) => [s.name, s.url])).map(([t, u]) => '<li><a href="' + u + '" target="_blank" rel="noopener">' + esc(t) + '</a></li>').join('') + '</ul>' +
        '<p class="note">' + T('صور الأرض والقمر بالواجهة: NASA Blue Marble وخريطة القمر من NASA (LRO). تمت بواسطة فريق <b>شباب شهاب</b> بالجمعية الفلكية الأردنية لتحدي NASA Space Apps 2026 (CLPS Lunar Mission Browser).', 'Earth and Moon images on the home page: NASA Blue Marble and the NASA LRO Moon map. Made by team <b>Shabab Shihab</b> (Jordanian Astronomical Society) for the NASA Space Apps 2026 challenge “CLPS Lunar Mission Browser”.') + '</p></div>';
    },
  };

  // ================================================================== boot
  $('menuBtn').onclick = () => $('nav').classList.toggle('open');
  window.addEventListener('hashchange', route);
  loadBase().then(() => { Plan.bindForm(); route(); }).catch((e) => {
    console.error(e);
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<div class="card pad" style="margin:20px">' + T('ما قدرت أحمّل البيانات الأساسية: ', 'Could not load the core data: ') + '<code>' + esc(e.message) + '</code>. ' + T('لازم الموقع ينفتح من خلال سيرفر (GitHub Pages أو localhost)، مش بفتح الملف مباشرة.', 'The site must be served over HTTP (GitHub Pages or localhost), not opened as a local file.') + '</div>');
  });
})();
