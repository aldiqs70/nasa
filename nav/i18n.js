/* Interface text, English and Arabic. T(key, vars) fills {name} holes. */
(function () {
  const NAV = (window.NAV = window.NAV || {});
  const S = {
    brand: ['Edge of Light', 'حافة النور'],
    tagline: ['Lunar landing site navigator', 'ملّاح مواقع الهبوط على القمر'],
    nav_navigator: ['Navigator', 'الملّاح'],
    nav_file: ['Site file', 'ملف الموقع'],
    nav_method: ['Method', 'المنهجية'],
    sky_title: ['The sky from the landing site', 'السماء من موقع الهبوط'],
    site: ['Landing site', 'موقع الهبوط'],
    power: ['Panel output', 'إنتاج الألواح'],
    play: ['Play', 'تشغيل'], pause: ['Pause', 'إيقاف'],
    to_now: ['Now', 'الآن'], to_landing: ['Landing day', 'يوم الهبوط'],
    sunset_in: ['Sunset in', 'غروب الشمس بعد'], sunrise_in: ['Sunrise in', 'شروق الشمس بعد'],
    earthset_in: ['Earthset in', 'غياب الأرض بعد'], earthrise_in: ['Earthrise in', 'ظهور الأرض بعد'],
    sun_up: ['{p}% of the disc is clear of the terrain', '{p}% من قرص الشمس ظاهر فوق التضاريس'],
    sun_down: ['The Sun is behind the terrain', 'الشمس خلف التضاريس'],
    earth_up: ['Earth is {a}° above the terrain', 'الأرض {a}° فوق التضاريس'],
    earth_down: ['Earth is hidden, no direct link', 'الأرض مخفية، لا اتصال مباشر'],
    past: ['after {date}', 'بعد {date}'],
    no_change: ['No change before {date}', 'لا تغيير قبل {date}'],
    pow_sub: ['{name} lander, {a} m² of Sun-tracking panels', 'مركبة {name}، {a} م² ألواح تتبع الشمس'],
    d: ['d', 'ي'], h: ['h', 'س'],
    sky_note: ['Full 360° around the site. Heights are stretched ×{n} so the low Sun and the ridgelines read clearly. Drag to turn the view.',
      'الأفق كاملاً 360° حول الموقع. الارتفاعات مكبّرة ×{n} لتظهر الشمس المنخفضة وخطوط التلال بوضوح. اسحب لتدوير المنظر.'],
    lbl_sun: ['Sun', 'الشمس'], lbl_earth: ['Earth', 'الأرض'], lbl_hidden: ['behind terrain', 'خلف التضاريس'],
    N: ['N', 'ش'], E: ['E', 'شر'], Sth: ['S', 'ج'], Wst: ['W', 'غ'],
    map_title: ['South pole, 150 km around', 'القطب الجنوبي، 150 كم حوله'],
    l_relief: ['Relief', 'التضاريس'], l_sun: ['Sunlight', 'ضوء الشمس'], l_earth: ['Earth', 'الأرض'],
    cap_relief: ['Shaded relief from LOLA elevation.', 'تضاريس مظللة من ارتفاعات LOLA.'],
    cap_sun: ['Brighter ground gets sunlight for more of 2026 to 2030. Black never sees the Sun.', 'الأرض الأفتح تصلها الشمس وقتاً أطول بين 2026 و2030. الأسود لا يرى الشمس أبداً.'],
    cap_earth: ['Bluer ground has the Earth in view for more of the time.', 'الأرض الأكثر زرقة ترى كوكب الأرض وقتاً أطول.'],
    to_sun: ['Direction to the Sun now', 'اتجاه الشمس الآن'], to_earth: ['Direction to the Earth now', 'اتجاه الأرض الآن'],
    strips_title: ['Sunlight and Earth contact, site by site', 'ضوء الشمس والاتصال بالأرض، موقعاً بموقع'],
    landing: ['Landing', 'الهبوط'], mission: ['Mission', 'المهمة'], lander: ['Lander', 'المركبة'],
    small: ['Small', 'صغيرة'], medium: ['Medium', 'متوسطة'], large: ['Large', 'كبيرة'],
    days_n: ['{n} d', '{n} ي'],
    slip_late: ['{n} d later than planned', 'متأخر {n} يوم عن الخطة'], slip_early: ['{n} d earlier than planned', 'أبكر {n} يوم من الخطة'],
    to_plan: ['Back to plan', 'رجوع للخطة'],
    plan: ['Plan', 'الخطة'],
    lg_sun: ['Sunlight on the lander', 'ضوء الشمس على المركبة'], lg_earth: ['Earth in view', 'الأرض ظاهرة'],
    lg_ok: ['Landing that day works', 'الهبوط بهذا اليوم ينجح'], lg_sleep: ['Lander has to sleep', 'المركبة تضطر للنوم'], lg_lost: ['Lander is lost', 'نفقد المركبة'],
    o_ok: ['Works all {n} days', 'تعمل كل الـ{n} يوماً'],
    o_ok_dark: ['Works, but lands in the dark', 'تعمل، لكن الهبوط في العتمة'],
    o_sleep: ['Sleeps {h} h, then wakes', 'تنام {h} ساعة ثم تصحو'],
    o_lost: ['Lost on day {d}', 'نفقدها في اليوم {d}'],
    v_ok: ['Landing on <b>{date}</b> at <b>{site}</b> works for all {n} days.', 'الهبوط يوم <b>{date}</b> في <b>{site}</b> ينجح طوال {n} يوماً.'],
    v_ok_dark: ['Landing on <b>{date}</b> at <b>{site}</b> works for all {n} days, but touchdown is in darkness.', 'الهبوط يوم <b>{date}</b> في <b>{site}</b> ينجح طوال {n} يوماً، لكن لحظة الهبوط في العتمة.'],
    v_sleep: ['Landing on <b>{date}</b> at <b>{site}</b>: the lander <b class="t-sleep">sleeps for {h} hours</b> in the dark, then wakes.', 'الهبوط يوم <b>{date}</b> في <b>{site}</b>: المركبة <b class="t-sleep">تنام {h} ساعة</b> في العتمة ثم تصحو.'],
    v_lost: ['Landing on <b>{date}</b> at <b>{site}</b>: the lander is <b class="t-lost">lost on day {d}</b>. The battery runs flat in the dark.', 'الهبوط يوم <b>{date}</b> في <b>{site}</b>: <b class="t-lost">نفقد المركبة في اليوم {d}</b>. البطارية تفرغ في العتمة.'],
    v_margin: ['The schedule can slip {n} more days here and still work. Lowest battery charge: {soc}%.', 'يمكن أن يتأخر الموعد {n} يوماً إضافياً هنا ويبقى ناجحاً. أدنى شحن للبطارية: {soc}%.'],
    v_margin0: ['No slack: one more day of delay and this landing stops working. Lowest battery charge: {soc}%.', 'لا هامش: يوم تأخير واحد ويتوقف نجاح هذا الهبوط. أدنى شحن للبطارية: {soc}%.'],
    v_margin_all: ['It keeps working for every later landing day in this window. Lowest battery charge: {soc}%.', 'يبقى ناجحاً لكل أيام الهبوط اللاحقة في هذه النافذة. أدنى شحن للبطارية: {soc}%.'],
    v_fix: ['Two ways out:', 'مخرجان:'], v_fix1: ['One way out:', 'مخرج واحد:'],
    v_nofix: ['None of these sites works on any day in this window with this lander.', 'لا يوجد موقع من هذه المواقع ينجح في أي يوم من هذه النافذة بهذه المركبة.'],
    fix_date: ['Keep the site, land {date}', 'نفس الموقع، الهبوط {date}'],
    fix_date_s: ['{n} d later', 'بعد {n} يوم'], fix_date_e: ['{n} d earlier', 'قبل {n} يوم'],
    fix_site: ['Keep {date}, move to {site}', 'نفس التاريخ {date}، الانتقال إلى {site}'],
    fix_site_s: ['{km} km away, works all {n} days', 'على بعد {km} كم، تعمل كل الـ{n} يوماً'],
    file_title: ['Site file: {site}', 'ملف الموقع: {site}'],
    f_zone: ['Landing zone', 'منطقة الهبوط'], f_slope: ['Slope', 'الانحدار'], f_sun: ['Sunlight', 'ضوء الشمس'], f_earth: ['Earth contact', 'الاتصال بالأرض'],
    lg_zone: ['Passes all three: slope up to {s}°, sunlight at least {l}% and Earth in view at least {e}% of 2027', 'يحقق الثلاثة: انحدار حتى {s}°، ضوء شمس {l}% على الأقل، والأرض ظاهرة {e}% على الأقل من 2027'],
    lg_zone_area: ['{a} km² of this 24 km square passes', '{a} كم² من هذا المربع (24 كم) يحقق الشروط'],
    lg_zone_none: ['Nothing in this 24 km square passes all three', 'لا شيء في هذا المربع (24 كم) يحقق الشروط الثلاثة'],
    lg_slope_unit: ['Slope over an 80 m baseline', 'الانحدار على قاعدة 80 م'],
    lg_sun_ramp: ['Share of 2027 with the Sun above the terrain', 'نسبة عام 2027 والشمس فوق التضاريس'],
    lg_earth_ramp: ['Share of 2027 with the Earth above the terrain', 'نسبة عام 2027 والأرض فوق التضاريس'],
    site_mark: ['Site', 'الموقع'],
    fact_lat: ['Latitude', 'خط العرض'], fact_lon: ['Longitude', 'خط الطول'], fact_h: ['Elevation', 'الارتفاع'], fact_slope: ['Slope at the site', 'الانحدار في الموقع'],
    fact_lit: ['Sunlight, next 60 days', 'ضوء الشمس، 60 يوماً قادمة'], fact_comm: ['Earth in view, next 60 days', 'الأرض ظاهرة، 60 يوماً قادمة'],
    fact_dark: ['Longest darkness', 'أطول عتمة'], fact_gap: ['Longest gap in contact', 'أطول انقطاع اتصال'],
    fact_h_note: ['above the 1737.4 km sphere', 'فوق كرة نصف قطرها 1737.4 كم'],
    geo_title: ['Geology', 'الجيولوجيا'],
    geo_terrain: ['Terrain', 'التضاريس'], geo_rock: ['Expected rock', 'الصخور المتوقعة'], geo_landing: ['For landing', 'للهبوط'],
    geo_fig_cap: ['Analysis map from the geology team ({credit}). Each site takes one figure per language.', 'خريطة تحليلية من فريق الجيولوجيا ({credit}). لكل موقع شكل واحد لكل لغة.'],
    geo_fig_other: ['Shown in Arabic until the English version is ready.', 'معروضة بالإنجليزية إلى أن تجهز النسخة العربية.'],
    geo_fig_empty: ['The geology team’s analysis map for this site goes here.', 'هنا توضع الخريطة التحليلية لفريق الجيولوجيا لهذا الموقع.'],
    method_title: ['How the numbers are made', 'كيف تُحسب الأرقام'],
    m1: ['Terrain comes from the LOLA 80 m south-pole elevation model (NASA GSFC). From each site we cast 2,880 rays out to 300 km over the curved Moon and keep the highest terrain in every quarter degree of azimuth. That outline is the horizon you see in the panorama.',
      'التضاريس من نموذج ارتفاعات LOLA للقطب الجنوبي بدقة 80 م (ناسا GSFC). من كل موقع نُطلق 2,880 شعاعاً حتى 300 كم فوق سطح القمر المنحني، ونحتفظ بأعلى تضاريس في كل ربع درجة من السمت. هذا هو خط الأفق الذي تراه في المنظر.'],
    m2: ['Sun and Earth positions come from NAIF SPICE (DE421) in the Moon-fixed frame, hour by hour, so libration and the lunar seasons are included. The Sun counts as up by the share of its disc clear of the terrain, the Earth by its centre.',
      'مواقع الشمس والأرض من NAIF SPICE (DE421) في الإطار المثبت بالقمر ساعة بساعة، فتدخل فيها الميسان (libration) وفصول القمر. الشمس تُحسب ظاهرة بنسبة قرصها فوق التضاريس، والأرض بمركزها.'],
    m3: ['The lander is an hourly energy balance: Sun-tracking panels, a battery, a working load and a sleep mode that keeps the heaters on. Research and education prototype, not flight certification. Earth visibility is geometric, not radio link quality.',
      'المركبة ميزان طاقة ساعة بساعة: ألواح تتبع الشمس، بطارية، حمل تشغيل، ووضع نوم يُبقي السخانات تعمل. نموذج للبحث والتعليم وليس اعتماداً للطيران. رؤية الأرض هندسية وليست جودة وصلة راديو.'],
    scope: ['Preview of the new interface on six team sites. The full site search, water ice, custom coordinates and sites elsewhere on the Moon move over next.',
      'معاينة للواجهة الجديدة على ستة مواقع للفريق. البحث الكامل عن المواقع، الجليد المائي، الإحداثيات الحرة ومواقع باقي القمر تنتقل لاحقاً.'],
    load_fail: ['The site data did not load. Reload the page.', 'لم تُحمَّل بيانات الموقع. أعد تحميل الصفحة.'],
  };
  NAV.lang = 'en';
  NAV.T = function (key, vars) {
    const e = S[key]; let s = e ? e[NAV.lang === 'ar' ? 1 : 0] : key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  };
  NAV.applyText = function () {
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = NAV.T(el.dataset.i18n); });
  };
  const fmt = {};
  function df(opts) {
    const k = NAV.lang + JSON.stringify(opts);
    return fmt[k] || (fmt[k] = new Intl.DateTimeFormat(NAV.lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', Object.assign({ timeZone: 'UTC' }, opts)));
  }
  NAV.fmtDay = (ms) => df({ day: 'numeric', month: 'short' }).format(ms);
  NAV.fmtDayLong = (ms) => df({ day: 'numeric', month: 'long' }).format(ms);
  NAV.fmtClock = (ms) => df({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(ms) + ', ' + new Date(ms).toISOString().slice(11, 16) + ' UTC';
  NAV.fmtMonth = (ms) => df({ month: 'short' }).format(ms);
  NAV.num = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  NAV.siteName = (s) => (NAV.lang === 'ar' && s.ar ? s.ar : s.name);
})();
