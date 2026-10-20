/* Domso — gothic gold chalice with a real blood surface.
   Liquid: a damped wave equation on a disc (ripples reflect off the bowl wall) + a sloshing mode
   driven by phone tilt. Drops hit the surface, throw a small crown of droplets, and ripple out. */
import * as THREE from 'three';

/* ---------- chalice profile (r, y) ---------- */
const OUTER = [[0,-1.2],[.6,-1.2],[.66,-1.17],[.66,-1.13],[.58,-1.1],[.44,-1.04],[.26,-.96],[.15,-.86],[.12,-.72],[.12,-.6],[.19,-.53],[.23,-.46],[.19,-.39],[.12,-.33],[.11,-.2],[.14,-.1],[.3,-.02],[.52,.1],[.68,.3],[.78,.56],[.83,.82],[.86,1.0],[.87,1.04]];
const INNER = [[.83,1.04],[.81,.98],[.78,.82],[.73,.56],[.63,.33],[.47,.15],[.25,.04],[0,.01]];
const IN_PTS = INNER.slice().reverse();               // bottom → rim, for radius lookup
const LIQ_MIN = .035, LIQ_MAX = .93;
function innerR(y) {                                   // bowl inner radius at height y
  for (let i = 0; i < IN_PTS.length - 1; i++) {
    const [r0, y0] = IN_PTS[i], [r1, y1] = IN_PTS[i + 1];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return y < IN_PTS[0][1] ? 0 : IN_PTS[IN_PTS.length - 1][0];
}
function smoothProfile(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal', .2);
  return c.getPoints(n).map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
}

/* ---------- liquid simulation on a unit disc ---------- */
class Ripples {
  constructor(n = 56) {
    this.n = n; this.h = new Float32Array(n * n); this.v = new Float32Array(n * n); this.m = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, z = j / (n - 1) * 2 - 1; this.m[j * n + i] = x * x + z * z <= 1.0 ? 1 : 0; }
    this.slope = 0; this.slopeV = 0; this.slopeZ = 0; this.slopeZV = 0;
  }
  impulse(x, z, amp, rad = .12) {                      // x,z in [-1,1]
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; if (!this.m[k]) continue;
      const dx = i / (n - 1) * 2 - 1 - x, dz = j / (n - 1) * 2 - 1 - z, d2 = dx * dx + dz * dz;
      if (d2 < rad * rad * 9) this.v[k] += amp * Math.exp(-d2 / (rad * rad));
    }
  }
  step(target, targetZ) {
    const n = this.n, h = this.h, v = this.v, m = this.m;
    // sloshing: the surface plane overshoots the true level and swings back (like real liquid)
    const a = (target - this.slope) * .055; this.slopeV += a; this.slopeV *= .965; this.slope += this.slopeV;
    const az = (targetZ - this.slopeZ) * .05; this.slopeZV += az; this.slopeZV *= .96; this.slopeZ += this.slopeZV;
    // the swinging plane pumps energy into waves along the walls
    const pump = (a * 1.6), pumpZ = (az * 1.2);
    for (let s = 0; s < 2; s++) {
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i; if (!m[k]) continue;
        const c = h[k];
        const l = m[k - 1] ? h[k - 1] : c, r = m[k + 1] ? h[k + 1] : c, u = m[k - n] ? h[k - n] : c, d = m[k + n] ? h[k + n] : c;
        v[k] += (l + r + u + d - 4 * c) * .42;
      }
      for (let k = 0; k < n * n; k++) { if (!m[k]) continue; v[k] *= .992; h[k] += v[k] * .5; h[k] *= .9992; }
    }
    if (Math.abs(pump) + Math.abs(pumpZ) > 1e-4)
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; if (!m[k]) continue; const x = i / (n - 1) * 2 - 1, z = j / (n - 1) * 2 - 1; const rr = x * x + z * z; v[k] -= (pump * x + pumpZ * z) * rr * .6; }
  }
  sample(x, z) {                                       // bilinear height at x,z in [-1,1]
    const n = this.n, fx = (x + 1) / 2 * (n - 1), fz = (z + 1) / 2 * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz))), tx = fx - i, tz = fz - j, h = this.h;
    return (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - tz) + (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * tz;
  }
}

