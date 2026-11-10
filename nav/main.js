/* Wiring: one shared state (site, time, landing day, mission, lander, language) drives every view. */
(async function () {
  const NAV = window.NAV, T = NAV.T, $ = (id) => document.getElementById(id);
  const st = { sel: 0, f: 0, land: 4, plan: 4, mission: 14, lander: 'medium', mapLayer: 'sun', fileLayer: 'zone', playing: false };

  let D;
  try { D = await NAV.load(); } catch (e) { $('siteCoord').textContent = T('load_fail'); console.error(e); return; }

  const sky = new NAV.Sky($('skyCv'), () => need('sky'));
  const strips = new NAV.Strips($('stripsCv'), {
    onTime: (f) => { st.f = f; need('time'); },
    onLanding: (d) => { setLanding(d); },
    onSelect: (i) => { if (i !== st.sel) select(i); },
  });
  const map = new NAV.Map($('mapCv'), $('mapPins'), (i) => select(i));
  const file = new NAV.SiteFile($('fileCv'));
  let figures = {};
  NAV.getJSON('data/sites/figures.json').then((j) => { figures = j; renderGeo(); }).catch(() => {});

  const site = () => D.sites[st.sel];
  const outs = () => D.sites.map((s) => NAV.outcomes(s, st.lander, st.mission));

  // start: now, on the first site, with a plan that works
  st.f = Math.max(0, Math.min(D.windowH - 1, (Date.now() - D.t0) / 3600e3));
  const first = NAV.outcomes(site(), st.lander, st.mission);
  const g0 = first.findIndex((o, d) => d >= 1 && NAV.isGood(o));
  st.plan = st.land = g0 >= 0 ? g0 : 4;
  sky.center = site().earthAz;

  // ---------------------------------------------------------------- redraw scheduling
  const dirty = new Set(); let raf = 0;
  function need() { for (const a of arguments) dirty.add(a); if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    const all = dirty.has('all'), time = all || dirty.has('time'), plan = all || dirty.has('plan');
    dirty.clear();
    const s = site(), a = NAV.at(s, st.f);
    if (all) { renderStatic(); renderFile(); }
    if (plan) { renderRows(); renderVerdict(); renderLanding(); }
    sky.draw(s, st.f);
    if (time || plan) { strips.draw({ sel: st.sel, f: st.f, land: st.land, plan: st.plan, mission: st.mission, outs: outs() }); map.draw(st.mapLayer, s, a); renderReadouts(s, a); }
  }

  // ---------------------------------------------------------------- actions
  function select(i) { st.sel = i; sky.center = site().earthAz; $('siteSel').value = String(i); need('all'); }
  function setLanding(d) { d = Math.max(0, Math.min(D.windowDays - 1, d)); if (d === st.land) return; st.land = d; need('plan'); }
  function setLang(l) {
    NAV.lang = l; document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    const b = $('langBtn'); b.textContent = l === 'ar' ? 'English' : 'العربية'; b.lang = l === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('eol-lang', l); } catch (e) { /* storage may be blocked */ }
    need('all');
  }

  // ---------------------------------------------------------------- text and lists
  const dur = (h) => { const d = Math.floor(h / 24), r = Math.round(h - d * 24); return (d ? d + '<small>' + T('d') + '</small>' : '') + (d ? String(r).padStart(2, '0') : r) + '<small>' + T('h') + '</small>'; };
  const ll = (s) => Math.abs(s.lat).toFixed(4) + '°S, ' + Math.abs(s.lon).toFixed(4) + '°' + (s.lon >= 0 ? 'E' : 'W');

  function renderStatic() {
    NAV.applyText();
    document.title = T('brand');
    const sel = $('siteSel'); sel.textContent = '';
    D.sites.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = NAV.siteName(s); sel.appendChild(o); });
    sel.value = String(st.sel);
    const s = site();
    $('siteCoord').innerHTML = '<bdi dir="ltr">' + ll(s) + '</bdi> &nbsp; <bdi dir="ltr">' + (s.h >= 0 ? '+' : '−') + NAV.num(Math.abs(s.h)) + ' m</bdi>';
    $('skyNote').textContent = T('sky_note', { n: sky.stretch().toFixed(1) });
    $('mapCap').textContent = T('cap_' + st.mapLayer);
    $('playTxt').textContent = T(st.playing ? 'pause' : 'play');
    $('missionSeg').querySelectorAll('button').forEach((b) => { b.textContent = T('days_n', { n: b.dataset.v }); });
    $('skyCv').setAttribute('aria-label', T('sky_title'));
    map.pins(D.sites, st.sel);
    renderGeo(); renderFacts();
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
    const O = outs(), s = site(), o = O[st.sel][st.land], date = NAV.fmtDayLong(D.t0 + st.land * 864e5), name = NAV.siteName(s), box = $('verdict');
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
      if (alt) fixes.push({ t: T('fix_site', { date: NAV.fmtDay(D.t0 + st.land * 864e5), site: NAV.siteName(D.sites[alt.i]) }), s: T('fix_site_s', { km: Math.round(alt.km), n: st.mission }), run: () => select(alt.i) });
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
    const ser = s.ser, left = Math.floor((ser.n - 1 - a.i) / 24), end = NAV.fmtDay(D.t0 + (ser.n - 1) * 3600e3);
    const up = a.lit > 0.01, hs = NAV.untilFlip(ser.lit, a.i, (v) => v > 0.01);
    $('roSunK').textContent = T(up ? 'sunset_in' : 'sunrise_in');
    $('roSunV').innerHTML = hs === null ? '&gt;' + left + '<small>' + T('d') + '</small>' : dur(hs);
    $('roSunS').textContent = (up ? T('sun_up', { p: Math.round(a.lit * 100) }) : T('sun_down')) + (hs === null ? '. ' + T('no_change', { date: end }) : '');
    const he = NAV.untilFlip(ser.comm, a.i, (v) => v === 1);
    $('roEarthK').textContent = T(a.comm ? 'earthset_in' : 'earthrise_in');
    $('roEarthV').innerHTML = he === null ? '&gt;' + left + '<small>' + T('d') + '</small>' : dur(he);
    $('roEarthS').textContent = (a.comm ? T('earth_up', { a: (a.earthAlt - a.hEarth).toFixed(1) }) : T('earth_down')) + (he === null ? '. ' + T('no_change', { date: end }) : '');
    const L = NAV.LANDERS[st.lander], w = a.flux * 0.30 * L.area * a.lit * Math.cos(a.sunAlt * Math.PI / 180);
    $('roPowV').innerHTML = NAV.num(Math.round(w / 10) * 10) + '<small>W</small>';
    $('roPowS').textContent = T('pow_sub', { name: T(st.lander).toLowerCase(), a: L.area });
    $('clock').textContent = NAV.fmtClock(D.t0 + st.f * 3600e3);
  }

  function renderFacts() {
    const s = site(), hrs = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' <small>' + T('d') + '</small>' : Math.round(h) + ' <small>' + T('h') + '</small>');
    const rows = [
      ['fact_lat', '<bdi dir="ltr">' + Math.abs(s.lat).toFixed(4) + '°S</bdi>'], ['fact_lon', '<bdi dir="ltr">' + Math.abs(s.lon).toFixed(4) + '°' + (s.lon >= 0 ? 'E' : 'W') + '</bdi>'],
      ['fact_h', '<bdi dir="ltr">' + (s.h >= 0 ? '+' : '−') + NAV.num(Math.abs(s.h)) + ' m</bdi>'], ['fact_slope', s.slope.toFixed(1) + '°'],
      ['fact_lit', Math.round(s.litPct) + '%'], ['fact_comm', Math.round(s.commPct) + '%'], ['fact_dark', hrs(s.darkH)], ['fact_gap', hrs(s.gapH)],
    ];
    $('facts').innerHTML = rows.map((r) => '<div><dt>' + T(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('');
    $('fileTitle').textContent = T('file_title', { site: NAV.siteName(s) });
  }
  function renderGeo() {
    const s = site(), ar = NAV.lang === 'ar', g = (window.SiteData ? SiteData.SITES : []).find((x) => x.id === s.id), box = $('geoNotes'); box.textContent = '';
    if (g) {
      for (const [k, key] of [['geo_terrain', 'terrain'], ['geo_rock', 'rock'], ['geo_landing', 'landing']]) {
        const p = document.createElement('p'), b = document.createElement('b'); b.textContent = T(k) + ': '; p.append(b, ar ? g[key] : g[key + '_en']); box.appendChild(p);
      }
      const c = document.createElement('p'); c.className = 'conf'; c.textContent = ar ? g.confidence : g.confidence_en; box.appendChild(c);
    }
    const fig = $('geoFig'), f = figures[s.id]; fig.textContent = '';
    if (f && (f.en || f.ar)) {
      const own = f[NAV.lang], src = own || f.en || f.ar, im = document.createElement('img'), cap = document.createElement('figcaption');
      im.src = src; im.alt = T('geo_fig_cap', { credit: f.credit || '' }); im.loading = 'lazy';
      cap.textContent = T('geo_fig_cap', { credit: f.credit || '' }) + (own ? '' : ' ' + T('geo_fig_other'));
      fig.append(im, cap);
    } else { const d = document.createElement('div'); d.className = 'geo-empty'; d.textContent = T('geo_fig_empty'); fig.appendChild(d); }
  }

  function renderFileLegend(d) {
    const box = $('fileLegend'), Z = NAV.SiteFile.ZONE, L = st.fileLayer; let html = '';
    if (L === 'zone') html = '<span class="lg"><i class="chip" style="background:#F3E9C9;outline:1.5px solid #FFD166"></i>' + T('lg_zone', { s: Z.slope, l: Z.lit, e: Z.earth }) + '</span><span class="note">' + (d && d.areaKm2 >= 0.05 ? T('lg_zone_area', { a: d.areaKm2.toFixed(1) }) : T('lg_zone_none')) + '</span>';
    else if (L === 'slope') { let lo = 0; html = NAV.SiteFile.SLOPE_CLASSES.map((c) => { const t = c[0] === 90 ? '> ' + lo + '°' : lo + '–' + c[0] + '°'; lo = c[0]; return '<span class="lg"><i class="chip" style="background:' + c[1] + '"></i><bdi dir="ltr">' + t + '</bdi></span>'; }).join('') + '<span class="note">' + T('lg_slope_unit') + '</span>'; }
    else html = '<span class="lg">0%<i class="ramp" style="background:' + NAV.SiteFile.rampCss(L) + '"></i>100%</span><span class="note">' + T(L === 'sun' ? 'lg_sun_ramp' : 'lg_earth_ramp') + '</span>';
    box.innerHTML = html;
  }
  async function renderFile() {
    const s = site();
    file.draw(s, st.fileLayer); renderFileLegend(file.cache[s.id]);
    if (!file.cache[s.id]) { try { await file.load(s); } catch (e) { console.error(e); return; } if (site() === s) { file.draw(s, st.fileLayer); renderFileLegend(file.cache[s.id]); } }
  }

  // ---------------------------------------------------------------- controls
  $('siteSel').addEventListener('change', (e) => select(+e.target.value));
  $('langBtn').addEventListener('click', () => setLang(NAV.lang === 'ar' ? 'en' : 'ar'));
  $('landPrev').addEventListener('click', () => setLanding(st.land - 1));
  $('landNext').addEventListener('click', () => setLanding(st.land + 1));
  $('slipReset').addEventListener('click', () => setLanding(st.plan));
  $('toNow').addEventListener('click', () => { st.f = Math.max(0, Math.min(D.windowH - 1, (Date.now() - D.t0) / 3600e3)); need('time'); });
  $('toLanding').addEventListener('click', () => { st.f = st.land * 24; need('time'); });
  const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  seg('missionSeg', (v) => { st.mission = +v; need('plan'); });
  seg('landerSeg', (v) => { st.lander = v; need('plan'); });
  seg('mapSeg', (v) => { st.mapLayer = v; $('mapCap').textContent = T('cap_' + v); need('time'); });
  seg('fileSeg', (v) => { st.fileLayer = v; renderFile(); });

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

  function layout() { sky.resize(); strips.resize(D.sites.length); map.resize(); file.resize(); $('skyNote').textContent = T('sky_note', { n: sky.stretch().toFixed(1) }); need('all'); }
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 80); });

  let lang = 'en';
  try { lang = localStorage.getItem('eol-lang') || lang; } catch (e) { /* storage may be blocked */ }
  NAV.lang = lang === 'ar' ? 'ar' : 'en';
  setLang(NAV.lang);
  layout();
  map.load().then(() => need('time')).catch((e) => console.error(e));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
})();
