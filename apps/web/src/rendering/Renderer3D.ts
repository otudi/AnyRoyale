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
export class Renderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraRig = new THREE.Group();
  readonly renderer: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 9 / 16, 0.5, 260);
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5d4a33, 1.25);
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

  private applyQuality(q: Quality, caps: { strong: boolean; mobile: boolean }): void {
    const high = q === 'high' || (q === 'auto' && caps.strong);
    this.quality = high ? 'high' : 'low';
    // Phones: no shadow map (a second render pass of every caster); units use blob shadows.
    const shadows = q === 'high' || (q === 'auto' && caps.strong && !caps.mobile);
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadows ? 2048 : 512, shadows ? 2048 : 512);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    // Fill rate dominates on phones: 1.5x density looks sharp and costs ~45% fewer pixels than 2x.
    const dpr = window.devicePixelRatio || 1;
    this.maxPixelRatio = q === 'low' ? 1 : q === 'high' ? Math.min(dpr, 2) : Math.min(dpr, caps.mobile ? 1.5 : 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  /** Places the camera behind the given seat's own side. */
  setPerspective(team: 'BLUE' | 'RED'): void {
    this.side = team === 'RED' ? -1 : 1;
    this.layoutCamera();
  }

  /** +1 when looking from the blue side, -1 from the red side (camera mirrored through the centre). */
  private side = 1;

  /** Fraction of the screen covered by the card tray (bottom) and top HUD; set by the HUD. */
  private trayFraction = 0.2;
  private topFraction = 0.075;

  setInsets(trayFraction: number, topFraction: number): void {
    this.trayFraction = trayFraction;
    this.topFraction = topFraction;
    this.layoutCamera();
  }

  /**
   * Fits the arena between the top HUD and the card tray for any screen shape: with a fixed tilt
   * and field of view, solves for the camera distance and aim point so the near edge sits just
   * above the tray and the far edge just below the HUD, then backs off if the near corners would be
   * clipped horizontally (wide screens keep a little scenery at the sides).
   */
  private layoutCamera(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
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
    this.shake = Math.min(0.6, this.shake + strength);
  }

  private applyShake(dt: number): void {
    if (this.shake <= 0.001) {
      if (this.camera.position.x !== 0) this.camera.position.x = 0;
      return;
    }
    this.camera.position.x = (Math.random() - 0.5) * this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  private trackFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 1) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    if (getSettings().quality !== 'auto') return;
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
