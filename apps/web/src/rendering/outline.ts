import * as THREE from 'three';

/**
 * Cartoon outlines ("inverted hull"): every unit/building mesh gets a back-face twin pushed out
 * along smoothed normals and drawn in a dark ink colour. The push is done in view space and
 * scaled by depth, so the line has the same thickness on screen at any zoom (battle camera and
 * card portraits alike). Works for skinned (animated) and rigid meshes.
 */

const INK = 0x1a1424;
/** Line thickness as a fraction of view depth (≈ 2 px on a phone in battle). */
const WIDTH = 0.0016;

const materials = new Map<string, THREE.MeshBasicMaterial>();

function outlineMaterial(width: number): THREE.MeshBasicMaterial {
  const key = width.toFixed(5);
  let m = materials.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 outlineNormal;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec3 n = outlineNormal;
          #ifdef USE_SKINNING
            n = vec4( skinMatrix * vec4( n, 0.0 ) ).xyz;
          #endif
          vec3 nv = normalize( normalMatrix * n );
          mvPosition.xyz += nv * ${width.toFixed(5)} * max( 1.0, -mvPosition.z );
          gl_Position = projectionMatrix * mvPosition;
        }`,
      );
  };
  m.customProgramCacheKey = () => `outline-${key}`;
  materials.set(key, m);
  return m;
}

const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * The same geometry with an extra 'outlineNormal' attribute: normals averaged over every vertex at
 * the same position, so flat-shaded and hard-edged models get a closed, crack-free hull.
 */
function hullGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = hulls.get(src);
  if (cached) return cached;
  const geo = src.clone();
  const pos = geo.getAttribute('position');
  let nor = geo.getAttribute('normal');
  if (!nor) {
    geo.computeVertexNormals();
    nor = geo.getAttribute('normal');
  }
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(pos.count);
  const q = (v: number) => Math.round(v * 1e4);
  for (let i = 0; i < pos.count; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    keys[i] = k;
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
    sums.set(k, s);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i])!;
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / len;
    out[i * 3 + 1] = s[1] / len;
    out[i * 3 + 2] = s[2] / len;
  }
  geo.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  hulls.set(src, geo);
  return geo;
}

/** Adds outline twins to every opaque, visible-capable mesh under {@code root} (once). */
export function addOutlines(root: THREE.Object3D, scale = 1): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.outline || m.userData.hasOutline || m.userData.noOutline) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || mat.transparent || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    if ((m as unknown as THREE.Points).isPoints || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    meshes.push(m);
  });
  const material = outlineMaterial(WIDTH * scale);
  for (const m of meshes) {
    const geo = hullGeometry(m.geometry);
    let hull: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = m as THREE.SkinnedMesh;
      const s = new THREE.SkinnedMesh(geo, material);
      s.bind(sk.skeleton, sk.bindMatrix);
      s.bindMode = sk.bindMode;
      hull = s;
    } else {
      hull = new THREE.Mesh(geo, material);
    }
    hull.userData.outline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.frustumCulled = m.frustumCulled;
    hull.renderOrder = m.renderOrder;
    m.userData.hasOutline = true;
    m.add(hull);
  }
}

/** Shows or hides the outlines under {@code root} (hidden while a unit is see-through). */
export function setOutlinesVisible(root: THREE.Object3D, visible: boolean): void {
  root.traverse((o) => {
    if (o.userData.outline) o.visible = visible;
  });
}
