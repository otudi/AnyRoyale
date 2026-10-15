import * as THREE from 'three';
import { getSettings, onSettings, type Quality } from '../ui/settings';

/**
 * WebGL renderer, camera and lighting.
 *
 * Camera: fixed, tilted perspective view of the 18x32 arena similar to the reference game. The
 * player always sees their own towers at the bottom: for the red seat the camera rig is rotated
 * 180 degrees around the arena centre (the arena layout is rotation-symmetric).
 *
 * Quality: "high" = antialiasing, soft shadows, device pixel ratio up to 2; "low" = no shadows,
 * pixel ratio 1. "auto" starts high on capable devices and lowers the resolution when the frame
 * rate stays under ~45 FPS (and raises it again when there is headroom).
 */
/** Side-view camera: vertical field of view and downward tilt (degrees). */
const SIDE_FOV = 22;
const SIDE_TILT = 33;

export class Renderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraRig = new THREE.Group();
  readonly renderer: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private updaters = new Set<(dt: number, t: number) => void>();
  private running = false;
  private last = 0;
  private elapsed = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 60;
  private pixelRatio = 1;
  private maxPixelRatio = 2;
  private lowFpsSeconds = 0;
  private highFpsSeconds = 0;
  private shake = 0;
  quality: 'high' | 'low' = 'high';

  constructor(private readonly container: HTMLElement) {
    const caps = Renderer3D.detectCaps();
    this.renderer = new THREE.WebGLRenderer({
      // MSAA costs a lot of fill rate on phones, whose pixel density hides aliasing anyway.
      antialias: caps.strong && !caps.mobile,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 9 / 16, 0.5, 260);
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5d4a33, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.position.set(-9, 22, 10);
    this.sun.target.position.set(0, 0, 0);
    this.sun.shadow.camera.left = -13;
    this.sun.shadow.camera.right = 13;
    this.sun.shadow.camera.top = 19;
    this.sun.shadow.camera.bottom = -19;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    // Back light from the far side of the arena: bright edges that lift units off the ground.
    this.rim = new THREE.DirectionalLight(0xd6e8ff, 1.2);
    this.rim.position.set(3, 7, -16);
    this.scene.add(this.rim);

    this.applyQuality(getSettings().quality, caps);
    onSettings((s) => this.applyQuality(s.quality, caps));
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.resize();
    this.setPerspective('BLUE');
  }

  static detectCaps(): { strong: boolean; mobile: boolean } {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const small = Math.min(screen.width, screen.height) < 400;
    const mobile = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return { strong: mem >= 4 && cores >= 4 && !small, mobile };
  }

  /** True when the sun casts real-time shadows; otherwise units get blob shadows. */
  get realShadows(): boolean {
    return this.renderer.shadowMap.enabled;
  }

  /** The player's quality setting: low (battery), medium (phones), high (desktop). */
  tier: Quality = 'medium';

  private applyQuality(q: Quality, caps: { strong: boolean; mobile: boolean }): void {
    this.tier = q;
    // geometry/particle detail: medium and high share it; low trims the scenery and effects
    this.quality = q === 'low' ? 'low' : 'high';
    void caps;
    // Real-time shadows only on "high" (a second render pass of every caster); otherwise units
    // get soft blob shadows.
    const shadows = q === 'high';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadows ? 2048 : 512, shadows ? 2048 : 512);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    // Fill rate dominates on phones: 1.5x density looks sharp and costs ~45% fewer pixels than 2x.
    const dpr = window.devicePixelRatio || 1;
    this.maxPixelRatio = q === 'low' ? 1 : q === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  /** Places the camera behind the given seat's own side. */
  setPerspective(team: 'BLUE' | 'RED'): void {
    this.side = team === 'RED' ? -1 : 1;
    this.rim.position.set(3 * this.side, 7, -16 * this.side);
    this.layoutCamera();
  }

  /** +1 when looking from the blue side, -1 from the red side (camera mirrored through the centre). */
  private side = 1;

  /** Fraction of the screen covered by the card tray (bottom) and top HUD; set by the HUD. */
  private trayFraction = 0.2;
  private topFraction = 0.075;
  /** Fraction of the screen width covered on the left (the card size preview's side panel). */
  private leftFraction = 0;

  setInsets(trayFraction: number, topFraction: number, leftFraction = 0): void {
    this.trayFraction = trayFraction;
    this.topFraction = topFraction;
    this.leftFraction = leftFraction;
    this.layoutCamera();
  }

  /**
   * Fits the arena between the top HUD and the card tray for any screen shape: with a fixed tilt
   * and field of view, solves for the camera distance and aim point so the near edge sits just
   * above the tray and the far edge just below the HUD, then backs off if the near corners would be
   * clipped horizontally (wide screens keep a little scenery at the sides).
   */
  /** True when the screen is wider than tall: the arena is shown from its long side. */
  landscape = false;

  private layoutCamera(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.landscape = w > h * 1.05;
    // Battles are always shown from the side (own half left, enemy right). On a portrait screen
    // the HUD asks the player to turn the device; the view stays correct meanwhile.
    this.layoutSideView(w, h);
    return;
    this.rim.position.set(3 * this.side, 7, -16 * this.side);
    const cam = this.camera;
    cam.aspect = w / h;
    cam.fov = 32;
    cam.updateProjectionMatrix();
    const tilt = THREE.MathUtils.degToRad(57);
    const near = -1 + 2 * (this.trayFraction + 0.005);
    const far = 1 - 2 * (this.topFraction + 0.11); // leave room above for the enemy king tower
    const v = new THREE.Vector3();
    const place = (d: number, tz: number) => {
      cam.position.set(0, Math.sin(tilt) * d, tz + Math.cos(tilt) * d);
      cam.lookAt(0, 0, tz);
      cam.updateMatrixWorld(true);
    };
    const ndcY = (z: number) => v.set(0, 0, z).project(cam).y;
    let d = 40;
    let tz = 0;
    for (let iter = 0; iter < 40; iter++) {
      place(d, tz);
      const yn = ndcY(16.4);
      const yf = ndcY(-16.4);
      const span = yf - yn;
      const want = far - near;
      d *= Math.pow(span / want, 0.9);
      place(d, tz);
      const mid = (ndcY(16.4) + ndcY(-16.4)) / 2;
      tz += ((near + far) / 2 - mid) * d * 0.25;
    }
    // Horizontal fit: the near corners must stay on screen.
    for (let iter = 0; iter < 30; iter++) {
      place(d, tz);
      const x = Math.abs(v.set(9.7, 0, 16.4).project(cam).x);
      if (x <= 0.985) break;
      d *= x / 0.985;
      place(d, tz);
      // keep the near edge just above the tray
      const yn = ndcY(16.4);
      tz += (near - yn) * d * 0.25;
    }
    // Solved in the blue frame; the red seat looks from the opposite end (arena is symmetric).
    cam.position.set(0, Math.sin(tilt) * d, this.side * (tz + Math.cos(tilt) * d));
    cam.lookAt(0, 0, this.side * tz);
    cam.updateMatrixWorld(true);
    this.cameraDistance = d;
    cam.updateProjectionMatrix();
  }

  cameraDistance = 40;

  /**
   * Landscape: the camera looks across the river from the arena's long side, own half on the left
   * and the enemy's on the right (like a stadium broadcast). Solved like the portrait view: the
   * near touchline sits just above the card tray, the far towers just below the top HUD, and the
   * whole length fits the width.
   */
  private layoutSideView(w: number, h: number): void {
    const cam = this.camera;
    cam.aspect = w / h;
    // Narrow field of view = mild perspective: the far lane's troops stay nearly as big as the
    // near lane's. A lower tilt shows the sides of troops and towers (tuned from screenshots).
    cam.fov = SIDE_FOV;
    cam.updateProjectionMatrix();
    const s = this.side; // blue: camera on +x, so +z (own half) is on the left
    const tilt = THREE.MathUtils.degToRad(SIDE_TILT);
    const bottom = -1 + 2 * (this.trayFraction + 0.01);
    const top = 1 - 2 * (this.topFraction + 0.03);
    const v = new THREE.Vector3();
    // tz slides the view along the field (screen horizontal) when a side panel covers the left
    let tz = 0;
    const place = (d: number, tx: number) => {
      cam.position.set(s * (tx + Math.cos(tilt) * d), Math.sin(tilt) * d, tz);
      cam.lookAt(s * tx, 0, tz);
      cam.updateMatrixWorld(true);
    };
    const left = -1 + 2 * this.leftFraction + (this.leftFraction > 0 ? 0.02 : 0.03);
    const right = 0.97;
    const nearY = () => Math.min(v.set(s * 9.9, 0, 16.6).project(cam).y, v.set(s * 9.9, 0, 0).project(cam).y);
    // far touchline, and the far towers with their health bars
    const farY = () =>
      Math.max(v.set(-s * 9.9, 0.6, 0).project(cam).y, v.set(-s * 5.5, 3.6, 9.5).project(cam).y, v.set(-s * 5.5, 3.6, -9.5).project(cam).y);
    let d = 38;
    let tx = 0;
    for (let iter = 0; iter < 40; iter++) {
      place(d, tx);
      const span = farY() - nearY();
      d *= Math.pow(span / (top - bottom), 0.9);
      place(d, tx);
      const mid = (farY() + nearY()) / 2;
      tx += ((bottom + top) / 2 - mid) * d * 0.25;
    }
    const xs = () => {
      const a = v.set(s * 9.9, 0, 16.8).project(cam).x;
      const b = v.set(s * 9.9, 0, -16.8).project(cam).x;
      return [Math.min(a, b), Math.max(a, b)];
    };
    for (let iter = 0; iter < 30; iter++) {
      place(d, tx);
      const [x0, x1] = xs();
      if (x0 >= left - 1e-3 && x1 <= right + 1e-3) break;
      d *= Math.max(1, (x1 - x0) / (right - left));
      place(d, tx);
      // centre the near touchline between the side insets (numerical slope: sign-agnostic)
      const [a0, a1] = xs();
      tz += 0.5;
      place(d, tx);
      const [b0, b1] = xs();
      const slope = ((b0 + b1) - (a0 + a1)) / 2 / 0.5;
      tz -= 0.5;
      if (Math.abs(slope) > 1e-6) tz += ((left + right) / 2 - (a0 + a1) / 2) / slope;
      place(d, tx);
      tx += (bottom - nearY()) * d * 0.25;
    }
    place(d, tx);
    // back light from the far stand, like the portrait view's light from the far end
    this.rim.position.set(-16 * s, 7, 3);
    this.cameraDistance = d;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.layoutCamera();
  }

  addUpdater(fn: (dt: number, t: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;
      for (const u of this.updaters) u(dt, this.elapsed);
      this.applyShake(dt);
      this.renderer.render(this.scene, this.camera);
      this.trackFps(dt);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
  }

  /** Short camera shake for big explosions and tower destruction. */
  kick(strength: number): void {
    // The camera stays still during play (a moving view makes card drops miss); impacts are shown
    // by effects instead.
    void strength;
  }

  private applyShake(dt: number): void {
    // shake the rig, not the camera: the camera's own position is the solved layout
    if (this.shake <= 0.001) {
      if (this.cameraRig.position.x !== 0) this.cameraRig.position.set(0, 0, 0);
      return;
    }
    this.cameraRig.position.set((Math.random() - 0.5) * this.shake, 0, (Math.random() - 0.5) * this.shake * 0.5);
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  private trackFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 1) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    if (getSettings().quality !== 'medium') return; // medium adapts its resolution to keep FPS
    if (this.fps < 45) {
      this.lowFpsSeconds++;
      this.highFpsSeconds = 0;
    } else if (this.fps > 57) {
      this.highFpsSeconds++;
      this.lowFpsSeconds = 0;
    }
    // Never go below 1 CSS pixel per pixel: lower looks blurry, which players notice more than FPS.
    if (this.lowFpsSeconds >= 2 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.lowFpsSeconds = 0;
      if (this.pixelRatio <= 1 && this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.enabled = false;
        this.sun.castShadow = false;
      }
    } else if (this.highFpsSeconds >= 8 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.highFpsSeconds = 0;
    }
  }

  /** Projects a world position to container pixel coordinates. */
  project(v: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const p = v.clone().project(this.camera);
    return out.set(
      ((p.x + 1) / 2) * this.container.clientWidth,
      ((1 - p.y) / 2) * this.container.clientHeight,
    );
  }

  /** Ray-casts a container pixel onto the ground plane (y = 0). */
  pickGround(px: number, py: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2(
      (px / this.container.clientWidth) * 2 - 1,
      -(py / this.container.clientHeight) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
