/* Domso — realistic glass skull with real 3D blood inside.
   Model: "Human Skull" CC0, opengameart.org/content/human-skull-0
   Blood = the skull volume below a tilting plane; the far inner walls read as the glossy surface. */
import * as THREE from 'three';
import { OBJLoader } from './OBJLoader.js';

const BASE = new URL('../skull/', import.meta.url).href;

export class SkullVessel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'skull3d';
    this.level = 0; this.target = 0; this.angle = 0; this.ready = false; this.dropT = -1;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, 0.9, 5.7); this.camera.lookAt(0, -0.05, 0);
    const pm = new THREE.PMREMGenerator(this.renderer);
    // a dark studio: black walls, two softboxes and a red rim panel — so the glass reflects darkness + crisp lights
    const env = new THREE.Scene(); env.background = new THREE.Color(0x030102);
    const panel = (w, h, rgb, pos, look) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.material.color.setRGB(...rgb); m.position.set(...pos); m.lookAt(...look); env.add(m); };
    panel(4, 2.2, [6, 5.6, 5.2], [-3, 5, 4], [0, 0, 0]);      // key softbox, top-left front
    panel(1, 5, [2.2, 2.0, 1.9], [5, 1, 2], [0, 0, 0]);       // tall strip, right
    panel(3, 4, [3.5, 0.25, 0.4], [3, 1, -5], [0, 0, 0]);     // red rim panel behind
    panel(6, 1, [0.25, 0.08, 0.1], [0, -4, 2], [0, 0, 0]);    // faint floor bounce
    this.scene.environment = pm.fromScene(env, 0.03).texture;
    const key = new THREE.DirectionalLight(0xffe2d6, 1.7); key.position.set(-2.5, 5, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3050, 3.2); rim.position.set(4, 1, -3); this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x402028, 0.6));
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this._load();
  }

  async _load() {
    const P = Object.assign({ specF: 1.3, specB: 0.7, rim: 0.75, body: 0.12, env: 0.14 }, window.SKULL_P || {});
    const tl = new THREE.TextureLoader();
    const [obj, normal, ao] = await Promise.all([
      new OBJLoader().loadAsync(BASE + 'skull.obj'),
      tl.loadAsync(BASE + 'normal.jpg'), tl.loadAsync(BASE + 'ao.jpg'),
    ]);
    let geo = null; obj.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
    if (!geo.attributes.normal) geo.computeVertexNormals(); geo.computeBoundingBox();
    const bb = geo.boundingBox, c = new THREE.Vector3(); bb.getCenter(c);
    geo.translate(-c.x, -c.y, -c.z);
    const s = 2.3 / (bb.max.y - bb.min.y); geo.scale(s, s, s);
    ao.channel = 0; normal.channel = 0;

    const pivot = new THREE.Group();               // ¾ view, tipped slightly down
    const R = window.SKULL_ROT || [0.14, 0.58, -0.04]; pivot.rotation.set(R[0], R[1], R[2]);
    this.scene.add(pivot); this.pivot = pivot;

    // ---- blood: the skull volume below the plane (stencil-capped) ----
    const inner = geo.clone(); inner.scale(0.955, 0.955, 0.955);
    const clip = [this.plane];
    // outside of the blood: matte deep red
    this.bloodMat = new THREE.MeshStandardMaterial({ color: 0x6e000c, emissive: 0x300004, roughness: 0.62, metalness: 0,
      clippingPlanes: clip, envMapIntensity: 0.12 });
    if (P.basic) this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x5a0008, clippingPlanes: clip });
    const blood = new THREE.Mesh(inner, this.bloodMat); blood.renderOrder = 3; pivot.add(blood);
    // looking down through the cut you see the far inside walls of the blood: dark, wet and glossy = the surface
    this.capMat = new THREE.MeshStandardMaterial({ color: 0x5a0008, emissive: 0x2a0003, roughness: 0.12, metalness: 0.1,
      clippingPlanes: clip, side: THREE.BackSide, envMapIntensity: 0.9 });
    const surf = new THREE.Mesh(inner, this.capMat); surf.renderOrder = 2; pivot.add(surf);
    // a glint ring where the surface meets the glass
    this.cap = new THREE.Mesh(new THREE.RingGeometry(0.3, 2.2, 64), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.cap);

    // ---- glass: inner back faces (thickness), then the clear front shell, then a fresnel rim ----
    const spec = (side, k) => new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      envMapIntensity: k, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side,
      normalMap: normal, normalScale: new THREE.Vector2(1.2, 1.2) });
    const glassBack = new THREE.Mesh(geo, spec(THREE.BackSide, P.specB)); glassBack.renderOrder = 8;
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1a0508, transparent: true, opacity: P.body, roughness: 0.4,
      depthWrite: false, normalMap: normal, aoMap: ao, aoMapIntensity: 2 })); body.renderOrder = 8.5;
    const glassFront = new THREE.Mesh(geo, spec(THREE.FrontSide, P.specF)); glassFront.renderOrder = 9;
    if (P.noGlass) { glassBack.visible = false; glassFront.visible = false; }
    pivot.add(body);
    const rimMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { col: { value: new THREE.Color(0xffd0d8) }, p: { value: 3.4 }, k: { value: P.rim } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 col; uniform float p; uniform float k; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-abs(dot(normalize(vN),normalize(vV))), p); gl_FragColor = vec4(col*f*k, 1.); }` });
    const rimMesh = new THREE.Mesh(geo, rimMat); rimMesh.renderOrder = 10; if (P.noGlass) { rimMesh.visible = false; body.visible = false; }
    pivot.add(glassBack, glassFront, rimMesh);

    // falling drop
    const dg = new THREE.SphereGeometry(0.075, 20, 16); dg.translate(0, 0.02, 0);
    this.drop = new THREE.Mesh(dg, new THREE.MeshPhysicalMaterial({ color: 0x5a0410, roughness: 0.1, clearcoat: 1 }));
    this.drop.visible = false; this.drop.renderOrder = 4; this.scene.add(this.drop);

    // world-space height range of the skull, to map the fill %
    pivot.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(new THREE.Mesh(inner)).applyMatrix4(pivot.matrixWorld);
    this.minY = wb.min.y + 0.08; this.maxY = wb.max.y - 0.04;
    this.ready = true; this._resize(); this._loop();
  }

  mount(host) {
    if (this.canvas.parentNode !== host) host.appendChild(this.canvas);
    this._resize();
  }
  _resize() {
    const p = this.canvas.parentNode; if (!p) return;
    const w = p.clientWidth || 260, h = Math.round(w * 1.12);
    if (this._w !== w) { this._w = w; this.renderer.setSize(w, h, true); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }
  setLevel(pct) { this.target = Math.max(0, Math.min(1, pct)); }
  setAngle(deg) { this.angle = deg; }
  drip(ms = 560) { this.dropT = performance.now(); this.dropMs = ms; this.holdUntil = this.dropT + ms + 40; }

  _loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.canvas.parentNode || !this.canvas.isConnected || document.hidden) return;
      const now = performance.now();
      if (!this.holdUntil || now > this.holdUntil) this.level += (this.target - this.level) * 0.06;
      const y = this.level <= 0.002 ? this.minY - 1 : this.minY + (this.maxY - this.minY) * this.level;
      // tilt the surface around the view axis (sloshes with the phone)
      const a = THREE.MathUtils.degToRad(this.angle);
      const n = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0).normalize();
      const pt = new THREE.Vector3(0, y, 0);
      this.plane.setFromNormalAndCoplanarPoint(n, pt);
      this.cap.position.copy(pt);
      this.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().negate());
      // the drop
      if (this.dropT > 0) {
        const k = (now - this.dropT) / this.dropMs;
        if (k >= 1) { this.drop.visible = false; this.dropT = -1; this.angle += 0; }
        else { this.drop.visible = true; const top = 1.9; this.drop.position.set(0.05, top + (y - top) * k * k, 0.25); this.drop.scale.set(1 - 0.2 * k, 1 + 0.6 * k, 1 - 0.2 * k); }
      }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }
}

window.SkullVessel = SkullVessel;
window.dispatchEvent(new Event('skull3d-ready'));
