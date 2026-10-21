/* Domso — eight transparent glass vessels with real blood physics, one per day.
   Liquid: damped wave equation on a disc + sloshing mode; the surface and the side walls of the
   blood are rebuilt every frame so they always hug the glass. Over the goal it spills and pools. */
import * as THREE from 'three';

const V2 = (r, y) => new THREE.Vector2(Math.max(0, r), y);
function smooth(pts, n = 160) {
  const c = new THREE.CatmullRomCurve3(pts.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal', .3);
  return c.getPoints(n).map(p => V2(p.x, p.y));
}
function profR(prof, y) { let best = 0;
  for (let i = 0; i < prof.length - 1; i++) { const a = prof[i], b = prof[i + 1];
    if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y) && a.y !== b.y) best = Math.max(best, a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)); }
  return best; }

/* ---------- the eight vessels ---------- */
const SPHERE = (() => { const o = []; for (let k = 0; k <= 40; k++) { const a = -Math.PI / 2 + k / 40 * Math.PI; o.push([Math.cos(a) * .82, .1 + Math.sin(a) * .82]); } return o; })();
export const DESIGNS = [
  { id: 1, name: 'Crystal Goblet', outer: [[.62,-1.2],[.62,-1.17],[.1,-1.14],[.06,-1.0],[.05,-.2],[.12,-.05],[.42,.1],[.6,.4],[.64,.75],[.58,1.1],[.56,1.12]],
    inner: [[0,-.02],[.38,.12],[.57,.42],[.61,.75],[.55,1.08]], yMin: -.0, yMax: 1.0, spill: 1.11, pool: -1.2, baseR: .62 },
  { id: 2, name: 'Sanguis Bottle', outer: [[0,-1.15],[.56,-1.15],[.62,-1.05],[.64,-.5],[.62,.15],[.45,.45],[.2,.62],[.17,.75],[.17,.98],[.22,1.02],[.22,1.06],[.15,1.08]],
    inner: [[0,-1.1],[.58,-1.05],[.6,-.5],[.58,.13],[.42,.42],[.16,.62],[.13,.75],[.13,1.0]], yMin: -1.08, yMax: .55, spill: 1.0, pool: -1.15, baseR: .64, extras: 'bottle' },
  { id: 3, name: 'Blood Hourglass', outer: [[0,-1.05],[.5,-1.05],[.62,-.75],[.55,-.35],[.25,-.12],[.06,0],[.25,.12],[.55,.35],[.62,.75],[.5,1.05],[0,1.05]],
    inner: [[0,-1.0],[.46,-1.0],[.58,-.75],[.51,-.35],[.22,-.12],[.04,0],[.22,.12],[.51,.35],[.58,.75],[.46,1.0],[0,1.0]], yMin: -1.0, yMax: -.1, spill: null, pool: -1.17, baseR: .82, extras: 'hourglass' },
  { id: 4, name: "Alchemist's Flask", outer: [[0,-1.15],[.45,-1.07],[.72,-.75],[.78,-.35],[.7,.02],[.42,.28],[.16,.4],[.14,.6],[.14,1.05],[.19,1.1],[.19,1.14],[.12,1.15]],
    inner: [[0,-1.1],[.42,-1.03],[.68,-.75],[.74,-.35],[.66,.0],[.39,.26],[.11,.4],[.1,.6],[.1,1.05]], yMin: -1.08, yMax: .3, spill: 1.13, pool: -1.34, baseR: .66, extras: 'flask' },
  { id: 6, name: 'Cut Decanter', outer: [[0,-1.15],[.66,-1.15],[.72,-1.0],[.7,-.4],[.55,.05],[.25,.35],[.15,.55],[.14,.85],[.22,.92],[.22,.96]],
    inner: [[0,-1.08],[.64,-1.0],[.65,-.4],[.51,.03],[.22,.33],[.11,.55],[.1,.9]], yMin: -1.06, yMax: .28, spill: .95, pool: -1.15, baseR: .72, segs: 14, extras: 'decanter' },
  { id: 7, name: 'The Blood Drop', outer: [[0,-1.05],[.35,-.98],[.62,-.72],[.7,-.35],[.6,.05],[.38,.45],[.18,.8],[.05,1.1],[0,1.2]],
    inner: [[0,-1.0],[.32,-.94],[.58,-.7],[.66,-.35],[.56,.05],[.34,.44],[.15,.78],[.03,1.05]], yMin: -.98, yMax: .75, spill: 1.15, pool: -1.2, baseR: .55, extras: 'drop' },
  { id: 8, name: 'Crystal Ball', outer: SPHERE, inner: SPHERE.map(([r, y]) => [r * .96, .1 + (y - .1) * .96]), yMin: -.66, yMax: .82, spill: .9, pool: -1.26, baseR: .55, extras: 'ball' },
  { id: 9, name: 'The Test Tube', outer: [[0,-1.15],[.2,-1.1],[.27,-.95],[.27,1.0],[.31,1.04],[.31,1.08]],
    inner: [[0,-1.1],[.17,-1.06],[.23,-.95],[.23,1.0]], yMin: -1.08, yMax: .85, spill: 1.0, pool: -1.2, baseR: .3, extras: 'tube' },
];

