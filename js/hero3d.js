/*
 * Hero scene: photoreal Sun, Earth and Moon in WebGL (three.js r160).
 *  - Moon: LRO colour map (NASA) + LOLA relief as bump map.
 *  - Earth: NASA Blue Marble (day), Black Marble (city lights at night), ocean glint, atmosphere.
 *  - Sun: animated convection shader with limb darkening, corona streamers and bloom.
 * Exposes window.Hero3D = { mount(el), setActive(bool), focus('moon'|'earth'|'sun'), toggle(name, on), setTime(ms) }.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = window.__v || Date.now();

// ---------------------------------------------------------------- GLSL helpers
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.02; a*=0.5; } return s; }
`;

const SUN_VS = /* glsl */ `
varying vec3 vPos; varying vec3 vN; varying vec3 vView;
void main(){ vPos=position; vec4 wp=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vView=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`;
const SUN_FS = /* glsl */ `
uniform float uTime; varying vec3 vPos; varying vec3 vN; varying vec3 vView;
${NOISE}
void main(){
  vec3 p=normalize(vPos); float t=uTime;
  float cells=fbm(p*2.6+vec3(t*0.012,0.0,-t*0.01));
  float gran=snoise(p*42.0+vec3(0.0,t*0.09,t*0.05));
  float gran2=snoise(p*95.0-vec3(t*0.14));
  float v=0.50+0.42*cells+0.20*gran+0.08*gran2;
  float act=smoothstep(0.30,0.75,fbm(p*1.3+vec3(7.0)+t*0.004));            // bright active regions (faculae)
  float spot=smoothstep(0.72,0.80,fbm(p*2.1+vec3(13.0)+t*0.003));          // a few dark sunspots
  vec3 deep=vec3(0.50,0.07,0.0), mid=vec3(0.95,0.30,0.03), hot=vec3(1.0,0.56,0.13), white=vec3(1.0,0.80,0.42);
  vec3 col=mix(deep,mid,smoothstep(0.05,0.50,v)); col=mix(col,hot,smoothstep(0.50,0.82,v)); col=mix(col,white,smoothstep(0.90,1.12,v));
  col+=act*vec3(0.25,0.12,0.02);
  col*=1.0-0.75*spot;
  float mu=clamp(dot(normalize(vN),normalize(vView)),0.0,1.0);
  float limb=0.18+0.82*pow(mu,0.62);
  col*=limb; col=mix(col*vec3(1.0,0.45,0.18),col,smoothstep(0.0,0.55,mu));
  float rim=pow(1.0-mu,6.0);
  col+=vec3(1.0,0.35,0.08)*rim*0.6;
  gl_FragColor=vec4(col*1.0,1.0);
}`;
const CORONA_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv*2.0-1.0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const CORONA_FS = /* glsl */ `
uniform float uTime; uniform float uR; varying vec2 vUv;
${NOISE}
void main(){
  float r=length(vUv)/uR; if(r<0.98) discard;
  float a=atan(vUv.y,vUv.x);
  float d=max(r-1.0,0.0);
  float glow=exp(-d*3.2)*0.95+exp(-d*0.9)*0.22;
  float s=fbm(vec3(cos(a)*2.4,sin(a)*2.4,d*0.9-uTime*0.035));
  float streak=pow(max(0.0,0.5+0.5*s),3.0)*exp(-d*1.6)*1.3;
  vec3 col=vec3(1.0,0.42,0.10)*glow+vec3(1.0,0.60,0.25)*streak;
  float edge=smoothstep(0.98,1.03,r)*(1.0-smoothstep(0.55,1.0,length(vUv)));
  gl_FragColor=vec4(col*edge*0.8, 1.0);
}`;

