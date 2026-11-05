ملفات SPICE المستخدمة (من NAIF / JPL):
de421.bsp                      مواقع الشمس والأرض والقمر
moon_pa_de421_1900-2050.bpc    دوران القمر الدقيق (الترنّح)
moon_080317.tf                 تعريف إطار MOON_ME (نفس إطار خرائط LOLA)
pck00008.tpc                   ثوابت الأجرام

الوقت: ET = UTC + 69.184 ثانية (ما في ثواني كبيسة جديدة بعد 2017) — لذلك ما احتجنا ملف naif0012.tls
لإعادة توليد الجدول:  python scripts/make_ephemeris.py   (يحتاج: pip install spiceypy numpy)
