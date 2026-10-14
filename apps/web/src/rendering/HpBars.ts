import * as THREE from 'three';

/**
 * All health bars in four instanced draws (background, recent-damage "lag", fill, shield). Bars
 * always face the camera.
 * Each frame the battle view calls begin(), add() per visible bar, end().
 */
export class HpBars {
  readonly root = new THREE.Group();
  private bg: THREE.InstancedMesh;
  private fill: THREE.InstancedMesh;
  private lag: THREE.InstancedMesh;
  private lagCount = 0;
  private shield: THREE.InstancedMesh;
  private count = 0;
  private shieldCount = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private right = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(private readonly capacity = 160) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.bg = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x101018, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }), capacity);
    this.lag = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, depthTest: false, depthWrite: false }), capacity);
    this.fill = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }), capacity);
    this.shield = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, depthTest: false, depthWrite: false }), capacity);
    for (const im of [this.bg, this.lag, this.fill, this.shield]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.renderOrder = 10;
      this.root.add(im);
    }
    // All layers are "transparent" so three.js sorts them by renderOrder alone: an opaque fill
    // would be drawn before the (transparent) background and disappear under it.
    this.bg.renderOrder = 9;
    this.lag.renderOrder = 9.5;
    this.fill.setColorAt(0, new THREE.Color(0xffffff));
  }

  begin(camera: THREE.Camera): void {
    this.count = 0;
    this.shieldCount = 0;
    this.lagCount = 0;
    camera.getWorldQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
  }

  /**
   * @param lagRatio health shown a moment ago; the gap to {@code ratio} is drawn light so every hit
   *     is visible (the bar then catches up).
   */
  add(pos: THREE.Vector3, width: number, ratio: number, color: number, shieldRatio = 0, lagRatio = 0, height = 0): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const h = height || Math.max(0.16, width * 0.16);
    const border = h * 0.35;
    this.s.set(width + border, h + border, 1);
    this.m.compose(pos, this.q, this.s);
    this.bg.setMatrixAt(i, this.m);
    const r = Math.max(0, Math.min(1, ratio));
    if (lagRatio > r + 0.002 && this.lagCount < this.capacity) {
      const l = Math.min(1, lagRatio);
      const j = this.lagCount++;
      this.p.copy(pos).addScaledVector(this.right, (-(1 - l) * width) / 2);
      this.s.set(width * l, h, 1);
      this.m.compose(this.p, this.q, this.s);
      this.lag.setMatrixAt(j, this.m);
    }
    this.p.copy(pos).addScaledVector(this.right, (-(1 - r) * width) / 2);
    this.s.set(Math.max(0.0001, width * r), h, 1);
    this.m.compose(this.p, this.q, this.s);
    this.fill.setMatrixAt(i, this.m);
    this.fill.setColorAt(i, this.color.setHex(color));
    if (shieldRatio > 0 && this.shieldCount < this.capacity) {
      const j = this.shieldCount++;
      this.p.copy(pos).addScaledVector(this.right, (-(1 - shieldRatio) * width) / 2);
      this.p.y += h * 1.3;
      this.s.set(width * shieldRatio, h * 0.7, 1);
      this.m.compose(this.p, this.q, this.s);
      this.shield.setMatrixAt(j, this.m);
    }
  }

  end(): void {
    this.bg.count = this.count;
    this.lag.count = this.lagCount;
    this.lag.instanceMatrix.needsUpdate = true;
    this.fill.count = this.count;
    this.shield.count = this.shieldCount;
    this.bg.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    this.shield.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }
}
