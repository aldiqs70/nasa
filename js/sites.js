/*
 * Candidate sites, geology notes, rock guide and landing criteria.
 * Geology content: prepared by the team's geology member (Lunar South Pole Explorer prototype),
 * translated to Arabic. Coordinates are as provided by the team and still need source verification.
 */
(function (root) {
  const SITES = [
    {
      id: 'shackleton-rim-b', name: 'Shackleton Rim B', lat: -89.5244, lon: 56.30993,
      terrain: 'تضاريس مرتفعات وحافة فوهة قرب القطب',
      rock: 'مواد المرتفعات الغنية بالأنورثوسيت (Anorthosite) هي التوقّع الإقليمي، والتركيب المحلي الدقيق يحتاج تحقق من الخرائط الجيولوجية.',
      landing: 'مرشّح لتحليل مفصّل للتضاريس والإضاءة.',
    },
    {
      id: 'shoemaker-rim-a', name: 'Shoemaker Rim A', lat: -88.0792, lon: 11.88866,
      terrain: 'حافة فوهة صدمية',
      rock: 'مواد قشرة المرتفعات وبريشيا صدمية (Breccia) محتملة. لا يوجد تركيب محدد لعيّنات.',
      landing: 'افحص الانحدار والصخور والقرب من المناطق المظللة دائماً.',
    },
    {
      id: 'de-gerlache-rim-1', name: 'de Gerlache Rim 1', lat: -88.6834, lon: -67.9321,
      terrain: 'حافة فوهة قطبية',
      rock: 'مواد مرتفعات ومواد معدّلة بالصدمات متوقعة، والصخور المحلية تحتاج تحقق.',
      landing: 'قيّم المناطق المضاءة والانحدار المحلي.',
    },
    {
      id: 'malapert-massif', name: 'Malapert Massif', lat: -85.9948, lon: -0.23578,
      terrain: 'كتلة جبلية مرتفعة (Massif)',
      rock: 'قشرة مرتفعات غنية بالأنورثوسيت فرضية إقليمية معقولة.',
      landing: 'يستحق الدراسة من ناحية ثبات السطح والتعرض للشمس.',
    },
    {
      id: 'leibnitz-beta', name: 'Leibnitz Beta Plateau', lat: -85.4266, lon: 31.74276,
      terrain: 'هضبة مرتفعة',
      rock: 'مواد قشرة المرتفعات متوقعة، والتركيب المعدني يحتاج تأكيد من بيانات المدار.',
      landing: 'موقع مفيد للمقارنة مع مواقع حواف الفوهات القطبية.',
    },
    {
      id: 'haworth', name: 'Haworth', lat: -86.7639, lon: -22.777,
      terrain: 'منطقة فوهة صدمية',
      rock: 'مواد مرتفعات ومقذوفات صدمية (Ejecta)، وتوزيع الصخور الدقيق يحتاج تحقق.',
      landing: 'ادرس الظل والانحدار وخشونة السطح.',
    },
  ];
  for (const s of SITES) s.confidence = 'سياق جيولوجي إقليمي فقط';

  const ROCKS = [
    { name: 'Anorthosite', ar: 'الأنورثوسيت', color: '#e9e4d6',
      composition: 'فلسبار البلاجيوكليز (Plagioclase feldspar)', look: 'فاتح اللون',
      origin: 'القشرة القمرية القديمة', where: 'شائع في المرتفعات القمرية',
      landing: 'صخر أساس قوي، لكن ثبات السطح لازم يُقاس.' },
    { name: 'Basalt', ar: 'البازلت', color: '#4a4f5c',
      composition: 'بيروكسين وبلاجيوكليز ومعادن غنية بالحديد', look: 'داكن غالباً',
      origin: 'نشاط بركاني', where: 'البحار القمرية (Maria) ورواسب بركانية محلية',
      landing: 'هدف جيولوجي مفيد، لكنه مش بالضرورة سطح هبوط أكثر أماناً.' },
    { name: 'Breccia', ar: 'البريشيا', color: '#8d8473',
      composition: 'شظايا من صخور مختلفة ملتحمة', look: 'متعدد الألوان',
      origin: 'الاصطدامات النيزكية', where: 'المناطق المتأثرة بالصدمات',
      landing: 'الثبات بيختلف حسب درجة التماسك والحطام على السطح.' },
    { name: 'Lunar Regolith', ar: 'الريغوليث القمري', color: '#9b9790',
      composition: 'غبار وحبيبات وشظايا صخرية', look: 'رمادي ناعم',
      origin: 'اصطدامات مستمرة عبر ملايين السنين', where: 'يغطي معظم سطح القمر',
      landing: 'لازم يُقيَّم عمقه وقدرة تحمّله وكثافة الصخور فيه.' },
  ];

  // status: 'calc' computed by this tool, 'soon' computed once terrain is loaded, 'na' needs data we don't have
  const CRITERIA = [
    { key: 'sun', label: 'توفر ضوء الشمس', status: 'calc' },
    { key: 'comm', label: 'رؤية الأرض للاتصال', status: 'calc' },
    { key: 'slope', label: 'انحدار السطح', status: 'calc' },
    { key: 'psr', label: 'البعد عن المناطق المظللة دائماً (جليد محتمل)', status: 'soon' },
    { key: 'boulders', label: 'كثافة الصخور وتوزيعها', status: 'na', note: 'يحتاج صور LROC NAC بدقة متر' },
    { key: 'regolith', label: 'عمق الريغوليث وقدرة تحمّله', status: 'na', note: 'يحتاج قياسات سطحية أو رادار' },
  ];

  const SOURCES = [
    { name: 'NASA LRO Data Products', url: 'https://science.nasa.gov/mission/lro/data-products/', what: 'بيانات مركبة الاستطلاع القمري' },
    { name: 'LOLA polar DEMs (NASA GSFC PGDA)', url: 'https://pgda.gsfc.nasa.gov/products/90', what: 'خرائط التضاريس' },
    { name: 'LOLA Polar Illumination (Mazarico et al. 2011)', url: 'https://pgda.gsfc.nasa.gov/products/69', what: 'خرائط الإضاءة ورؤية الأرض المرجعية' },
    { name: 'NAIF SPICE (JPL)', url: 'https://naif.jpl.nasa.gov/naif/', what: 'مواقع الشمس والأرض ودوران القمر' },
    { name: 'Cesium Moon', url: 'https://cesium.com/platform/cesium-ion/content/cesium-moon/', what: 'القمر ثلاثي الأبعاد' },
    { name: 'Lunar South Pole Atlas (LPI)', url: 'https://www.lpi.usra.edu/lunar/lunar-south-pole-atlas/', what: 'أطلس القطب الجنوبي' },
    { name: 'NASA Solar System Treks', url: 'https://trek.nasa.gov/', what: 'خرائط تفاعلية من ناسا' },
    { name: 'Lunar Prospector GRS — FeO & Th half-degree maps (Lawrence et al. 2002, 2003)', url: 'https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html', what: 'كيمياء السطح لتقدير نسب الصخور' },
    { name: 'NASA Planetary Data System', url: 'https://pds.nasa.gov/', what: 'أرشيف بيانات الكواكب' },
  ];

  root.SiteData = { SITES, ROCKS, CRITERIA, SOURCES };
})(typeof window !== 'undefined' ? window : globalThis);
