import * as THREE from 'three';

/**
 * "See-through" silhouettes: wherever a unit is hidden behind a tower or building, it is drawn as a
 * flat silhouette in its team colour, so towers never hide troops. There are no black outlines.
 *
 * How: every unit mesh gets a twin with the same geometry (and skeleton) and a material that only
 * passes the depth test where something is IN FRONT of it (GreaterDepth). The twins are drawn after
 * the arena and towers but before the units themselves (render order), so a unit never covers its
 * own parts with its silhouette and units do not silhouette each other.
 */

export type SilhouetteSide = 'own' | 'enemy';

const COLORS: Record<SilhouetteSide, number> = { own: 0x6aa8ff, enemy: 0xff7a7a };
/** Render order: arena/towers 0, silhouettes 1, units 2. */
export const SILHOUETTE_ORDER = 1;
export const UNIT_ORDER = 2;

const materials = new Map<SilhouetteSide, THREE.MeshBasicMaterial>();

function silhouetteMaterial(side: SilhouetteSide): THREE.MeshBasicMaterial {
  let m = materials.get(side);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: COLORS[side], depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
    materials.set(side, m);
  }
  return m;
}

/** Adds silhouette twins to every opaque mesh under {@code root} (once) and orders the unit's own meshes. */
export function addOutlines(root: THREE.Object3D, side: SilhouetteSide = 'own'): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.outline || m.userData.hasOutline || m.userData.noOutline) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || mat.transparent) return;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    meshes.push(m);
  });
  const material = silhouetteMaterial(side);
  for (const m of meshes) {
    let twin: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = m as THREE.SkinnedMesh;
      const s = new THREE.SkinnedMesh(sk.geometry, material);
      s.bind(sk.skeleton, sk.bindMatrix);
      s.bindMode = sk.bindMode;
      twin = s;
    } else {
      twin = new THREE.Mesh(m.geometry, material);
    }
    twin.userData.outline = true;
    twin.castShadow = false;
    twin.receiveShadow = false;
    twin.frustumCulled = m.frustumCulled;
    twin.renderOrder = SILHOUETTE_ORDER;
    m.renderOrder = UNIT_ORDER;
    m.userData.hasOutline = true;
    m.add(twin);
  }
}

/** Shows or hides the silhouettes under {@code root} (hidden while a unit is see-through). */
export function setOutlinesVisible(root: THREE.Object3D, visible: boolean): void {
  root.traverse((o) => {
    if (o.userData.outline) o.visible = visible;
  });
}
