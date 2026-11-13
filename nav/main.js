/* Wiring: one shared state (site, time, landing day, mission, lander, language) drives every view. */
(async function () {
  const NAV = window.NAV, T = NAV.T, $ = (id) => document.getElementById(id), HOUR = 3600e3;
  const st = { sel: 0, f: 0, land: 4, plan: 4, mission: 14, view: '3d', wide: false, mapLayer: 'sun', fileLayer: 'zone', playing: false, g3: 'idle', mis: null };

  let D;
  try { D = await NAV.load(); } catch (e) { $('siteCoord').textContent = T('load_fail'); console.error(e); return; }

  const sky = new NAV.Sky($('skyCv'), () => need('sky'));
  const strips = new NAV.Strips($('stripsCv'), {
    onTime: (f) => { st.f = f; need('time'); },
    onLanding: (d) => { setLanding(d); },
    onSelect: (i) => { if (i !== st.sel) select(i); },
  });
  const map = new NAV.Map($('mapCv'), $('mapPins'), (i) => select(i), (lat, lon) => pickPoint(lat, lon));
  const file = new NAV.SiteFile($('fileCv'));
  const globe = new NAV.Globe($('globe'), {
    onPick: (lat, lon, name) => pickPoint(lat, lon, name), onSite: (i) => select(i, true), onHover: showHover, onBusy: () => {},
  });
  let figures = {};
  NAV.getJSON('data/sites/figures.json').then((j) => { figures = j; renderGeo(); }).catch(() => {});

  const site = () => D.sites[st.sel];
  const outs = () => D.sites.map((s) => NAV.outcomes(s, st.mission));
  const tMs = () => D.t0 + st.f * HOUR;

  // start: now, on the first site, with a plan that works
  st.f = Math.max(0, Math.min(D.windowH - 1, (Date.now() - D.t0) / HOUR));
  const g0 = NAV.outcomes(site(), st.mission).findIndex((o, d) => d >= 1 && NAV.isGood(o));
  st.plan = st.land = g0 >= 0 ? g0 : 4;
  sky.center = site().earthAz;

  // ---------------------------------------------------------------- formatting
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ltr = (s) => '<bdi dir="ltr">' + s + '</bdi>';
  const fLat = (v, d) => Math.abs(v).toFixed(d == null ? 4 : d) + '°' + (v < 0 ? 'S' : 'N');
  const fLon = (v, d) => Math.abs(v).toFixed(d == null ? 4 : d) + '°' + (v < 0 ? 'W' : 'E');
  const fH = (h) => (h >= 0 ? '+' : '−') + NAV.num(Math.abs(h)) + ' m';
  const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 1 : d) + '°';
  const dur = (h) => { const d = Math.floor(h / 24), r = Math.round(h - d * 24); return (d ? d + '<small>' + T('d') + '</small>' : '') + (d ? String(r).padStart(2, '0') : r) + '<small>' + T('h') + '</small>'; };
  const durTxt = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' ' + T('d') : Math.round(h) + ' ' + T('h'));
  const hrs = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' <small>' + T('d') + '</small>' : Math.round(h) + ' <small>' + T('h') + '</small>');
  const dir8 = (az) => T('dir8').split('|')[Math.round(az / 45) % 8];
  const wh = (v) => (v >= 10000 ? (v / 1000).toFixed(1) + ' kWh' : NAV.num(Math.round(v)) + ' Wh');
  const tag = (cls, text) => '<span class="tag tag-' + cls + '">' + text + '</span>';
  const landerName = () => (NAV.lander.preset ? T(NAV.lander.preset).toLowerCase() : T('custom'));

  // ---------------------------------------------------------------- redraw scheduling
  const dirty = new Set(); let raf = 0, lastGlobe = 0;
  function need() { for (const a of arguments) dirty.add(a); if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    const all = dirty.has('all'), plan = all || dirty.has('plan'), time = plan || dirty.has('time');
    dirty.clear();
    const s = site(), a = NAV.at(s, st.f);
    if (all) renderStatic();
    if (plan) { st.mis = NAV.mission(s, st.land, st.mission); renderRows(); renderVerdict(); renderLanding(); renderMission(); }
    if (all) renderFile();
    sky.draw(s, st.f);
    if (time) {
      strips.draw({ sel: st.sel, f: st.f, land: st.land, plan: st.plan, mission: st.mission, outs: outs() });
      if (st.view === '2d') map.draw(st.mapLayer, s, a);
      renderReadouts(s, a); renderNow(s, a);
      NAV.Details.battery($('batCv'), s, st.mis, st.f);
      const now = performance.now();
      if (plan || now - lastGlobe > 160) { lastGlobe = now; globe.setTime(tMs()); }
    }
  }

  // ---------------------------------------------------------------- actions
  function select(i, keepCam) {
    st.sel = i; sky.center = site().earthAz; need('all');
    if (globe.viewer) { globe.setSites(D.sites, i); if (!keepCam) globe.cam('site'); }
  }
  function setLanding(d) { d = Math.max(0, Math.min(D.windowDays - 1, d)); if (d === st.land) return; st.land = d; need('plan'); }
  function setLang(l) {
    NAV.lang = l; document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    const b = $('langBtn'); b.textContent = l === 'ar' ? 'English' : 'العربية'; b.lang = l === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('eol-lang', l); } catch (e) { /* storage may be blocked */ }
    if (globe.viewer) globe.setSites(D.sites, st.sel);
    need('all');
  }
  // Any point on the Moon becomes a site of its own, shown beside the curated ones.
  let picking = 0;
  async function pickPoint(lat, lon, name) {
    const near = NAV.nearName(lat, lon);
    if (near && near.km < 0.25) return select(D.sites.indexOf(near.s));
    const id = ++picking; stageMsg(T('working'));
    let s; try { s = await NAV.pick(lat, lon, name); } catch (e) { console.error(e); stageMsg(''); return; }
    if (id !== picking) return;
    stageMsg(''); s.near = near ? near.s : null;
    const k = D.sites.findIndex((x) => x.custom);
    if (k >= 0) D.sites[k] = s; else D.sites.push(s);
    strips.resize(D.sites.length);
    $('llLat').value = s.lat.toFixed(4); $('llLon').value = s.lon.toFixed(4);
    select(D.sites.indexOf(s), true);
    if (globe.viewer && (st.view !== '3d' || name)) globe.cam('site');
  }

  // ---------------------------------------------------------------- 3D and 2D
  function stageMsg(t) { const m = $('stageMsg'); m.textContent = t || ''; m.hidden = !t; }
  function caption() {
    $('mapCap').textContent = st.view === '2d' ? (st.g3 === 'failed' ? T('g_fail') + ' ' : '') + T('cap_' + st.mapLayer) : st.g3 === 'lite' ? T('g_lite') : st.g3 === 'failed' ? T('g_fail') : T('cap_3d') + ' ' + T('click_hint');
  }
  function start3d() {
    if (st.g3 === 'loading' || st.g3 === 'tiles' || st.g3 === 'lite') return;
    st.g3 = 'loading'; stageMsg(T('g_loading')); globe.starting = null;
    globe.start().then((mode) => {
      st.g3 = mode; stageMsg('');
      for (const k of ['Shadows', 'Fine']) $('opt' + k).disabled = mode !== 'tiles';
      for (const k of ['sun', 'shadows', 'fine', 'ice']) globe.setOpt(k, $('opt' + k[0].toUpperCase() + k.slice(1)).checked);
      globe.setSites(D.sites, st.sel); globe.setTime(tMs());
      NAV.extras().then((X) => { if (X.ice) globe.setIce(X.ice.psr); });
      caption();
    }).catch((e) => { console.warn(e); st.g3 = 'failed'; stageMsg(''); setView('2d'); });
  }
  function setView(v) {
    st.view = v;
    $('viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    $('globe').hidden = v !== '3d'; $('map').hidden = v !== '2d'; $('opts3d').hidden = v !== '3d'; $('opts2d').hidden = v !== '2d'; $('camBtns').hidden = v !== '3d';
    $('hoverRead').hidden = true;
    if (v === '3d') { start3d(); globe.resize(); } else { stageMsg(''); map.resize(); map.pins(D.sites, st.sel); need('time'); }
    caption();
  }
  function showHover(p) {
    const el = $('hoverRead');
    if (!p) { el.hidden = true; return; }
    const T3 = NAV.T3, h = T3 ? T3.height(p.lat, p.lon) : NaN, sl = T3 && !Number.isNaN(h) ? T3.slope(p.lat, p.lon, 1) : null;
    el.innerHTML = T('hv', { lat: ltr(fLat(p.lat, 3)), lon: ltr(fLon(p.lon, 3)), h: Number.isNaN(h) ? '—' : ltr(fH(Math.round(h))), s: sl ? ltr(sl.deg.toFixed(1) + '°') : '—' });
    el.hidden = false;
  }

  // ---------------------------------------------------------------- text and lists
  function renderStatic() {
    NAV.applyText();
    document.title = T('brand');
    const sel = $('siteSel'); sel.textContent = '';
    D.sites.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = NAV.siteName(s); sel.appendChild(o); });
    sel.value = String(st.sel);
    const s = site();
    $('siteCoord').innerHTML = ltr(fLat(s.lat) + ', ' + fLon(s.lon)) + (s.flat ? '' : ' &nbsp; ' + ltr(fH(s.h)));
    $('skyNote').textContent = T('sky_note', { n: sky.stretch().toFixed(1) });
    $('playTxt').textContent = T(st.playing ? 'pause' : 'play');
    $('missionSeg').querySelectorAll('button').forEach((b) => { b.textContent = T('days_n', { n: b.dataset.v }); });
    $('expandBtn').lastElementChild.textContent = T(st.wide ? 'narrower' : 'wider');
    $('landerMore').textContent = T($('landerForm').hidden ? 'lander_more' : 'lander_less');
    $('skyCv').setAttribute('aria-label', T('sky_title'));
    if (st.view === '2d') map.pins(D.sites, st.sel);
    caption();
  }

  function outcomeText(o) {
    if (o.cls === 'lost') return T('o_lost', { d: o.lostDay });
    if (o.cls === 'sleep') return T('o_sleep', { h: o.sleepH });
    return o.dark ? T('o_ok_dark') : T('o_ok', { n: st.mission });
  }
  function renderRows() {
    const box = $('stripNames'), O = outs(); box.textContent = '';
    D.sites.forEach((s, i) => {
      const o = O[i][st.land], b = document.createElement('button');
      b.type = 'button'; b.className = 'row-btn' + (i === st.sel ? ' on' : ''); b.setAttribute('aria-pressed', i === st.sel ? 'true' : 'false');
      b.innerHTML = '<span class="row-name"></span><span class="row-out ' + o.cls + '"><i class="glyph glyph-' + o.cls + '"></i><span></span></span>';
      b.querySelector('.row-name').textContent = NAV.siteName(s); b.querySelector('.row-out span').textContent = outcomeText(o);
      b.addEventListener('click', () => select(i));
      box.appendChild(b);
    });
  }
  function renderLanding() {
    $('landOut').textContent = NAV.fmtDay(D.t0 + st.land * 864e5);
    const n = st.land - st.plan;
    $('slipTxt').textContent = n > 0 ? T('slip_late', { n }) : n < 0 ? T('slip_early', { n: -n }) : '';
    $('slipReset').hidden = n === 0;
  }

  function renderVerdict() {
    const O = outs(), s = site(), o = O[st.sel][st.land], date = NAV.fmtDayLong(D.t0 + st.land * 864e5), name = esc(NAV.siteName(s)), box = $('verdict');
    const v = { date, site: name, n: st.mission, h: o.sleepH, d: o.lostDay };
    let html = '<p class="verdict-main">' + T(o.cls === 'lost' ? 'v_lost' : o.cls === 'sleep' ? 'v_sleep' : o.dark ? 'v_ok_dark' : 'v_ok', v) + '</p>';
    const fixes = [];
    if (NAV.isGood(o)) {
      const k = NAV.slack(O[st.sel], st.land), soc = Math.round(o.minSoc * 100);
      html += '<p class="verdict-sub">' + (k === Infinity ? T('v_margin_all', { soc }) : k === 0 ? T('v_margin0', { soc }) : T('v_margin', { n: k, soc })) + '</p>';
    } else {
      const day = NAV.nearestGoodDay(O[st.sel], st.land);
      if (day >= 0) fixes.push({ t: T('fix_date', { date: NAV.fmtDay(D.t0 + day * 864e5) }), s: day > st.land ? T('fix_date_s', { n: day - st.land }) : T('fix_date_e', { n: st.land - day }), run: () => setLanding(day) });
      const alt = D.sites.map((x, i) => ({ i, km: NAV.distKm(s, x) })).filter((x) => x.i !== st.sel && NAV.isGood(O[x.i][st.land])).sort((p, q) => p.km - q.km)[0];
      if (alt) fixes.push({ t: T('fix_site', { date: NAV.fmtDay(D.t0 + st.land * 864e5), site: NAV.siteName(D.sites[alt.i]) }), s: T('fix_site_s', { km: NAV.num(Math.round(alt.km)), n: st.mission }), run: () => select(alt.i) });
      html += '<p class="verdict-sub">' + (fixes.length === 2 ? T('v_fix') : fixes.length === 1 ? T('v_fix1') : T('v_nofix')) + '</p>';
    }
    box.innerHTML = html;
    if (fixes.length) {
      const wrap = document.createElement('div'); wrap.className = 'fixes';
      for (const fx of fixes) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'fix';
        const t = document.createElement('b'), sub = document.createElement('span'); t.textContent = fx.t; sub.textContent = fx.s; b.append(t, sub);
        b.addEventListener('click', fx.run); wrap.appendChild(b);
      }
      box.appendChild(wrap);
    }
  }

  function renderReadouts(s, a) {
    const ser = s.ser, left = Math.floor((ser.n - 1 - a.i) / 24), end = NAV.fmtDay(D.t0 + (ser.n - 1) * HOUR);
    const up = a.lit > 0.01, hs = NAV.untilFlip(ser.lit, a.i, (v) => v > 0.01);
    $('roSunK').textContent = T(up ? 'sunset_in' : 'sunrise_in');
    $('roSunV').innerHTML = hs === null ? '&gt;' + left + '<small>' + T('d') + '</small>' : dur(hs);
    $('roSunS').textContent = (up ? T('sun_up', { p: Math.round(a.lit * 100) }) : T('sun_down')) + (hs === null ? '. ' + T('no_change', { date: end }) : '');
    const he = NAV.untilFlip(ser.comm, a.i, (v) => v === 1);
    $('roEarthK').textContent = T(a.comm ? 'earthset_in' : 'earthrise_in');
    $('roEarthV').innerHTML = he === null ? '&gt;' + left + '<small>' + T('d') + '</small>' : dur(he);
    $('roEarthS').textContent = (a.comm ? T('earth_up', { a: (a.earthAlt - a.hEarth).toFixed(1) }) : T('earth_down')) + (he === null ? '. ' + T('no_change', { date: end }) : '');
    const L = NAV.lander, w = NAV.gen(s)[a.i];
    $('roPowV').innerHTML = NAV.num(Math.round(w / 10) * 10) + '<small>W</small>';
    $('roPowS').textContent = L.panel.mode === 'fixed' ? T('pow_sub_fixed', { name: landerName(), a: L.panel.area, az: L.panel.azimuth }) : T('pow_sub', { name: landerName(), a: L.panel.area });
    $('clock').textContent = NAV.fmtClock(tMs());
  }

  // ---------------------------------------------------------------- site file
  function renderFacts() {
    const s = site(), ice = NAV.iceNear(s, 1)[0];
    const slopeTag = s.slope == null ? '' : ' ' + (s.slope > 15 ? tag('bad', T('steep')) : s.slope > 8 ? tag('warn', T('moderate')) : tag('ok', T('gentle')));
    const rows = [
      ['fact_lat', ltr(fLat(s.lat))], ['fact_lon', ltr(fLon(s.lon))],
      ['fact_h', s.flat ? '—' : ltr(fH(s.h))], ['fact_slope', s.slope == null ? '—' : s.slope.toFixed(1) + '°' + slopeTag],
      ['fact_pole', NAV.num(s.poleKm, s.poleKm < 100 ? 1 : 0) + ' <small>km</small>'],
      ['fact_ice', ice ? (ice.km < 0.05 ? T('inside') : NAV.num(ice.km, 1) + ' <small>km</small>') + ' <small>' + esc(NAV.iceName(ice.p)) + '</small>' : '—'],
      ['fact_lit', Math.round(s.litPct) + '%'], ['fact_comm', Math.round(s.commPct) + '%'],
    ];
    $('facts').innerHTML = rows.map((r) => '<div><dt>' + T(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('');
    $('fileTitle').textContent = T('file_title', { site: NAV.siteName(s) });
    $('fileSub').textContent = s.flat ? T('file_sub_flat') : '';
  }
  function renderNow(s, a) {
    $('nowTitle').textContent = T('now_title', { clock: NAV.fmtClock(tMs()) });
    const sunTag = a.lit >= 0.999 ? tag('ok', T('t_lit')) : a.lit > 0 ? tag('warn', T('t_part', { p: Math.round(a.lit * 100) })) : tag('bad', a.sunAlt > 0 ? T('t_blocked') : T('t_below'));
    const earthTag = a.comm ? tag('ok', T('t_view')) : tag('bad', a.earthAlt > 0 ? T('t_blocked') : T('t_below'));
    const k = a.earthLit, ph = k < 0.03 ? 'ph_new' : k < 0.35 ? 'ph_cres' : k < 0.65 ? 'ph_half' : k < 0.97 ? 'ph_gib' : 'ph_full';
    const flux = a.flux * a.lit * Math.max(0, Math.cos(a.sunAlt * Math.PI / 180)), az = (v) => ltr(Math.round(v) % 360 + '°');
    const rows = [
      ['k_sun', T('altaz', { alt: ltr(sgn(a.sunAlt, 2)), az: az(a.sunAz) }) + ' ' + sunTag],
      ['k_panel', az(a.sunAz) + ' <small>' + dir8(a.sunAz) + '</small>'],
      ['k_earth', T('altaz', { alt: ltr(sgn(a.earthAlt, 2)), az: az(a.earthAz) }) + ' ' + earthTag],
      ['k_antenna', az(a.earthAz) + ' <small>' + dir8(a.earthAz) + '</small>'],
      ['k_phase', T(ph) + ' <small>' + T('pct_lit', { p: Math.round(k * 100) }) + '</small>'],
      ['k_flux', NAV.num(Math.round(flux)) + ' <small>W/m²</small>'],
      ['k_out', NAV.num(Math.round(NAV.gen(s)[a.i])) + ' <small>W</small>'],
    ];
    $('nowList').innerHTML = rows.map((r) => '<div><dt>' + T(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('');
    NAV.Details.compass($('compassCv'), a, st.mis && st.mis.rose.trackWh > 0 ? st.mis.rose.bestAz : null);
  }
  function renderMission() {
    const s = site(), m = st.mis, b = m.b, L = NAV.lander, date = NAV.fmtDayLong(D.t0 + st.land * 864e5), r = m.rose;
    $('roseTitle').textContent = T('rose_title', { n: st.mission, date });
    $('batTitle').textContent = T('bat_title', { n: st.mission, date });
    const pct = (v) => Math.round(100 * v) + '%';
    if (r.trackWh > 0) {
      $('roseList').innerHTML = [
        ['r_track', NAV.num(r.trackWh / 1000, 1) + ' <small>kWh/m²</small>'],
        ['r_fixed', ltr(r.bestAz + '°') + ' <small>' + dir8(r.bestAz) + ', ' + T('r_of', { p: Math.round(100 * r.bestWh / r.trackWh) }) + '</small>'],
        ['r_two', '<small>' + T('r_of', { p: Math.round(100 * r.twoFacedWh / r.trackWh) }) + '</small>'],
      ].map((x) => '<div><dt>' + T(x[0]) + '</dt><dd>' + x[1] + '</dd></div>').join('');
      $('roseAdvice').textContent = T('r_advice', { dir: dir8(r.bestAz), az: r.bestAz });
    } else { $('roseList').innerHTML = ''; $('roseAdvice').textContent = T('r_none'); }
    NAV.Details.rose($('roseCv'), r, NAV.at(s, st.f).sunAz);
    $('misFacts').innerHTML = [
      ['m_lit', Math.round(m.litPct) + '%'], ['m_comm', Math.round(m.commPct) + '%'], ['m_both', Math.round(m.bothPct) + '%'], ['m_dark', hrs(m.darkH)], ['m_gap', hrs(m.gapH)],
      ['m_in', NAV.num(b.energyInWh / 1000, 1) + ' <small>kWh</small>'], ['m_out', NAV.num(b.energyOutWh / 1000, 1) + ' <small>kWh</small>'], ['m_soc', pct(b.minSoc)],
    ].map((x) => '<div><dt>' + T(x[0]) + '</dt><dd>' + x[1] + '</dd></div>').join('');
    let txt = b.ok ? T('b_ok') : b.alive ? T('b_sleep', { k: b.sleeps, h: Math.round(b.longestSleepH), u: Math.round(b.uptimePct) }) : T('b_lost', { t: durTxt(b.deadHour) });
    if (!b.ok) {
      const f = m.fix, parts = [];
      if (f.capWh) parts.push(T('b_fix_cap', { v: wh(f.capWh) }));
      parts.push(f.area ? T('b_fix_area', { v: f.area }) : T('b_fix_noarea'));
      txt += ' ' + T('b_fix') + ' ' + parts.join(' ') + '.';
      if (f.sleepW != null) txt += ' ' + T('b_fix_sleep', { v: f.sleepW }) + '.';
    }
    $('batText').textContent = txt;
  }
  function renderGeo() {
    const s = site(), ar = NAV.lang === 'ar', g = s.custom ? null : (window.SiteData ? SiteData.SITES : []).find((x) => x.id === s.id), box = $('geoNotes'); box.textContent = '';
    if (g) {
      for (const [k, key] of [['geo_terrain', 'terrain'], ['geo_rock', 'rock'], ['geo_landing', 'landing']]) {
        const p = document.createElement('p'), b = document.createElement('b'); b.textContent = T(k) + ': '; p.append(b, ar ? g[key] : g[key + '_en']); box.appendChild(p);
      }
      const c = document.createElement('p'); c.className = 'conf'; c.textContent = ar ? g.confidence : g.confidence_en; box.appendChild(c);
    } else { const p = document.createElement('p'); p.className = 'conf'; p.textContent = T('geo_none'); box.appendChild(p); }
    // rock mix from orbital chemistry
    const X = NAV.X, rm = $('rockMix'), r = X && X.rocks && s.lat < -79 ? X.rocks.at(s.lat, s.lon) : null;
    if (r) {
      const MIX = [['anorthosite', 'rock_an', '#EEEBE4'], ['mafic', 'rock_maf', '#77736B'], ['kreep', 'rock_kreep', '#C7903C']];
      rm.innerHTML = '<h4>' + T('rock_title') + '</h4><div class="mixbar">' + MIX.map((m) => '<i style="width:' + r[m[0]].toFixed(1) + '%;background:' + m[2] + '"></i>').join('') + '</div>' +
        '<ul class="legend">' + MIX.map((m) => '<li><i class="sw" style="background:' + m[2] + '"></i><span>' + T(m[1]) + ' <b>' + Math.round(r[m[0]]) + '%</b></span></li>').join('') + '</ul>' +
        '<p class="conf">' + T('rock_note', { fe: r.FeO.toFixed(1), th: r.Th.toFixed(2) }) + '</p>';
    } else rm.innerHTML = X ? '<p class="conf">' + T('rock_none') + '</p>' : '';
    // the geology team's figure
    const fig = $('geoFig'), f = s.custom ? null : figures[s.id]; fig.textContent = '';
    if (f && (f.en || f.ar)) {
      const own = f[NAV.lang], src = own || f.en || f.ar, im = document.createElement('img'), cap = document.createElement('figcaption');
      im.src = src; im.alt = T('geo_fig_cap', { credit: f.credit || '' }); im.loading = 'lazy';
      cap.textContent = T('geo_fig_cap', { credit: f.credit || '' }) + (own ? '' : ' ' + T('geo_fig_other'));
      fig.append(im, cap);
    } else if (!s.custom) { const d = document.createElement('div'); d.className = 'geo-empty'; d.textContent = T('geo_fig_empty'); fig.appendChild(d); }
    // ice
    const near = NAV.iceNear(s, 5), ib = $('iceBox');
    if (!near.length) { ib.innerHTML = '<p class="conf">' + (X ? T('ice_none') : '') + '</p>'; return; }
    const H = T('ice_h').split('|');
    ib.innerHTML = '<table class="tbl"><thead><tr>' + H.map((h) => '<th>' + h + '</th>').join('') + '<th></th></tr></thead><tbody>' + near.map((x, i) =>
      '<tr><td>' + esc(NAV.iceName(x.p)) + '</td><td>' + (x.km < 0.05 ? T('inside') : ltr(NAV.num(x.km, 1) + ' km')) + '</td><td>' + x.p.m3 + '</td><td>' + ltr(NAV.num(x.p.area_km2, 1) + ' km²') + '</td><td>' + (x.p.T_max ? ltr(Math.round(x.p.T_max) + ' K') : '—') + '</td>' +
      '<td><button type="button" class="btn-link" data-ice="' + i + '">' + T('show_it') + '</button></td></tr>').join('') + '</tbody></table><p class="conf">' + T('ice_note') + '</p>';
    ib.querySelectorAll('[data-ice]').forEach((b) => b.addEventListener('click', () => { const p = near[+b.dataset.ice].p; pickPoint(p.lat, p.lon, NAV.iceName(p)); }));
  }

  function renderFileLegend(d) {
    const box = $('fileLegend'), Z = NAV.SiteFile.ZONE, L = st.fileLayer; let html = '';
    if (!d || d.none) { box.innerHTML = ''; return; }
    if (L === 'zone') html = '<span class="lg"><i class="chip" style="background:#F3E9C9;outline:1.5px solid #FFD166"></i>' + T('lg_zone', { s: Z.slope, l: Z.lit, e: Z.earth }) + '</span><span class="note">' + (d.areaKm2 >= 0.05 ? T('lg_zone_area', { a: d.areaKm2.toFixed(1) }) : T('lg_zone_none')) + '</span>';
    else if (L === 'slope') { let lo = 0; html = NAV.SiteFile.SLOPE_CLASSES.map((c) => { const t = c[0] === 90 ? '> ' + lo + '°' : lo + '–' + c[0] + '°'; lo = c[0]; return '<span class="lg"><i class="chip" style="background:' + c[1] + '"></i>' + ltr(t) + '</span>'; }).join('') + '<span class="note">' + T('lg_slope_unit') + '</span>'; }
    else html = '<span class="lg">0%<i class="ramp" style="background:' + NAV.SiteFile.rampCss(L) + '"></i>100%</span><span class="note">' + T(L === 'sun' ? 'lg_sun_ramp' : 'lg_earth_ramp') + '</span>';
    if (d.coarse && L !== 'slope') html += '<span class="note">' + T('lg_grid_note') + '</span>';
    box.innerHTML = html;
  }
  async function renderMap24() {
    const s = site(), show = () => { const d = file.get(s); file.draw(s, st.fileLayer); renderFileLegend(d); const m = $('fileMsg'); m.textContent = d && d.none ? T('amap_none') : ''; m.hidden = !(d && d.none); };
    show();
    if (!file.get(s)) { try { await file.load(s); } catch (e) { console.error(e); return; } if (site() === s) show(); }
  }
  function renderFile() { renderFacts(); renderGeo(); renderMap24(); }

  // ---------------------------------------------------------------- controls
  $('siteSel').addEventListener('change', (e) => select(+e.target.value));
  $('langBtn').addEventListener('click', () => setLang(NAV.lang === 'ar' ? 'en' : 'ar'));
  $('landPrev').addEventListener('click', () => setLanding(st.land - 1));
  $('landNext').addEventListener('click', () => setLanding(st.land + 1));
  $('slipReset').addEventListener('click', () => setLanding(st.plan));
  $('toNow').addEventListener('click', () => { st.f = Math.max(0, Math.min(D.windowH - 1, (Date.now() - D.t0) / HOUR)); need('time'); });
  $('toLanding').addEventListener('click', () => { st.f = st.land * 24; need('time'); });
  const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  seg('missionSeg', (v) => { st.mission = +v; need('plan'); });
  seg('landerSeg', (v) => { NAV.setPreset(v); fillLander(); need('plan'); });
  seg('mapSeg', (v) => { st.mapLayer = v; caption(); need('time'); });
  seg('fileSeg', (v) => { st.fileLayer = v; renderMap24(); });
  seg('viewSeg', (v) => setView(v));
  $('camBtns').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) globe.cam(b.dataset.cam); });
  for (const k of ['Sun', 'Shadows', 'Fine', 'Ice']) $('opt' + k).addEventListener('change', (e) => {
    if (k === 'Shadows' && e.target.checked && !$('optSun').checked) { $('optSun').checked = true; globe.setOpt('sun', true); }
    if (k === 'Sun' && !e.target.checked && $('optShadows').checked) { $('optShadows').checked = false; globe.setOpt('shadows', false); }
    globe.setOpt(k.toLowerCase(), e.target.checked);
  });
  $('expandBtn').addEventListener('click', () => { st.wide = !st.wide; $('expandBtn').setAttribute('aria-pressed', st.wide ? 'true' : 'false'); document.querySelector('.desk').classList.toggle('wide', st.wide); layout(); if (globe.viewer) globe.cam(globe.lastCam || 'pole', 0.8); });
  $('llForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseFloat($('llLat').value.replace(',', '.').replace('−', '-')), lon = parseFloat($('llLon').value.replace(',', '.').replace('−', '-'));
    const ok = lat >= -90 && lat <= 90 && lon >= -180 && lon <= 360;
    $('llErr').textContent = ok ? '' : T('ll_err');
    if (ok) pickPoint(lat, lon, null).then(() => { if (globe.viewer) globe.cam('site'); });
  });

  // lander settings
  const LF = { lfCap: ['capWh', 1], lfLoad: ['loadW', 1], lfMin: ['minSoc', 0.01], lfSleep: ['sleepW', 1] }, LP = { lfArea: ['area', 1], lfEff: ['efficiency', 0.01], lfAz: ['azimuth', 1] };
  function fillLander() {
    const L = NAV.lander;
    for (const id in LF) $(id).value = +(L[LF[id][0]] / LF[id][1]).toFixed(2);
    for (const id in LP) $(id).value = +(L.panel[LP[id][0]] / LP[id][1]).toFixed(2);
    $('lfMode').value = L.panel.mode; $('lfHib').checked = L.hibernate; $('lfAz').disabled = L.panel.mode !== 'fixed'; $('lfSleep').disabled = !L.hibernate;
    $('landerSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === L.preset));
  }
  $('landerForm').addEventListener('input', () => {
    const L = NAV.lander, num = (id, lo, hi) => Math.min(hi, Math.max(lo, parseFloat($(id).value) || lo));
    L.capWh = num('lfCap', 50, 1e6); L.loadW = num('lfLoad', 1, 1e5); L.minSoc = num('lfMin', 0, 80) / 100; L.sleepW = num('lfSleep', 0, 1e4);
    L.panel.area = num('lfArea', 0.05, 500); L.panel.efficiency = num('lfEff', 5, 45) / 100; L.panel.azimuth = num('lfAz', 0, 359);
    L.panel.mode = $('lfMode').value; L.hibernate = $('lfHib').checked; L.preset = null;
    $('lfAz').disabled = L.panel.mode !== 'fixed'; $('lfSleep').disabled = !L.hibernate;
    $('landerSeg').querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    need('plan');
  });
  $('landerForm').addEventListener('submit', (e) => e.preventDefault());
  $('landerMore').addEventListener('click', () => { const f = $('landerForm'); f.hidden = !f.hidden; $('landerMore').setAttribute('aria-expanded', f.hidden ? 'false' : 'true'); $('landerMore').textContent = T(f.hidden ? 'lander_more' : 'lander_less'); });

  let last = 0;
  function tick(now) {
    if (!st.playing) return;
    st.f += Math.min(0.1, (now - last) / 1000) * 24; last = now;          // one day per second
    if (st.f >= D.windowH - 1) { st.f = D.windowH - 1; togglePlay(false); }
    need('time'); requestAnimationFrame(tick);
  }
  function togglePlay(on) {
    st.playing = on; $('playBtn').setAttribute('aria-pressed', on ? 'true' : 'false'); $('playTxt').textContent = T(on ? 'pause' : 'play');
    $('playIcon').setAttribute('d', on ? 'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z' : 'M4 2.5v11l9-5.5z');
    if (on) { if (st.f >= D.windowH - 2) st.f = 0; last = performance.now(); requestAnimationFrame(tick); }
  }
  $('playBtn').addEventListener('click', () => togglePlay(!st.playing));

  function layout() {
    sky.resize(); strips.resize(D.sites.length); file.resize(); globe.resize();
    if (st.view === '2d') { map.resize(); map.pins(D.sites, st.sel); }
    need('all');
  }
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 80); });

  let lang = 'en';
  try { lang = localStorage.getItem('eol-lang') || lang; } catch (e) { /* storage may be blocked */ }
  const asked = new URLSearchParams(location.search).get('lang'); if (asked === 'ar' || asked === 'en') lang = asked;
  NAV.lang = lang === 'ar' ? 'ar' : 'en';
  fillLander();
  setLang(NAV.lang);
  layout();
  setView('3d');
  map.load().then(() => need('time')).catch((e) => console.error(e));
  NAV.extras().then(() => need('all'));
  NAV.terrain();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
})();
