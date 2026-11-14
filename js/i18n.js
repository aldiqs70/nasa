/*
 * Language: Arabic (default for Arabic browsers) or English.
 * Order: ?lang=en|ar in the URL, then the last choice saved in this browser, then the browser language.
 * Static page text is translated by matching each text node; dynamic text in app.js uses T(arabic, english).
 */
(function (root) {
  'use strict';
  let q = null;
  try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* old browser */ }
  let lang = q === 'en' || q === 'ar' ? q : null;
  if (!lang) { try { lang = localStorage.getItem('eol-lang'); } catch (e) { /* storage blocked */ } }
  if (lang !== 'en' && lang !== 'ar') lang = /^ar\b/i.test(navigator.language || '') ? 'ar' : 'en';
  try { localStorage.setItem('eol-lang', lang); } catch (e) { /* storage blocked */ }
  const EN = lang === 'en';
  const html = document.documentElement;
  html.lang = lang; html.dir = EN ? 'ltr' : 'rtl';
  root.LANG = lang;
  root.T = (ar, en) => (EN ? en : ar);

  // Arabic text in index.html -> English (keys are the text with spaces collapsed)
  const TXT = {
    'Lunar South Pole': 'Lunar South Pole Mission Browser',
    'الرئيسية': 'Home',
    'المستكشف ثلاثي الأبعاد': '3D Explorer',
    'مخطط المهمة': 'Mission Planner',
    'مقارنة المواقع': 'Compare Sites',
    'مواقع الجليد': 'Water Ice',
    'المنهجية والمصادر': 'Methods & Sources',
    'خطّط مهمتك': 'Plan your mission',
    'القائمة': 'Menu',
    'الشمس': 'Sun',
    'الأرض': 'Earth',
    'القمر': 'Moon',
    'القطب الجنوبي للقمر، المكان الوحيد اللي الشمس فيه بتلفّ حوالين الأفق بدل ما تطلع وتغيب.': 'The Moon’s south pole, where the Sun circles along the horizon instead of rising and setting.',
    'الجسم المعروض': 'Focus on',
    'خيارات العرض': 'Display',
    'مسارات المدارات': 'Orbit paths',
    'الأسماء': 'Labels',
    'منطقة القطب الجنوبي': 'South pole region',
    'شبكة الإحداثيات': 'Coordinate grid',
    'استكشف القطب ثلاثي الأبعاد': 'Explore the pole in 3D',
    'خطّط مهمة هبوط': 'Plan a landing',
    'تفاصيل القمر': 'Moon details',
    'شغّل الزمن': 'Play time',
    'القطب الجنوبي بنظرة وحدة': 'The south pole at a glance',
    'كل الأرقام بالموقع محسوبة من بيانات ناسا الحقيقية: تضاريس LOLA (دقة 80 م)، ومواقع الشمس والأرض من JPL، ومناطق الجليد من رصدات Moon Mineralogy Mapper.': 'Every number on this site is computed from real NASA data: LOLA terrain (80 m resolution), Sun and Earth positions from JPL, and ice regions from Moon Mineralogy Mapper detections.',
    'تصنيف مواقع الهبوط على المدى الطويل (2026 – 2030)': 'Long-term landing site classes (2026 – 2030)',
    'مناسب': 'Suitable',
    'بحذر': 'Caution',
    'صعب': 'Difficult',
    'جليد مرصود': 'Detected ice',
    'مناسب: الشمس ≥ 50% من الوقت، والأرض ظاهرة ≥ 50%، والانحدار ≤ 8°. بحذر: الشمس ≥ 30% والانحدار ≤ 15°. بمخطط المهمة بتختار تواريخك ومركبتك، والتصنيف بيتغير حسبهم.': 'Suitable: Sun visible ≥ 50% of the time, Earth visible ≥ 50%, slope ≤ 8°. Caution: Sun ≥ 30% and slope ≤ 15°. In the Mission Planner you pick your dates and lander, and the classes change with them.',
    'أعلى إضاءة لقيناها': 'Highest illumination we found',
    'من وقت السنة تكون الشمس ظاهرة، على شبكة كل 1 كم. وقيعان الفوهات الكبيرة 0% طول الوقت.': 'of the year with the Sun in view, on a 1 km grid. Large crater floors stay at 0% all the time.',
    'مناطق ظل دائم فيها جليد': 'Permanently shadowed regions with ice',
    'رصدها جهاز M3 من ناسا، مع درجات الحرارة والهيدروجين لكل منطقة (Lemelin et al. 2021).': 'Detected by NASA’s M3 instrument, with temperature and hydrogen for each region (Lemelin et al. 2021).',
    'اختار نافذة الهبوط ومدة المهمة والبطارية والاستهلاك، وبنحسبلك أفضل 3 مواقع بالقطب، مع القرب من الجليد.': 'Choose the landing window, mission length, battery and power draw, and we find the 3 best sites at the pole, including distance to ice.',
    'مقارنة موقعين': 'Compare two sites',
    'الإضاءة والاتصال والطاقة وخط الأفق جنب بعض، لنفس الفترة ونفس المركبة.': 'Light, Earth contact, power and horizon side by side, for the same period and the same lander.',
    'LunarLink_JO · فريق شباب شهاب · الجمعية الفلكية الأردنية · NASA Space Apps Challenge 2026': 'LunarLink_JO · Team Shabab Shihab · Jordanian Astronomical Society · NASA Space Apps Challenge 2026',
    'البيانات من ناسا (LOLA, LRO, M3, Lunar Prospector, NAIF/JPL). نموذج تعليمي وبحثي، مش أداة تخطيط رسمية.': 'Data from NASA (LOLA, LRO, M3, Lunar Prospector, NAIF/JPL). An educational and research model, not an official mission-planning tool.',
    'الطبقات': 'Layers',
    'زاوية الرؤية': 'View',
    'القطب': 'Pole',
    'من فوق': 'Top-down',
    'روح لموقع': 'Go to site',
    'إضاءة الشمس الحقيقية': 'Real sunlight',
    'ظلال ثلاثية الأبعاد': '3D shadows',
    'جودة عالية (أبطأ)': 'High quality (slower)',
    'مواقع الفريق': 'Team sites',
    'مناطق الجليد': 'Ice regions',
    'أفضل 3 مواقع من المخطط': 'Top 3 from the planner',
    'اضغط على أي نقطة على القمر عشان تحللها. الحسابات بتاخد الجبال المحيطة لمسافة 300 كم بعين الاعتبار.': 'Click any point on the Moon to analyse it. The calculation includes surrounding mountains up to 300 km away.',
    'تفاصيل النقطة': 'Point details',
    'اضغط على أي نقطة بالقطب الجنوبي، أو اختار موقع من القائمة.': 'Click any point near the south pole, or pick a site from the list.',
    'الارتفاع': 'Elevation',
    'الانحدار': 'Slope',
    'البعد عن القطب': 'Distance from pole',
    'أقرب جليد مرصود': 'Nearest detected ice',
    'الآن بهاي اللحظة': 'Right now',
    'طاقة اللوح': 'Panel power',
    'اتجاه الشمس = وين توجّه اللوح': 'Sun direction = where to face the panel',
    'الأرض = وين توجّه الهوائي': 'Earth = where to point the antenna',
    'تحليل كامل': 'Full analysis',
    'قارن': 'Compare',
    'فحص البطارية': 'Battery check',
    'خط العرض': 'Lat',
    'خط الطول': 'Lon',
    'الآن': 'Now',
    'تشغيل': 'Play',
    'تحليل الموقع': 'Site analysis',
    '30 يوم من التاريخ المختار': '30 days from the chosen date',
    '90 يوم': '90 days',
    'سنة كاملة': 'Full year',
    '2026 – 2030 كاملة': 'All of 2026 – 2030',
    'إغلاق': 'Close',
    'الإضاءة والاتصال': 'Light & contact',
    'اتجاه الألواح الشمسية': 'Solar panel direction',
    'البطارية': 'Battery',
    'الجليد القريب': 'Nearby ice',
    'الصخور والجيولوجيا': 'Rocks & geology',
    'الشمس ظاهرة': 'Sun visible',
    'أطول ظلمة': 'Longest darkness',
    'متوسط الطاقة': 'Mean power',
    'الأرض ظاهرة': 'Earth visible',
    'أطول انقطاع': 'Longest blackout',
    'شمس وأرض معاً': 'Sun + Earth together',
    'خط الأفق الحقيقي من الموقع (360°) ومسار الشمس': 'Real horizon from the site (360°) with the path of the Sun',
    'والأرض': 'and Earth',
    'مع الوقت: الشريط الأصفر = شمس، الأزرق = اتصال، والخطوط = ارتفاعهم بالدرجات': 'Over time: yellow band = Sun, blue = Earth contact, lines = their altitude in degrees',
    'لوح يلف مع الشمس': 'Sun-tracking panel',
    'لوح ثابت بأفضل اتجاه': 'Fixed panel, best direction',
    'لوحين ظهر لظهر': 'Two back-to-back panels',
    'الشكل يوضّح كم طاقة بيعطي لوح عمودي ثابت لو وجّهته لكل اتجاه. بالقطب الشمس بتلف حوالين الأفق مرة كل شهر تقريباً، فاللوح الثابت بيضيّع جزء كبير من الطاقة. عشان هيك أغلب المركبات القطبية بتستخدم لوح بيلف، أو ألواح على أكثر من جهة.': 'The plot shows how much energy a fixed vertical panel collects when facing each direction. At the pole the Sun circles the horizon about once a month, so a fixed panel misses much of the energy. That is why most polar landers use a rotating panel, or panels on several sides.',
    'حدّد متى بتقدر تهبط، وكم بدها المهمة، وشو مواصفات مركبتك. بنجرّب كل موقع بالقطب الجنوبي (شبكة كل 2 كم) بكل يوم هبوط ممكن، وبنحسب الإضاءة والاتصال ورصيد البطارية ساعة بساعة على التضاريس الحقيقية. بعدين بنطلعلك أفضل 3 مواقع، مع القرب من الجليد.': 'Set when you can land, how long the mission lasts and what your lander is like. We test every site at the south pole (2 km grid) on every possible landing day, and simulate sunlight, Earth contact and battery charge hour by hour over the real terrain. Then we give you the 3 best sites, including distance to ice.',
    'نافذة الهبوط والمهمة': 'Landing window & mission',
    'من تاريخ': 'From',
    'إلى تاريخ': 'To',
    'مدة المهمة على السطح': 'Time on the surface',
    '14 يوم': '14 days',
    'المركبة والطاقة': 'Lander & power',
    'صغيرة': 'Small',
    'متوسطة': 'Medium',
    'كبيرة': 'Large',
    'سعة البطارية (Wh)': 'Battery capacity (Wh)',
    'الاستهلاك (W)': 'Power draw (W)',
    'مساحة الألواح (m²)': 'Panel area (m²)',
    'كفاءة الألواح (%)': 'Panel efficiency (%)',
    'أدنى شحن مسموح للبطارية': 'Lowest allowed battery charge',
    'الألواح': 'Panels',
    'بتلف مع الشمس': 'Track the Sun',
    'ثابتة باتجاه': 'Fixed direction',
    'اتجاه اللوح الثابت (السمت)': 'Fixed panel azimuth',
    'المركبة بتقدر تنام بالظلمة وتصحى مع الشمس': 'Lander can sleep through the dark and wake with the Sun',
    'استهلاك وضع النوم (W)': 'Sleep-mode power (W)',
    'بتصحى لما يوصل الشحن (%)': 'Wakes up at charge (%)',
    'بوضع النوم كل الأجهزة بتطفي، وبتضل السخانات بس عشان ما تتجمد البطارية. إذا خلصت البطارية وهي نايمة، السخانات بتطفي والبرد بيتلفها، وهيك بتنتهي المهمة. 0 W يعني تدفئة ما بتحتاج كهرباء، زي مصادر الحرارة النووية الصغيرة بمركبة Chang\'e 4.': 'In sleep mode everything switches off except the heaters that keep the battery from freezing. If the battery runs flat while asleep, the heaters stop, the cold destroys the electronics, and the mission ends. 0 W means heating that needs no electricity, like the small nuclear heat sources on Chang’e 4.',
    'الأحجام الجاهزة أمثلة توضيحية، مش مواصفات مركبة حقيقية. الألواح عمودية لأنه الشمس بالقطب واطية (أقل من 2° فوق الأفق).': 'The presets are illustrative, not the specs of a real lander. Panels are vertical because the Sun at the pole is very low (under 2° above the horizon).',
    'الأولويات': 'Priorities',
    'أهمية القرب من الجليد': 'Importance of being near ice',
    'أهمية الاتصال مع الأرض': 'Importance of Earth contact',
    'أهمية الإضاءة': 'Importance of sunlight',
    'عالية': 'High',
    'أقصى انحدار': 'Max slope',
    'أقصى مسافة للجليد': 'Max distance to ice',
    '15 كم': '15 km',
    'جليد مؤكد أكثر فقط (5 رصدات أو أكثر)': 'Only well-confirmed ice (5+ detections)',
    'احسب أفضل المواقع': 'Find the best sites',
    'كل القطب': 'Whole pole',
    'غير مناسب': 'Unsuitable',
    'جليد': 'Ice',
    'أفضل 3': 'Top 3',
    ': المركبة بتشتغل كل المهمة بدون ما تنام وبيضل فيها 30% شحن على الأقل، والانحدار ≤ 8°، والأرض ظاهرة ≥ 40% من الوقت.': ': the lander works through the whole mission without sleeping and keeps at least 30% charge, slope ≤ 8°, and Earth is visible ≥ 40% of the time.',
    ': المركبة بتعيش لآخر المهمة بس بهامش أقل، أو بتنام بالظلمة وبتصحى، أو الانحدار أعلى.': ': the lander survives the mission but with a smaller margin, or has to sleep through dark periods, or the slope is higher.',
    ': المركبة بتنتهي قبل آخر المهمة بكل أيام النافذة. اضغط على الخريطة عشان تفحص أي نقطة.': ': the lander is lost before the mission ends on every day of the window. Click the map to check any point.',
    'أفضل 3 مواقع': 'Top 3 sites',
    'اضغط «احسب أفضل المواقع» عشان تطلع النتائج.': 'Press “Find the best sites” to see results.',
    'هل الطاقة كافية؟': 'Is there enough power?',
    'الموقع': 'Site',
    'تاريخ الهبوط': 'Landing date',
    'افحص الطاقة': 'Check power',
    'مقارنة بين موقعين': 'Compare two sites',
    'اختار موقعين من القائمة، أو اضغط على الخريطة. بنحسب الاثنين لنفس الفترة ونفس المركبة (من إعدادات مخطط المهمة)، وبنعلّم الأفضل بكل معيار.': 'Pick two sites from the lists, or click the map. Both are computed for the same period and the same lander (from the Mission Planner settings), and the better one is marked for each criterion.',
    'بداية الفترة': 'Start date',
    'مدة المهمة': 'Mission length',
    '30 يوم': '30 days',
    'سنة': '1 year',
    'يوم الهبوط': 'Landing day',
    'كل موقع بأفضل يوم (خلال شهر)': 'Best day per site (within a month)',
    'نفس التاريخ للموقعين': 'Same date for both',
    'الموقع الأول': 'First site',
    'الموقع الثاني': 'Second site',
    'الضغطة الجاية بتحدد A': 'Next click sets A',
    'بتحدد B': 'Sets B',
    'اختار الموقعين واضغط «قارن».': 'Pick two sites and press “Compare”.',
    'خط الأفق:': 'Horizon:',
    'و': 'and',
    'شحن البطارية من لحظة الهبوط:': 'Battery charge from landing:',
    'شغّالة': 'Working',
    'نايمة': 'Asleep',
    'انتهت': 'Lost',
    'شمس': 'Sun',
    'اتصال': 'Contact',
    'A خلال المهمة': 'A during the mission',
    'B خلال المهمة': 'B during the mission',
    'وين الجليد بالقطب الجنوبي؟': 'Where is the ice at the south pole?',
    'بقيعان الفوهات اللي ما بتوصلها الشمس أبداً، الحرارة بتنزل لحد 25–40 كلفن (أبرد من سطح بلوتو)، فالماء بيضل متجمد مليارات السنين. هاي الخريطة بتعرض': 'In crater floors that sunlight never reaches, temperatures drop to 25–40 K (colder than Pluto’s surface), so water can stay frozen for billions of years. This map shows',
    '169 منطقة ظل دائم': '169 permanently shadowed regions',
    'رصد فيها جهاز Moon Mineralogy Mapper التابع لناسا آثار جليد على السطح، مع الحرارة والهيدروجين لكل وحدة.': 'where NASA’s Moon Mineralogy Mapper found signs of surface ice, with temperature and hydrogen for each.',
    'مناطق فيها جليد مرصود': 'Regions with detected ice',
    'عدد رصدات الجليد (M3)': 'Ice detections (M3)',
    'أكثر منطقة رصدات': 'Most detections',
    'تأكيد بالاصطدام': 'Confirmed by impact',
    'إظهار الظل الدائم المحسوب من حساباتنا (كل 1 كم)': 'Show permanent shadow from our own calculation (1 km grid)',
    'إظهار المناطق اللي فيها 5 رصدات أو أكثر بس': 'Only show regions with 5+ detections',
    'منطقة ظل دائم فيها جليد (كل ما زاد اللون زادت الرصدات)': 'Permanently shadowed region with ice (stronger colour = more detections)',
    'LCROSS: مكان الاصطدام اللي أكد وجود الماء': 'LCROSS: the impact site that confirmed water',
    'اضغط على منطقة بالخريطة أو بالجدول عشان تشوف تفاصيلها.': 'Click a region on the map or in the table to see its details.',
    'كل رقم بالموقع إله مصدر، وبنقدر نعيد حسابه. هون بنشرح كيف حسبنا، وشو حدود الدقة، ومن وين تنزّل البيانات.': 'Every number on this site has a source and can be recomputed. Here we explain how we calculated, the limits of accuracy, and where to download the data.',
  };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const AR = /[؀-ۿ]/;

  function apply(rootEl) {
    const btn = document.getElementById('langBtn');
    if (btn) { btn.textContent = EN ? 'عربي' : 'English'; btn.setAttribute('lang', EN ? 'ar' : 'en'); btn.title = EN ? 'اقرأ الموقع بالعربي' : 'Read this site in English'; }
    if (!EN) return;
    document.title = TXT[norm(document.title)] || document.title;
    const miss = [];
    const w = document.createTreeWalker(rootEl || document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentNode; if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.id === 'langBtn')) continue;
      const k = norm(n.nodeValue); if (!k) continue;
      const v = TXT[k];
      if (v != null) n.nodeValue = (/^\s/.test(n.nodeValue) ? ' ' : '') + v + (/\s$/.test(n.nodeValue) ? ' ' : '');
      else if (AR.test(k)) miss.push(k);
    }
    (rootEl || document.body).querySelectorAll('[title],[aria-label],[placeholder]').forEach((el) => {
      for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && TXT[norm(v)]) el.setAttribute(a, TXT[norm(v)]); }
    });
    if (miss.length) console.warn('i18n: no English for', miss);
  }
  function toggle() {
    const next = EN ? 'ar' : 'en';
    try { localStorage.setItem('eol-lang', next); } catch (e) { /* storage blocked */ }
    const u = new URL(location.href); u.searchParams.set('lang', next);
    location.replace(u.toString());
  }
  root.I18N = { lang, apply, toggle };
})(window);