const EARTH_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vView=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`;
const EARTH_FS = /* glsl */ `
uniform sampler2D uDay, uNight, uSpec; uniform vec3 uSun;
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
void main(){
  vec3 n=normalize(vN), v=normalize(vView), L=normalize(uSun);
  float ndl=dot(n,L);
  vec3 day=texture2D(uDay,vUv).rgb, night=texture2D(uNight,vUv).rgb;
  float dayAmt=smoothstep(-0.12,0.22,ndl);
  vec3 col=day*max(ndl,0.0)*1.35;
  col+=night*vec3(1.0,0.78,0.48)*(1.0-dayAmt)*1.6;
  float spec=texture2D(uSpec,vUv).r;
  vec3 h=normalize(L+v);
  col+=vec3(1.0,0.92,0.78)*pow(max(dot(n,h),0.0),60.0)*spec*0.9*smoothstep(0.0,0.2,ndl);
  float fres=pow(1.0-max(dot(n,v),0.0),2.6);
  col+=vec3(0.28,0.52,1.0)*fres*smoothstep(-0.25,0.5,ndl)*0.95;
  gl_FragColor=vec4(col,1.0);
}`;
const ATMO_FS = /* glsl */ `
uniform vec3 uSun; varying vec3 vN; varying vec3 vView;
void main(){
  vec3 n=normalize(vN), v=normalize(vView);
  float rim=pow(0.72-dot(n,v),3.2);
  float lit=smoothstep(-0.35,0.45,dot(n,normalize(uSun)));
  gl_FragColor=vec4(vec3(0.32,0.58,1.0)*rim*lit*2.2,1.0);
}`;
const SKY_VS = /* glsl */ `varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const SKY_FS = /* glsl */ `
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d=normalize(vDir);
  float n=fbm(d*1.6+vec3(3.0)); float m=fbm(d*3.4+vec3(11.0));
  vec3 base=vec3(0.035,0.028,0.045);
  vec3 purple=vec3(0.20,0.12,0.22), rose=vec3(0.26,0.14,0.18);
  float band=exp(-pow(d.y*1.6+d.x*0.5-0.15,2.0)*3.0);
  vec3 col=base+purple*smoothstep(-0.2,0.8,n)*0.55*band+rose*smoothstep(0.2,0.9,m)*0.18*band;
  gl_FragColor=vec4(col,1.0);
}`;