export class ChaliceVessel {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'skull3d';
    this.level = 0; this.target = 0; this.angle = 0; this.angleZ = 0; this.ready = false; this.drops = []; this.crown = [];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;     // neutral: keeps blood red, never pink
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(25, 1, .1, 50);
    const C = window.CH_CAM || [0, 3.9, 5.4, -.08]; this.camera.position.set(C[0], C[1], C[2]); this.camera.lookAt(0, C[3], 0);
    this._env(); this._build(); this.ready = true; this._loop();
    this.canvas.addEventListener('pointerdown', e => this._poke(e, .9));
    this.canvas.addEventListener('pointermove', e => { if (e.buttons || e.pressure) this._poke(e, .25); });
  }

  _env() {
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
    env.background = new THREE.Color(0x020101);
    const panel = (w, h, rgb, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.material.color.setRGB(...rgb); m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
    panel(4, 2.4, [7, 6.4, 5.6], [-2.6, 5.5, 3.4]);      // warm key softbox overhead-left
    panel(1.1, 5, [2.6, 2.2, 1.8], [5, 1.2, 2]);         // strip right
    panel(3, 4, [2.8, .22, .25], [2.5, 1, -5]);          // red rim behind
    panel(7, 1.4, [.5, .32, .16], [0, -4.5, 1.5]);       // warm floor bounce for the gold
    panel(3.4, 1.3, [3.4, 3.2, 3.0], [0, 4.6, -3.2]);   // softbox behind-above: the wet highlight on the blood
    this.scene.environment = pm.fromScene(env, .02).texture;
    const key = new THREE.DirectionalLight(0xffe6cc, 1.6); key.position.set(-2, 6, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3040, 2.2); rim.position.set(3, 1.5, -4); this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x3a2622, .7));
  }

  _build() {
    const root = this.root = new THREE.Group(); root.rotation.x = .02; this.scene.add(root);
    // tarnished gold: darker in the crevices (vertex colours), polished on the curves
    const prof = smoothProfile(OUTER.concat(INNER), 160);
    const lg = new THREE.LatheGeometry(prof, 96);
    const cols = [], p = lg.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      let t = 1; if (y < -.3 && y > -.98) t = .72; if (r < .2 && y > -.7) t = .78; if (y > .95) t = 1.08; cols.push(t, t * .97, t * .92); }
    lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xc89b52, metalness: 1, roughness: .22, clearcoat: .35, clearcoatRoughness: .2, vertexColors: true, envMapIntensity: 1.6 });
    const cup = new THREE.Mesh(lg, gold); root.add(cup);
    // garnets set in a band around the bowl, and a twisted ring on the stem
    const gemM = new THREE.MeshPhysicalMaterial({ color: 0x5a0006, roughness: .04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2, sheen: 1, sheenColor: new THREE.Color(0xff2030) });
    const gemG = new THREE.SphereGeometry(.052, 24, 16);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + .35, y = .5, rr = innerR(.5) + .085;
      const gm = new THREE.Mesh(gemG, gemM); gm.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); gm.scale.set(1, 1.25, .7); gm.lookAt(0, y, 0); root.add(gm);
      const set = new THREE.Mesh(new THREE.TorusGeometry(.062, .012, 8, 24), gold); set.position.copy(gm.position); set.lookAt(0, y, 0); set.scale.set(1, 1.25, 1); root.add(set); }
    const band = new THREE.Mesh(new THREE.TorusGeometry(innerR(.5) + .07, .014, 10, 128), gold); band.rotation.x = Math.PI / 2; band.position.y = .43; root.add(band);
    const band2 = band.clone(); band2.position.y = .575; band2.scale.setScalar((innerR(.575) + .07) / (innerR(.5) + .07)); root.add(band2);
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(.16, .028, 120, 10, 2, 5), gold); knot.rotation.x = Math.PI / 2; knot.position.y = -.46; knot.scale.set(1, 1, .55); root.add(knot);

    // ---- the blood surface: polar mesh, heights from the simulation ----
    this.sim = new Ripples(56);
    const NR = 26, NS = 72, pos = [], idx = [], uv = [];
    for (let i = 0; i <= NR; i++) for (let j = 0; j < NS; j++) { const t = i / NR, a = j / NS * Math.PI * 2; pos.push(0, 0, 0); uv.push(t * Math.cos(a), t * Math.sin(a)); }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) { const a = i * NS + j, b = i * NS + (j + 1) % NS, c = (i + 1) * NS + j, d = (i + 1) * NS + (j + 1) % NS; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    // real pooled blood: almost black-red in the depth, crimson where it thins at the wall, wet and glossy
    const vc = []; for (let i = 0; i <= NR; i++) for (let j = 0; j < NS; j++) { const t = i / NR, e = Math.pow(t, 6);
      const c = new THREE.Color().setRGB(.2 + .2 * e, .006 + .008 * e, .008 + .008 * e, THREE.SRGBColorSpace); vc.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(vc, 3));
    this.NR = NR; this.NS = NS;
    this.bloodMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .05, metalness: 0, clearcoat: 1, clearcoatRoughness: .02,
      ior: 1.36, specularIntensity: 1, envMapIntensity: 1.8, side: THREE.DoubleSide, sheen: .5, sheenRoughness: .4, sheenColor: new THREE.Color(0x6a0008) });
    this.surf = new THREE.Mesh(g, this.bloodMat); root.add(this.surf);
    // a thin film of blood on the bowl wall just above the surface (it clings after sloshing)
    this.film = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .04, 96, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x4a0306, roughness: .1, clearcoat: 1, transparent: true, opacity: .75, side: THREE.BackSide, depthWrite: false }));
    root.add(this.film);
    // drops + splash crown
    this.dropGeo = new THREE.SphereGeometry(.05, 20, 14);
    this.dropMat = new THREE.MeshPhysicalMaterial({ color: 0x3a0204, roughness: .05, clearcoat: 1, envMapIntensity: 1.6 });
  }

  /* ---- public API (same as the skull) ---- */
  mount(host) { if (this.canvas.parentNode !== host) host.appendChild(this.canvas); this._resize(); }
  _resize() { const p = this.canvas.parentNode; if (!p) return; const w = p.clientWidth || 260, h = Math.round(w * 1.12);
    if (this._w !== w) { this._w = w; this.renderer.setSize(w, h, true); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); } }
  setLevel(pct) { this.target = Math.max(0, Math.min(1, pct)); }
  setAngle(deg) { this.angle = deg; }
  drip() { const x = (Math.random() - .5) * .5, z = (Math.random() - .5) * .4;
    const m = new THREE.Mesh(this.dropGeo, this.dropMat); m.position.set(x * .6, 2.2, z * .6); this.root.add(m);
    this.drops.push({ m, x, z, vy: 0 }); this.holdUntil = performance.now() + 650; }

  _surfaceY() { return LIQ_MIN + (LIQ_MAX - LIQ_MIN) * this.level; }
  _poke(e, amp) {
    if (this.level < .02) return;
    const r = this.canvas.getBoundingClientRect(), nd = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(nd, this.camera);
    const y = this._surfaceY(), pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(pl, hit)) return;
    const R = innerR(y); const x = hit.x / R, z = hit.z / R; if (x * x + z * z < .95) this.sim.impulse(x, z, -.05 * amp, .1);
  }
  _splash(x, z, R, y) {
    this.sim.impulse(x, z, -.11, .11);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + Math.random() * .4, sp = .35 + Math.random() * .35;
      const m = new THREE.Mesh(this.dropGeo, this.dropMat); m.scale.setScalar(.22 + Math.random() * .25);
      m.position.set(x * R, y, z * R); this.root.add(m);
      this.crown.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1.1 + Math.random() * .7, R }); }
  }

  _loop() {
    let last = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.canvas.isConnected || document.hidden) return;
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!this.holdUntil || now > this.holdUntil) this.level += (this.target - this.level) * .045;
      const y = this._surfaceY(), R = innerR(y) - .004, has = this.level > .004;
      // phone tilt → the liquid stays level in the world, so relative to the cup it slopes the other way
      const tgt = Math.tan(THREE.MathUtils.degToRad(this.angle)) * R * .9, sim = this.sim;
      sim.step(tgt, 0);
      // build the surface
      const pos = this.surf.geometry.attributes.position, nor = this.surf.geometry.attributes.normal, uv = this.surf.geometry.attributes.uv;
      const sl = sim.slope, e = .02;
      for (let k = 0; k < pos.count; k++) {
        const u = uv.getX(k), v = uv.getY(k), hh = sim.sample(u, v) + sl * u;
        pos.setXYZ(k, u * R, y + hh, v * R);
        const hx = (sim.sample(Math.min(1, u + e), v) - sim.sample(Math.max(-1, u - e), v)) / (2 * e * R) + sl / R;
        const hz = (sim.sample(u, Math.min(1, v + e)) - sim.sample(u, Math.max(-1, v - e))) / (2 * e * R);
        const l = Math.hypot(hx, 1, hz); nor.setXYZ(k, -hx / l, 1 / l, -hz / l);
      }
      pos.needsUpdate = true; nor.needsUpdate = true; this.surf.visible = has; this.surf.geometry.computeBoundingSphere();
      this.film.visible = has; this.film.position.y = y + .02; this.film.scale.set(innerR(y + .02) - .002, 1, innerR(y + .02) - .002);
      // drops falling into the cup
      for (let i = this.drops.length - 1; i >= 0; i--) { const d = this.drops[i]; d.vy -= 9.8 * dt * .55; d.m.position.y += d.vy * dt;
        d.m.scale.set(1 - Math.min(.3, -d.vy * .05), 1 + Math.min(.8, -d.vy * .15), 1 - Math.min(.3, -d.vy * .05));
        if (d.m.position.y <= y) { this.root.remove(d.m); this.drops.splice(i, 1); this._splash(d.x, d.z, R, y); } }
      // splash crown droplets arc up and fall back in, each one rippling where it lands
      for (let i = this.crown.length - 1; i >= 0; i--) { const c = this.crown[i]; c.vy -= 9.8 * dt * .6;
        c.m.position.x += c.vx * dt * .5; c.m.position.z += c.vz * dt * .5; c.m.position.y += c.vy * dt * .5;
        if (c.m.position.y < y && c.vy < 0) { const x = c.m.position.x / c.R, z = c.m.position.z / c.R; if (x * x + z * z < .9) sim.impulse(x, z, -.02, .07);
          this.root.remove(c.m); this.crown.splice(i, 1); } }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }
}

window.SkullVessel = ChaliceVessel;          // the app asks for "the vessel" by this name
window.dispatchEvent(new Event('skull3d-ready'));
