/* 3D Moon (Cesium). Three levels, best available first:
     tiles: Cesium Moon terrain tiles from Cesium ion (needs the token in config.js and ion reachable)
     lite : a smooth Moon with the LRO image map from this site, when the tiles cannot be loaded
     none : start() rejects and the page shows the 2D map instead
   The numbers never come from here: a click only reports latitude and longitude, and the engines do the rest. */
(function () {
  const NAV = window.NAV, D2R = Math.PI / 180, R = 1737400;
  const CDN = 'https://cdn.jsdelivr.net/npm/cesium@1.147.0/Build/Cesium/', MOON_ASSET = 2684829;
  const COL = { site: '#EEEBE4', sel: '#FFD166', ice: '#8FC0FF', pole: '#E86A52', sun: '#FFD166', earth: '#6FAEFF' };

  function loadLib() {
    if (window.Cesium) return Promise.resolve();
    return new Promise((res, rej) => {
      window.CESIUM_BASE_URL = CDN;
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CDN + 'Widgets/widgets.css'; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = CDN + 'Cesium.js'; s.onload = res; s.onerror = () => rej(new Error('Cesium library did not load')); document.head.appendChild(s);
    });
  }
  const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

  function Globe(el, cb) {
    this.el = el; this.cb = cb; this.viewer = null; this.mode = null; this.starting = null;
    this.opts = { sun: true, shadows: false, fine: false, ice: true };
    this.siteEnts = []; this.iceEnts = []; this.rays = []; this.sel = null; this.tMs = Date.now();
  }

  Globe.prototype.start = function () {
    if (this.starting) return this.starting;
    return (this.starting = (async () => {
      await within(loadLib(), 30000, 'Cesium library');
      const C = window.Cesium, MOON = C.Ellipsoid.MOON; C.Ellipsoid.default = MOON;
      let tileset = null; const token = (window.CESIUM_ION_TOKEN || '').trim();
      if (token && !token.startsWith('PASTE')) {
        C.Ion.defaultAccessToken = token;
        try { tileset = await within(C.Cesium3DTileset.fromIonAssetId(MOON_ASSET, { maximumScreenSpaceError: 24, cacheBytes: 192 * 1024 * 1024, maximumCacheOverflowBytes: 64 * 1024 * 1024, dynamicScreenSpaceError: true, foveatedScreenSpaceError: true, preloadFlightDestinations: false }), 20000, 'Cesium Moon'); }
        catch (e) { console.warn('Cesium Moon tiles are not available, using the image map instead.', e); }
      }
      const common = { baseLayerPicker: false, geocoder: false, sceneModePicker: false, homeButton: false, navigationHelpButton: false, timeline: false, animation: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false, skyAtmosphere: false, requestRenderMode: true, maximumRenderTimeChange: Infinity, targetFrameRate: 30 };
      let viewer;
      if (tileset) { viewer = new C.Viewer(this.el, Object.assign({ globe: false, baseLayer: false }, common)); viewer.scene.primitives.add(tileset); }
      else {
        viewer = new C.Viewer(this.el, Object.assign({ globe: new C.Globe(MOON), baseLayer: C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl('img/moon_4k.jpg')) }, common));
        const g = viewer.scene.globe; g.enableLighting = true; g.showGroundAtmosphere = false; g.baseColor = C.Color.fromCssColorString('#3a3a38'); g.dynamicAtmosphereLighting = false;
        // If the surface never finishes drawing (blocked workers, no WebGL), give up so the page can show the 2D map.
        try {
          await new Promise((res, rej) => { let n = 0; const iv = setInterval(() => { viewer.scene.requestRender(); if (g.tilesLoaded) { clearInterval(iv); res(); } else if (++n > 50) { clearInterval(iv); rej(new Error('The Moon surface did not draw')); } }, 300); });
        } catch (e) { viewer.destroy(); this.el.textContent = ''; throw e; }
      }
      this.viewer = viewer; this.tileset = tileset; this.mode = tileset ? 'tiles' : 'lite'; this.C = C;
      const sc = viewer.scene;
      viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5) * (tileset ? 0.85 : 1);
      if (!sc.skyBox && C.SkyBox && C.SkyBox.createEarthSkyBox) sc.skyBox = C.SkyBox.createEarthSkyBox();
      if (sc.sun) sc.sun.show = false; if (sc.moon) sc.moon.show = false;
      sc.backgroundColor = C.Color.BLACK;
      this.light = new C.DirectionalLight({ direction: C.Cartesian3.clone(sc.camera.directionWC), intensity: tileset ? 2.2 : 2.6 });
      sc.light = this.light;
      sc.preRender.addEventListener((s) => { if (!this.opts.sun) this.light.direction = C.Cartesian3.clone(s.camera.directionWC, this.light.direction); });
      if (tileset) {
        tileset.loadProgress.addEventListener((p, q) => this.cb.onBusy(p + q > 0));
        tileset.allTilesLoaded.addEventListener(() => this.cb.onBusy(false));
      }
      // picking
      const handler = new C.ScreenSpaceEventHandler(sc.canvas); let mt = 0;
      handler.setInputAction((m) => { const pos = C.Cartesian2.clone(m.endPosition); clearTimeout(mt); mt = setTimeout(() => this.cb.onHover(this.pickLL(pos)), 120); }, C.ScreenSpaceEventType.MOUSE_MOVE);
      handler.setInputAction((m) => {
        const hit = sc.pick(m.position), id = hit && hit.id;
        if (id && id.navSite != null) return this.cb.onSite(id.navSite);
        if (id && id.navIce) return this.cb.onPick(id.navIce.lat, id.navIce.lon, NAV.iceName(id.navIce));
        const p = this.pickLL(m.position); if (p) this.cb.onPick(p.lat, p.lon);
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      viewer.camera.moveEnd.addEventListener(() => this.drawRays());
      this.setTime(this.tMs);
      this.cam('pole', 0);
      return this.mode;
    })());
  };

  Globe.prototype.pickLL = function (pos) {
    const C = this.C, v = this.viewer; let c3 = null;
    if (this.mode === 'tiles' && v.scene.pickPositionSupported) c3 = v.scene.pickPosition(pos);
    if (!C.defined(c3)) c3 = v.camera.pickEllipsoid(pos, C.Ellipsoid.MOON);
    if (!C.defined(c3)) return null;
    const c = C.Cartographic.fromCartesian(c3, C.Ellipsoid.MOON); if (!c) return null;
    return { lat: c.latitude / D2R, lon: c.longitude / D2R };
  };
  Globe.prototype.render = function () { if (this.viewer) this.viewer.scene.requestRender(); };
  Globe.prototype.resize = function () { if (this.viewer) { this.viewer.resize(); this.render(); } };
  Globe.prototype.pos = function (lat, lon, h) { return this.C.Cartesian3.fromDegrees(lon, lat, h, this.C.Ellipsoid.MOON); };

  Globe.prototype.point = function (lat, lon, h, name, color, size) {
    const C = this.C, col = C.Color.fromCssColorString(color), far = this.mode === 'tiles' ? 1.6e6 : 4e6;
    return this.viewer.entities.add({
      position: this.pos(lat, lon, h),
      point: { pixelSize: size, color: col, outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: name ? { text: name, font: '600 13px Archivo, "IBM Plex Sans Arabic", sans-serif', fillColor: col, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, translucencyByDistance: new C.NearFarScalar(far * 0.2, 1, far, 0) } : undefined,
    });
  };

  // sites: the list shown in the page; sel: index of the selected one
  Globe.prototype.setSites = function (sites, sel) {
    if (!this.viewer) return;
    const v = this.viewer; this.siteEnts.forEach((e) => v.entities.remove(e));
    if (!this.pole) this.pole = this.point(-90, 0, 3000, NAV.T('south_pole'), COL.pole, 7); else this.pole.label.text = NAV.T('south_pole');
    this.siteEnts = sites.map((s, i) => { const e = this.point(s.lat, s.lon, (s.h || 0) + 400, NAV.siteName(s), i === sel ? COL.sel : COL.site, i === sel ? 13 : 9); e.navSite = i; return e; });
    this.sel = sites[sel] || null; this.drawRays();
  };
  Globe.prototype.setIce = function (psr) {
    if (!this.viewer || !psr) return;
    this.iceEnts.forEach((e) => this.viewer.entities.remove(e));
    this.iceEnts = psr.filter((p) => p.m3 >= 5).map((p) => { const e = this.point(p.lat, p.lon, 3000, '', COL.ice, 6); e.navIce = p; e.show = this.opts.ice; return e; });
    this.render();
  };

  // Lines from the selected site toward the Sun (where a tracking panel faces) and the Earth (antenna).
  Globe.prototype.drawRays = function () {
    if (!this.viewer) return;
    const C = this.C, v = this.viewer; this.rays.forEach((e) => v.entities.remove(e)); this.rays = [];
    const s = this.sel; if (!s) { this.render(); return; }
    const a = NAV.at(s, (this.tMs - NAV.data.t0) / 3600e3);
    const f = s.lat * D2R, l = s.lon * D2R, cf = Math.cos(f), sf = Math.sin(f), cl = Math.cos(l), sl = Math.sin(l);
    const up = [cf * cl, cf * sl, sf], ea = [-sl, cl, 0], no = [-sf * cl, -sf * sl, cf], r0 = R + (s.h || 0) + 150;
    const p0 = new C.Cartesian3(up[0] * r0, up[1] * r0, up[2] * r0), len = Math.max(2500, Math.min(900000, C.Cartesian3.distance(v.camera.positionWC, p0) * 0.2));
    const ray = (az, color, on) => {
      const c = Math.cos(az * D2R), sn = Math.sin(az * D2R), d = [no[0] * c + ea[0] * sn, no[1] * c + ea[1] * sn, no[2] * c + ea[2] * sn];
      const p1 = new C.Cartesian3(p0.x + d[0] * len, p0.y + d[1] * len, p0.z + d[2] * len), col = C.Color.fromCssColorString(color).withAlpha(on ? 1 : 0.45);
      this.rays.push(v.entities.add({ polyline: { positions: [p0, p1], width: 9, arcType: C.ArcType.NONE, material: new C.PolylineArrowMaterialProperty(col), depthFailMaterial: new C.PolylineArrowMaterialProperty(col.withAlpha(0.5)) } }));
    };
    ray(a.earthAz, COL.earth, a.comm); ray(a.sunAz, COL.sun, a.lit > 0);
    this.render();
  };

  Globe.prototype.setTime = function (tMs) {
    this.tMs = tMs; if (!this.viewer) return;
    if (this.opts.sun) { const s = NAV.data.eph.at(tMs).sun; this.light.direction = new this.C.Cartesian3(-s[0], -s[1], -s[2]); }
    this.drawRays();
  };
  Globe.prototype.setOpt = function (k, on) {
    this.opts[k] = on; if (!this.viewer) return;
    const C = this.C, v = this.viewer, t = this.tileset;
    if (k === 'sun') this.setTime(this.tMs);
    if (k === 'ice') this.iceEnts.forEach((e) => (e.show = on));
    if (k === 'fine' && t) { t.maximumScreenSpaceError = on ? 8 : 24; v.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5) * (on ? 1 : 0.85); }
    if (k === 'shadows' && t) {
      try { v.shadows = on; t.shadows = on ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED;
        if (on && v.shadowMap) { v.shadowMap.softShadows = false; v.shadowMap.size = 2048; v.shadowMap.maximumDistance = 300000; v.shadowMap.darkness = 0.15; } } catch (e) { console.warn(e); }
    }
    this.render();
  };

  Globe.prototype.cam = function (name, dur) {
    if (!this.viewer) return;
    const C = this.C, cam = this.viewer.camera, d = dur == null ? 2 : dur; this.lastCam = name;
    const fly = (lon, lat, h, pitch, heading) => cam.flyTo({ destination: this.pos(lat, lon, h), orientation: { heading: (heading || 0) * D2R, pitch: pitch * D2R, roll: 0 }, duration: d });
    if (name === 'moon') fly(0, -25, 6200000, -90);
    else if (name === 'pole') { if (this.mode === 'tiles') fly(0, -80, 260000, -35, 180); else fly(0, -66, 1900000, -62, 180); }
    else if (name === 'top') fly(0, -90, this.mode === 'tiles' ? 240000 : 1100000, -90);
    else if (name === 'site' && this.sel) {
      const s = this.sel, range = this.mode === 'tiles' ? (s.flat ? 120000 : 26000) : 700000;
      cam.flyToBoundingSphere(new C.BoundingSphere(this.pos(s.lat, s.lon, s.h || 0), 1), { offset: new C.HeadingPitchRange(0, -38 * D2R, range), duration: d });
    }
  };

  NAV.Globe = Globe;
})();
