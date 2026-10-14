import * as THREE from 'three';

/**
 * Soft round shadows under units, all in one instanced draw. Used instead of a shadow map on
 * phones (the reference game does the same); costs almost nothing.
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private readonly capacity = 200) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** @param size diameter in world units; {@code lift} fades flying units' shadows a little. */
  add(x: number, z: number, size: number): void {
    if (this.count >= this.capacity) return;
    this.p.set(x, 0.03, z);
    this.s.set(size, 1, size);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.count++, this.m);
  }

  end(enabled: boolean): void {
    this.mesh.count = enabled ? this.count : 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.mesh.removeFromParent();
  }
}
