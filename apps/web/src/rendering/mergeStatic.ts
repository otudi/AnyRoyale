import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Copy of a geometry with every attribute as plain float32 (quantized meshes cannot be re-transformed). */
function toFloat32(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name) as THREE.BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) geo.setIndex(Array.from(src.index.array as ArrayLike<number>));
  return geo;
}

/**
 * Bakes every static, opaque, non-skinned mesh under {@code root} into one mesh per material
 * (plus shadow flags). The arena is ~120 separate meshes that never move; merged it is a handful
 * of draw calls, which is what keeps phones from stuttering. Meshes flagged with
 * {@code userData.dynamic} (or under such a parent) are left alone.
 *
 * @returns the number of meshes merged away
 */
export function mergeStatic(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const skip = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if (o.userData.dynamic) o.traverse((c) => skip.add(c));
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (Array.isArray(m.material) || !m.visible) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent) return;
    const attrs = Object.keys(m.geometry.attributes).sort().join(',');
    // Morph targets / groups are not supported by the merge.
    if (m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) return;
    const key = `${mat.uuid}|${attrs}|${m.castShadow}|${m.receiveShadow}`;
    let g = groups.get(key);
    if (!g) {
      g = { material: mat, cast: m.castShadow, receive: m.receiveShadow, geos: [], meshes: [] };
      groups.set(key, g);
    }
    const geo = toFloat32(m.geometry);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, m.matrixWorld));
    g.geos.push(geo.index ? geo.toNonIndexed() : geo);
    g.meshes.push(m);
  });
  let merged = 0;
  for (const g of groups.values()) {
    if (g.meshes.length < 2) {
      for (const geo of g.geos) geo.dispose();
      continue;
    }
    const geo = mergeGeometries(g.geos, false);
    for (const x of g.geos) x.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'merged';
    root.add(mesh);
    for (const m of g.meshes) {
      m.removeFromParent();
      merged++;
    }
  }
  // Drop now-empty groups left behind by the removed meshes.
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && !(o as THREE.Points).isPoints) empty.push(o);
  });
  for (const e of empty) e.removeFromParent();
  return merged;
}