/* ---------- liquid simulation on a unit disc ---------- */
class Ripples {
  constructor(n = 48) {
    this.n = n; this.h = new Float32Array(n * n); this.v = new Float32Array(n * n); this.m = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, z = j / (n - 1) * 2 - 1; this.m[j * n + i] = x * x + z * z <= 1 ? 1 : 0; }
    this.slope = 0; this.slopeV = 0; this.slopeZ = 0; this.slopeZV = 0;
  }
  impulse(x, z, amp, rad = .12) { const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; if (!this.m[k]) continue;
      const dx = i / (n - 1) * 2 - 1 - x, dz = j / (n - 1) * 2 - 1 - z, d2 = dx * dx + dz * dz; if (d2 < rad * rad * 9) this.v[k] += amp * Math.exp(-d2 / (rad * rad)); } }
  step(target) {
    const n = this.n, h = this.h, v = this.v, m = this.m;
    const a = (target - this.slope) * .055; this.slopeV += a; this.slopeV *= .965; this.slope += this.slopeV;
    const az = -this.slopeZ * .05; this.slopeZV += az; this.slopeZV *= .96; this.slopeZ += this.slopeZV;
    this.slope = Math.max(-.13, Math.min(.13, this.slope)); this.slopeZ = Math.max(-.1, Math.min(.1, this.slopeZ));
    const pump = Math.max(-.01, Math.min(.01, a * 1.2)), pumpZ = Math.max(-.01, Math.min(.01, az));
    for (let s = 0; s < 2; s++) {
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i; if (!m[k]) continue; const c = h[k];
        v[k] += ((m[k - 1] ? h[k - 1] : c) + (m[k + 1] ? h[k + 1] : c) + (m[k - n] ? h[k - n] : c) + (m[k + n] ? h[k + n] : c) - 4 * c) * .42; }
      for (let k = 0; k < n * n; k++) { if (!m[k]) continue; v[k] = Math.max(-.025, Math.min(.025, v[k] * .99)); h[k] = Math.max(-.06, Math.min(.06, (h[k] + v[k] * .5) * .9992)); }
    }
    if (Math.abs(pump) + Math.abs(pumpZ) > 1e-4) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; if (!m[k]) continue;
      const x = i / (n - 1) * 2 - 1, z = j / (n - 1) * 2 - 1; v[k] -= (pump * x + pumpZ * z) * (x * x + z * z) * .6; }
  }
  sample(x, z) { const n = this.n, fx = (x + 1) / 2 * (n - 1), fz = (z + 1) / 2 * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz))), tx = fx - i, tz = fz - j, h = this.h;
    return (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - tz) + (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * tz; }
}