// ---------------------------------------------------------------- scene
class HeroScene {
  constructor(host) {
    this.host = host; this.active = true; this.t0 = performance.now(); this.toggles = { orbits: true, labels: true, pole: true, grid: false };
    const W = host.clientWidth || 1200, H = host.clientHeight || 700;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); r.setSize(W, H);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    host.appendChild(r.domElement); r.domElement.classList.add('hero-gl');
    const scene = this.scene = new THREE.Scene();
    const cam = this.camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 4000);
    this.loader = new THREE.TextureLoader();

    // sky dome + stars
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false })));
    const N = 5200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 1300;
      pos.set([R * s * Math.cos(th), R * u, R * s * Math.sin(th)], 3 * i);
      const k = rnd(), b = 0.35 + 0.65 * Math.pow(rnd(), 3);
      const c = k > 0.93 ? [1.0, 0.82, 0.62] : k > 0.85 ? [0.72, 0.8, 1.0] : [0.95, 0.93, 1.0];
      col.set(c.map((x) => x * b), 3 * i); size[i] = 0.6 + Math.pow(rnd(), 6) * 2.4;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(col, 3)); sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
    scene.add(new THREE.Points(sg, new THREE.ShaderMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC=color; gl_PointSize=size*1.6; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(vC*a,a); }',
    })));

    // bodies (cinematic composition after the reference: Earth, Moon, and a large Sun at the edge)
    this.layout();
    const sunDir = this.sunDir = new THREE.Vector3(this.L.sx, 0.18, 0.78).normalize();

    // Sun
    this.sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VS, fragmentShader: SUN_FS });
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(this.L.sunR, 96, 64), this.sunMat); this.sun.position.copy(this.L.sun); scene.add(this.sun);
    this.coronaMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uR: { value: 1 / 3.2 } }, vertexShader: CORONA_VS, fragmentShader: CORONA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(this.L.sunR * 6.4, this.L.sunR * 6.4), this.coronaMat); this.corona.position.copy(this.L.sun); scene.add(this.corona);

    // Moon
    const moonMap = this.loader.load('img/moon_2k.jpg?v=' + V); moonMap.colorSpace = THREE.SRGBColorSpace; moonMap.anisotropy = 8;
    const bump = this.loader.load('img/moon_bump.jpg?v=' + V);
    this.moonMat = new THREE.MeshStandardMaterial({ map: moonMap, bumpMap: bump, bumpScale: 2.2, roughness: 1, metalness: 0 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(this.L.moonR, 160, 120), this.moonMat);
    this.moon.position.copy(this.L.moon); this.moon.rotation.order = 'XYZ'; this.moon.rotation.set(-0.42, -Math.PI / 2, 0.04); scene.add(this.moon);
    // study region: south polar cap (84 deg S) and the pole
    const ring = []; const cr = Math.cos(84 * Math.PI / 180) * this.L.moonR * 1.003, cy = -Math.sin(84 * Math.PI / 180) * this.L.moonR * 1.003;
    for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * cr, cy, Math.sin(a) * cr)); }
    this.poleRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0xf0c87a, transparent: true, opacity: 0.95 }));
    this.moon.add(this.poleRing);
    // lat/lon grid
    const gpts = [];
    for (let lat = -60; lat <= 60; lat += 30) { const rr = Math.cos(lat * Math.PI / 180) * this.L.moonR * 1.002, yy = Math.sin(lat * Math.PI / 180) * this.L.moonR * 1.002; for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2; gpts.push(new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr), new THREE.Vector3(Math.cos(b) * rr, yy, Math.sin(b) * rr)); } }
    for (let lon = 0; lon < 360; lon += 30) { for (let i = 0; i < 48; i++) { const p1 = (i / 48) * Math.PI - Math.PI / 2, p2 = ((i + 1) / 48) * Math.PI - Math.PI / 2, a = lon * Math.PI / 180; const f = (p) => new THREE.Vector3(Math.cos(p) * Math.cos(a), Math.sin(p), Math.cos(p) * Math.sin(a)).multiplyScalar(this.L.moonR * 1.002); gpts.push(f(p1), f(p2)); } }
    this.grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gpts), new THREE.LineBasicMaterial({ color: 0xc2b8c8, transparent: true, opacity: 0.18 }));
    this.grid.visible = false; this.moon.add(this.grid);

    // Earth
    const tex = (f, srgb) => { const t = this.loader.load('img/' + f + '?v=' + V); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    this.earthMat = new THREE.ShaderMaterial({ uniforms: { uDay: { value: tex('earth_day.jpg', true) }, uNight: { value: tex('earth_night.jpg', true) }, uSpec: { value: tex('earth_spec.jpg') }, uSun: { value: sunDir.clone() } }, vertexShader: EARTH_VS, fragmentShader: EARTH_FS });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(this.L.earthR, 128, 96), this.earthMat);
    this.earth.position.copy(this.L.earth); this.earth.rotation.set(0.41, 2.2, 0); scene.add(this.earth);
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(this.L.earthR * 1.035, 96, 64), new THREE.ShaderMaterial({ uniforms: { uSun: { value: sunDir.clone() } }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.atmo.position.copy(this.L.earth); scene.add(this.atmo);

    // light for the Moon (from the Sun side, slightly toward the viewer: a waxing gibbous look)
    this.key = new THREE.DirectionalLight(0xfff4e6, 3.1); this.key.position.copy(sunDir).multiplyScalar(100); scene.add(this.key);
    scene.add(new THREE.AmbientLight(0x6b4d6f, 0.06));

    // orbits: Moon around Earth, Earth around the Sun
    this.orbits = new THREE.Group(); scene.add(this.orbits);
    const orbit = (c, through, tiltHint, color, op) => {
      const u = through.clone().sub(c); const rad = u.length(); u.normalize();
      let n = tiltHint.clone().normalize(); n.sub(u.clone().multiplyScalar(n.dot(u))).normalize(); const v = new THREE.Vector3().crossVectors(n, u);
      const pts = []; for (let i = 0; i <= 360; i++) { const a = i * Math.PI / 180; pts.push(c.clone().add(u.clone().multiplyScalar(Math.cos(a) * rad)).add(v.clone().multiplyScalar(Math.sin(a) * rad))); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      this.orbits.add(line); return line;
    };
    orbit(this.L.earth, this.L.moon, new THREE.Vector3(0.1, 1, 0.42), 0xd6a451, 0.4);
    orbit(this.L.sun, this.L.earth, new THREE.Vector3(0.05, 1, 0.55), 0xc2b8c8, 0.18);

    // post-processing
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // camera views
    this.views = {
      moon: { pos: new THREE.Vector3(0, 1.2, 62), look: new THREE.Vector3(0, 0, 0) },
    };
    this.camPos = this.views.moon.pos.clone(); this.camLook = this.views.moon.look.clone();
    this.goPos = this.camPos.clone(); this.goLook = this.camLook.clone();
    this.target = 'all'; this.resize(); this.camPos.copy(this.goPos); this.camLook.copy(this.goLook);
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);

    // 4K Moon once the page is idle
    setTimeout(() => { const m4 = this.loader.load('img/moon_4k.jpg?v=' + V, () => { this.moonMat.map = m4; this.moonMat.needsUpdate = true; }); m4.colorSpace = THREE.SRGBColorSpace; m4.anisotropy = 8; }, 2500);

    // subtle parallax with the pointer
    this.par = new THREE.Vector2(); this.parT = new THREE.Vector2();
    host.addEventListener('pointermove', (e) => { const b = host.getBoundingClientRect(); this.parT.set((e.clientX - b.left) / b.width - 0.5, (e.clientY - b.top) / b.height - 0.5); });
    window.addEventListener('resize', () => this.resize());
    this.labels = {};
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
  }
  layout() {
    // world units: Moon at origin. Sun at the left in RTL (mirrored composition of the reference).
    const rtl = document.documentElement.dir === 'rtl';
    const sx = rtl ? -1 : 1;
    this.L = {
      moon: new THREE.Vector3(-3.5 * sx, -0.6, 0), moonR: 9.2,
      earth: new THREE.Vector3(13.5 * sx, 8.2, -7), earthR: 3.3,
      sun: new THREE.Vector3(54 * sx, 9, -36), sunR: 15,
      sx,
    };
  }
  resize() {
    const W = this.host.clientWidth, H = this.host.clientHeight; if (!W || !H) return;
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H); this.composer.setSize(W, H);
    // narrow screens: step back so everything fits
    const narrow = W / H < 1.1, k = narrow ? 1.9 : W / H < 1.5 ? 1.25 : 1;
    if (narrow) { this.views.moon.pos.set(this.L.moon.x, 9, 62 * k); this.views.moon.look.set(this.L.moon.x, 9, 0); }
    else { this.views.moon.pos.set(0, 1.2, 62 * k); this.views.moon.look.set(0, 0, 0); }
    if (this.target === 'all') { this.goPos.copy(this.views.moon.pos); this.goLook.copy(this.views.moon.look); }
  }
  focus(name) {
    this.target = name;
    const b = name === 'earth' ? this.earth : name === 'sun' ? this.sun : name === 'moon' ? this.moon : null;
    if (!b) { this.goPos.copy(this.views.moon.pos); this.goLook.copy(this.views.moon.look); return; }
    const R = b.geometry.parameters.radius, d = R * (name === 'sun' ? 4.6 : 3.6);
    const dir = this.views.moon.pos.clone().sub(b.position).normalize();
    if (name === 'earth') dir.set(0.35, 0.12, 1).normalize();
    if (name === 'sun') dir.set(-0.55, 0.1, 1).normalize();
    this.goPos.copy(b.position).add(dir.multiplyScalar(d)); this.goLook.copy(b.position);
  }
  toggle(name, on) {
    this.toggles[name] = on;
    if (name === 'orbits') this.orbits.visible = on;
    if (name === 'pole') this.poleRing.visible = on;
    if (name === 'grid') this.grid.visible = on;
  }
  setActive(on) { const was = this.active; this.active = on; if (on && !was) requestAnimationFrame(this.loop); }
  project(obj, dy) {
    const v = obj.position.clone(); v.y += dy; v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight, vis: v.z < 1 };
  }
  loop(now) {
    if (!this.active) return;
    if (document.hidden) { requestAnimationFrame(this.loop); return; }
    const t = (now - this.t0) / 1000;
    this.sunMat.uniforms.uTime.value = t; this.coronaMat.uniforms.uTime.value = t;
    this.corona.quaternion.copy(this.camera.quaternion);
    this.earth.rotation.y = 2.2 + t * 0.045;
    this.moon.rotation.y = -Math.PI / 2 + Math.sin(t * 0.05) * 0.12;   // gentle libration
    this.par.lerp(this.parT, 0.04);
    this.camPos.lerp(this.goPos, 0.045); this.camLook.lerp(this.goLook, 0.05);
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(this.par.x * 2.2, -this.par.y * 1.4, 0));
    this.camera.lookAt(this.camLook);
    this.composer.render();
    if (this.onFrame) this.onFrame(this);
    requestAnimationFrame(this.loop);
  }
}

let inst = null;
window.Hero3D = {
  mount(el) {
    try { inst = new HeroScene(el); window.Hero3D.scene = inst; return inst; } catch (e) { console.warn('WebGL hero failed', e); return null; }
  },
  setActive(on) { if (inst) inst.setActive(on); },
  focus(n) { if (inst) inst.focus(n); },
  toggle(n, on) { if (inst) inst.toggle(n, on); },
};
window.dispatchEvent(new Event('hero3d-ready'));