export class VesselEngine {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'skull3d';
    this.level = 0; this.target = 0; this.angle = 0; this.excess = 0; this.ready = false;
    this.drops = []; this.crown = []; this.streams = []; this.falls = []; this.nextIdle = 0;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5)); r.toneMapping = THREE.NeutralToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(27, 1, .1, 50); this.camera.position.set(0, 1.35, 6.3); this.camera.lookAt(0, .02, 0);
    this._env(); this._materials();
    this.sim = new Ripples(48);
    this.setDesign(window.VESSEL_DESIGN || DESIGNS[0].id);
    this.ready = true; this._loop();
    this.canvas.addEventListener('pointerdown', e => this._poke(e, 1));
    this.canvas.addEventListener('pointermove', e => { if (e.buttons || e.pressure) this._poke(e, .3); });
  }
  _env() {
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene(); env.background = new THREE.Color(0x020101);
    const panel = (w, h, rgb, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.material.color.setRGB(...rgb); m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
    panel(3.2, 2.2, [6, 5.7, 5.4], [-3, 4.5, 4]); panel(.9, 5, [2.4, 2.3, 2.2], [4.5, 1, 2.5]); panel(3, 4, [3, .2, .25], [2.5, 1, -5]); panel(3.4, 1.2, [2.6, 2.5, 2.4], [0, 4.4, -3.2]); panel(7, 1.3, [.14, .09, .05], [0, -4.5, 1.5]);
    this.scene.environment = pm.fromScene(env, .02).texture;
    const key = new THREE.DirectionalLight(0xffe6d6, 1.6); key.position.set(-2, 5, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3040, 2.2); rim.position.set(3, 1.5, -4); this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x3a2224, .8));
    this.glow = new THREE.PointLight(0xff1a24, 0, 3, 1.5); this.scene.add(this.glow);
  }
  _materials() {
    // real pooled blood: near-black crimson in depth, wet and glossy
    this.blood = new THREE.MeshPhysicalMaterial({ color: 0x5c0007, emissive: 0x220002, roughness: .06, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.35, side: THREE.DoubleSide });
    this.bloodSurf = this.blood.clone(); this.bloodSurf.vertexColors = true; this.bloodSurf.color.set(0xffffff); this.bloodSurf.emissive.set(0x1a0002);
    this.spec = side => new THREE.MeshPhysicalMaterial({ color: 0, roughness: .03, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: side === THREE.FrontSide ? 1.5 : .6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side });
    this.body = new THREE.MeshStandardMaterial({ color: 0x9a9094, transparent: true, opacity: .08, roughness: .2, depthWrite: false });
    this.rimM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 n; varying vec3 v; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); n=normalize(normalMatrix*normal); v=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 n; varying vec3 v; void main(){ float f=pow(1.-abs(dot(normalize(n),normalize(v))),3.); gl_FragColor=vec4(vec3(1.,.86,.88)*f*.55,1.); }` });
    this.gold = new THREE.MeshPhysicalMaterial({ color: 0xc89b52, metalness: 1, roughness: .25, envMapIntensity: 1.6 });
    this.iron = new THREE.MeshPhysicalMaterial({ color: 0x2a2224, metalness: .9, roughness: .35, envMapIntensity: 1.2 });
    this.wood = new THREE.MeshStandardMaterial({ color: 0x3a1f12, roughness: .6 });
    this.cork = new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: .85 });
    this.wax = new THREE.MeshPhysicalMaterial({ color: 0x7a0610, roughness: .3, clearcoat: .6 });
    this.dropGeo = new THREE.SphereGeometry(.045, 18, 12);
  }

  /* ---------- build a vessel ---------- */
  setDesign(id) {
    const D = DESIGNS.find(d => d.id === +id) || DESIGNS[0];
    if (this.D && this.D.id === D.id) return;
    if (this.g) { this.scene.remove(this.g); this.g.traverse(o => o.geometry && o.geometry.dispose()); }
    this.streams = []; this.falls = []; this.drops = []; this.crown = []; this.pool = null;
    this.D = D; const g = this.g = new THREE.Group(); g.rotation.y = -.25; this.scene.add(g);
    this.outer = smooth(D.outer); this.inner = smooth(D.inner);
    // radius lookup table: O(1) per vertex per frame
    const ys = this.inner.map(p => p.y); this.lutMin = Math.min(...ys); this.lutMax = Math.max(...ys); const N = 1024; this.lut = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) this.lut[i] = profR(this.inner, this.lutMin + (this.lutMax - this.lutMin) * i / N);
    this.inR = y => { const f = (y - this.lutMin) / (this.lutMax - this.lutMin) * 1024; if (f <= 0) return this.lut[0]; if (f >= 1024) return this.lut[1024]; const i = f | 0, t = f - i; return this.lut[i] * (1 - t) + this.lut[i + 1] * t; };
    const glass = geo => [this.spec(THREE.BackSide), this.body, this.spec(THREE.FrontSide), this.rimM].forEach((m, i) => { const me = new THREE.Mesh(geo, m); me.renderOrder = 9 + i * .1; g.add(me); });
    glass(new THREE.LatheGeometry(this.outer, D.segs || 96));
    // liquid: surface (polar grid) + side wall (strip) + bottom cap
    const NR = 22, NS = 64, K = 26; this.NR = NR; this.NS = NS; this.K = K;
    const sp = [], su = [], sc = [], si = [];
    for (let i = 0; i <= NR; i++) for (let j = 0; j < NS; j++) { const t = i / NR, a = j / NS * Math.PI * 2; sp.push(0, 0, 0); su.push(t * Math.cos(a), t * Math.sin(a));
      const e = Math.pow(t, 6), c = new THREE.Color().setRGB(.2 + .2 * e, .006 + .008 * e, .008 + .008 * e, THREE.SRGBColorSpace); sc.push(c.r, c.g, c.b); }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) { const a = i * NS + j, b = i * NS + (j + 1) % NS, c = (i + 1) * NS + j, d = (i + 1) * NS + (j + 1) % NS; si.push(a, b, c, b, d, c); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(sp.length).fill(0), 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); sg.setIndex(si);
    this.surf = new THREE.Mesh(sg, this.bloodSurf); this.surf.renderOrder = 2; g.add(this.surf);
    const wp = new Float32Array((K + 1) * NS * 3), wi = [];
    for (let k = 0; k < K; k++) for (let j = 0; j < NS; j++) { const a = k * NS + j, b = k * NS + (j + 1) % NS, c = (k + 1) * NS + j, d = (k + 1) * NS + (j + 1) % NS; wi.push(a, c, b, b, c, d); }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3)); wg.setIndex(wi);
    this.wall = new THREE.Mesh(wg, this.blood); this.wall.renderOrder = 1; g.add(this.wall);
    const br = profR(this.inner, D.yMin + .002);
    this.cap = new THREE.Mesh(new THREE.CircleGeometry(Math.max(.001, br - .006), 64), this.blood); this.cap.rotation.x = Math.PI / 2; this.cap.position.y = D.yMin + .002; this.cap.visible = br > .03; g.add(this.cap);
    if (D.extras === 'hourglass') this._hourglass(g);
    this._extras(D.extras, g);
    this.level = Math.min(this.level, 1);
  }
  _extras(kind, g) {
    const M = (geo, mat, p) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); g.add(m); return m; };
    if (kind === 'bottle') {
      M(new THREE.CylinderGeometry(.15, .13, .32, 32), this.cork, [0, 1.1, 0]);
      const w = M(new THREE.SphereGeometry(.2, 32, 16, 0, 6.3, 0, 1.5), this.wax, [0, 1.17, 0]); w.scale.y = .6;
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const x = cv.getContext('2d');
      x.fillStyle = '#e8dcbc'; x.fillRect(0, 0, 512, 256); x.strokeStyle = '#5a2a1a'; x.lineWidth = 6; x.strokeRect(14, 14, 484, 228);
      x.fillStyle = '#4a0a10'; x.font = 'bold 72px Georgia'; x.textAlign = 'center'; x.fillText('SANGUIS', 256, 128); x.font = 'italic 34px Georgia'; x.fillText('No. XIII · her elixir', 256, 190);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const lab = M(new THREE.CylinderGeometry(.655, .655, .5, 64, 1, true, -.8, 1.6), new THREE.MeshStandardMaterial({ map: t, roughness: .9 }), [0, -.45, 0]); lab.rotation.y = Math.PI / 2; lab.renderOrder = 12;
    } else if (kind === 'hourglass') {
      for (const y of [-1.12, 1.12]) { M(new THREE.CylinderGeometry(.82, .82, .1, 6), this.wood, [0, y, 0]);
        const t = M(new THREE.TorusGeometry(.8, .025, 8, 6), this.gold, [0, y + (y > 0 ? .05 : -.05), 0]); t.rotation.x = Math.PI / 2; t.rotation.z = Math.PI / 6; }
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + .5, x = Math.cos(a) * .72, z = Math.sin(a) * .72; M(new THREE.CylinderGeometry(.04, .04, 2.2, 16), this.gold, [x, 0, z]);
        for (const y of [-.6, 0, .6]) M(new THREE.SphereGeometry(.065, 16, 12), this.gold, [x, y, z]); }
    } else if (kind === 'flask') {
      const ring = M(new THREE.TorusGeometry(.6, .035, 10, 48), this.iron, [0, -.8, 0]); ring.rotation.x = Math.PI / 2;
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + .3; M(new THREE.CylinderGeometry(.03, .03, .55, 10), this.iron, [Math.cos(a) * .62, -1.07, Math.sin(a) * .62]); }
    } else if (kind === 'decanter') {
      M(new THREE.IcosahedronGeometry(.26, 1), this.spec(THREE.FrontSide), [0, 1.22, 0]).renderOrder = 11; M(new THREE.IcosahedronGeometry(.26, 1), this.rimM, [0, 1.22, 0]).renderOrder = 11.1;
    } else if (kind === 'drop') {
      const c = M(new THREE.TorusGeometry(.38, .06, 16, 64), this.gold, [0, -1.0, 0]); c.rotation.x = Math.PI / 2;
      M(new THREE.CylinderGeometry(.45, .55, .14, 48), this.gold, [0, -1.13, 0]);
    } else if (kind === 'ball') {
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + .4; const c = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * .3, -1.15, Math.sin(a) * .3), new THREE.Vector3(Math.cos(a) * .7, -.9, Math.sin(a) * .7), new THREE.Vector3(Math.cos(a) * .84, -.45, Math.sin(a) * .84), new THREE.Vector3(Math.cos(a) * .7, -.2, Math.sin(a) * .7)]);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 40, .05, 10), this.iron)); }
      M(new THREE.CylinderGeometry(.42, .55, .16, 48), this.iron, [0, -1.18, 0]);
    } else if (kind === 'tube') {
      M(new THREE.CylinderGeometry(.24, .21, .3, 32), this.cork, [0, 1.15, 0]);
      M(new THREE.CylinderGeometry(.035, .035, 2.5, 16), this.gold, [-.75, -.05, -.2]); M(new THREE.BoxGeometry(1.3, .1, .7), this.wood, [-.3, -1.25, -.05]);
      for (const y of [-.4, .6]) { M(new THREE.BoxGeometry(.5, .06, .08), this.gold, [-.5, y, -.1]); const cl = M(new THREE.TorusGeometry(.29, .035, 8, 32), this.gold, [0, y, 0]); cl.rotation.x = Math.PI / 2; }
    }
  }
  _hourglass(g) { // the upper chamber drains as the lower one fills; a thin thread of blood joins them
    this.topLiq = new THREE.Mesh(new THREE.BufferGeometry(), this.blood); this.topLiq.renderOrder = 1; g.add(this.topLiq);
    this.thread = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, 1, 8), this.blood); g.add(this.thread); this._topFor = -1;
  }
  _topSolid(frac) {
    const y0 = .03, y1 = y0 + .02 + .7 * frac, pts = [V2(0, y0)];
    for (let i = 0; i <= 40; i++) { const y = y0 + (y1 - y0) * i / 40; pts.push(V2(profR(this.inner, y) - .006, y)); } pts.push(V2(0, y1));
    this.topLiq.geometry.dispose(); this.topLiq.geometry = new THREE.LatheGeometry(pts, 64);
  }

  /* ---------- public API ---------- */
  mount(host) { if (this.canvas.parentNode !== host) host.appendChild(this.canvas); this._resize(); }
  _resize() { const p = this.canvas.parentNode; if (!p) return; const w = p.clientWidth || 260, h = Math.round(w * 1.12);
    if (this._w !== w) { this._w = w; this.renderer.setSize(w, h, true); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); } }
  setLevel(p) { this.target = Math.max(0, Math.min(1, p)); }
  setAngle(d) { this.angle = d; }
  jolt(x, z) { this.sim.slopeV += Math.max(-.03, Math.min(.03, x)); this.sim.slopeZV += Math.max(-.03, Math.min(.03, z)); }
  setOverflow(l) { this.excess = Math.max(0, l || 0); }
  drip() { const top = (this.D.spill || 1.1) + .9; const d = new THREE.Mesh(this.dropGeo, this.blood); d.position.set(0, top, 0); this.g.add(d); this.drops.push({ m: d, vy: 0 }); this.holdUntil = performance.now() + 700; }
  _surfaceY() { const D = this.D, full = this.excess > 0 && D.spill ? Math.min(D.yMax + (D.spill - D.yMax) * .6, D.spill - .06) : D.yMax; return D.yMin + (full - D.yMin) * this.level; }
  _poke(e, amp) {
    if (this.level < .02) return; const r = this.canvas.getBoundingClientRect(), nd = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(nd, this.camera); const y = this._surfaceY(), hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) { this.jolt((Math.random() - .5) * .03, .01); return; }
    const R = profR(this.inner, y); const x = hit.x / R, z = hit.z / R; if (x * x + z * z < .95) this.sim.impulse(x, z, -.05 * amp, .12); else this.jolt(x * .01, .01);
  }

  /* ---------- per-frame ---------- */
  _loop() {
    let last = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.canvas.isConnected || document.hidden || this.canvas.offsetParent === null) return;   // hidden tab: no work
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; const D = this.D, sim = this.sim;
      if (!this.holdUntil || now > this.holdUntil) this.level += (this.target - this.level) * .045;
      const y = this._surfaceY(), R = this.inR(y) - .006, has = this.level > .004;
      const tgt = Math.max(-.11, Math.min(.11, Math.tan(THREE.MathUtils.degToRad(this.angle)) * R * .45)) * Math.min(1, R / .4);
      sim.step(tgt);
      if (has && now > this.nextIdle) { this.nextIdle = now + 1800 + Math.random() * 2600; const a = Math.random() * 6.28, rr = Math.random() * .6; sim.impulse(Math.cos(a) * rr, Math.sin(a) * rr, -.006 - Math.random() * .006, .14); }
      // surface: each vertex hugs the glass at its own height
      const pos = this.surf.geometry.attributes.position, nor = this.surf.geometry.attributes.normal, uv = this.surf.geometry.attributes.uv;
      const sl = sim.slope, slz = sim.slopeZ, e = .02, top = (D.spill || D.yMax) - .02, NS = this.NS, NR = this.NR, edge = new Float32Array(NS);
      const scale = Math.min(1, R / .5);                             // narrow necks ripple less
      for (let k = 0; k < pos.count; k++) {
        const u = uv.getX(k), v = uv.getY(k);
        const yy = Math.max(D.yMin + .004, Math.min(top, y + (sim.sample(u, v) + sl * u + slz * v) * scale));
        const rv = Math.max(.002, this.inR(yy) - .006); pos.setXYZ(k, u * rv, yy, v * rv);
        if (k >= NR * NS) edge[k - NR * NS] = yy;
        const hx = (sim.sample(Math.min(1, u + e), v) - sim.sample(Math.max(-1, u - e), v)) / (2 * e * Math.max(R, .1)) * scale + sl / Math.max(R, .1);
        const hz = (sim.sample(u, Math.min(1, v + e)) - sim.sample(u, Math.max(-1, v - e))) / (2 * e * Math.max(R, .1)) * scale;
        const l = Math.hypot(hx, 1, hz); nor.setXYZ(k, -hx / l, 1 / l, -hz / l);
      }
      pos.needsUpdate = true; nor.needsUpdate = true; this.surf.geometry.computeBoundingSphere();
      // side wall of the blood, from the bottom up to the moving surface edge
      const wp = this.wall.geometry.attributes.position, K = this.K, yb = D.yMin + .002;
      for (let kk = 0; kk <= K; kk++) for (let j = 0; j < NS; j++) { const a = j / NS * Math.PI * 2, yk = yb + (edge[j] - yb) * kk / K, rk = Math.max(.002, this.inR(yk) - .006);
        wp.setXYZ(kk * NS + j, Math.cos(a) * rk, yk, Math.sin(a) * rk); }
      wp.needsUpdate = true; this.wall.geometry.computeVertexNormals(); this.wall.geometry.computeBoundingSphere();
      this.surf.visible = this.wall.visible = has; this.cap.visible = has && this.inR(D.yMin + .002) > .03;
      this.glow.intensity = has ? 2 + 2 * this.level : 0; this.glow.position.set(0, (D.yMin + y) / 2, .3);
      if (this.topLiq) { const f = this.excess > 0 ? 1 : Math.max(0, 1 - this.level); if (Math.abs(f - this._topFor) > .004) { this._topFor = f; this._topSolid(f); }
        this.topLiq.visible = f > .01; const yt = .03; this.thread.visible = f > .01 && has; this.thread.scale.y = Math.max(.01, yt - y); this.thread.position.y = (yt + y) / 2; }
      // drops in, splash crown out
      for (let i = this.drops.length - 1; i >= 0; i--) { const d = this.drops[i]; d.vy -= 9.8 * dt * .55; d.m.position.y += d.vy * dt; d.m.scale.set(1, 1 + Math.min(.8, -d.vy * .15), 1);
        if (d.m.position.y <= y) { this.g.remove(d.m); this.drops.splice(i, 1); sim.impulse(0, 0, -.1, .14);
          const sp = Math.min(1, R / .5); for (let c = 0; c < 8; c++) { const a = c / 8 * 6.28 + Math.random() * .4, s = (.25 + Math.random() * .3) * sp, m = new THREE.Mesh(this.dropGeo, this.blood); m.scale.setScalar(.25 + Math.random() * .25); m.position.set(0, y, 0); this.g.add(m);
            this.crown.push({ m, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: (.9 + Math.random() * .6) * (.5 + .5 * sp), R }); } } }
      for (let i = this.crown.length - 1; i >= 0; i--) { const c = this.crown[i]; c.vy -= 9.8 * dt * .6; c.m.position.x += c.vx * dt * .5; c.m.position.z += c.vz * dt * .5; c.m.position.y += c.vy * dt * .5;
        if (c.m.position.y < y && c.vy < 0) { const x = c.m.position.x / c.R, z = c.m.position.z / c.R; if (x * x + z * z < .9) sim.impulse(x, z, -.02, .08); this.g.remove(c.m); this.crown.splice(i, 1); } }
      this._overflow(now, dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  _overflow(now, dt) {
    const D = this.D, want = this.excess > 0 ? Math.min(8, 1 + Math.floor(this.excess / .25)) : 0;
    if (!this.pool) {
      this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshPhysicalMaterial({ color: 0x4a0307, roughness: .04, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 2 }));
      this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = D.pool + .002; this.pool.scale.setScalar(.01); this.pool.visible = false; this.g.add(this.pool);
      this.streamMat = new THREE.MeshPhysicalMaterial({ color: 0x6a050c, emissive: 0x1a0002, roughness: .07, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.5 });
    }
    while (this.streams.length < want) {
      // a stream runs from the mouth down the outside of the glass; where the glass curves away it drips
      const phi = Math.random() * Math.PI * 2, pts = [], w = (Math.random() - .5) * .3; let y = D.spill || 1.1, prevR = profR(this.outer, y), endY = D.pool;
      if (D.spill) for (; y > D.pool + .05; y -= .02) { const r = profR(this.outer, y); if (r < prevR - .06) { endY = y; break; } prevR = r; const a = phi + w * Math.sin(y * 6); pts.push(new THREE.Vector3(Math.cos(a) * (r + .014), y, Math.sin(a) * (r + .014))); }
      else { const a = phi, r = .82; pts.push(new THREE.Vector3(Math.cos(a) * r, 1.06, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r)); }
      if (pts.length < 2) pts.push(pts[0] ? pts[0].clone().setY(pts[0].y - .05) : new THREE.Vector3(0, 0, 0));
      const gg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length), .022 + Math.random() * .016, 8, false);
      const m = new THREE.Mesh(gg, this.streamMat); gg.setDrawRange(0, 0); this.g.add(m);
      const tip = new THREE.Mesh(this.dropGeo, this.streamMat); tip.visible = false; this.g.add(tip);
      this.streams.push({ m, g: gg, tip, p: 0, end: pts[pts.length - 1], next: now + 900 + Math.random() * 1500 });
    }
    while (this.streams.length > want) { const s = this.streams.pop(); this.g.remove(s.m, s.tip); s.g.dispose(); }
    for (const s of this.streams) { s.p = Math.min(1, s.p + dt * .6); s.g.setDrawRange(0, Math.floor(s.g.index.count * s.p / 6) * 6);
      if (s.p >= 1) { s.tip.visible = true; s.tip.position.copy(s.end); s.tip.position.y -= .03; s.tip.scale.set(.5, .5 + .25 * Math.sin(now / 300), .5);
        if (now > s.next) { s.next = now + 1200 + Math.random() * 2200; const d = new THREE.Mesh(this.dropGeo, this.streamMat); d.scale.set(.45, .7, .45); d.position.copy(s.tip.position); this.g.add(d); this.falls.push({ m: d, vy: 0 }); } } }
    for (let i = this.falls.length - 1; i >= 0; i--) { const f = this.falls[i]; f.vy -= 9.8 * dt * .5; f.m.position.y += f.vy * dt; if (f.m.position.y <= D.pool) { this.g.remove(f.m); this.falls.splice(i, 1); } }
    const pr = this.excess > 0 ? D.baseR + .25 + Math.min(.55, this.excess * .25) : 0, cur = this.pool.scale.x;
    this.pool.visible = pr > 0 || cur > .02; this.pool.scale.setScalar(Math.max(cur < D.baseR && pr > 0 ? D.baseR : 0, cur + (pr - cur) * .03));
  }
}

window.SkullVessel = VesselEngine;          // the app asks for "the vessel" by this name
window.VESSELS = DESIGNS;
window.dispatchEvent(new Event('skull3d-ready'));
