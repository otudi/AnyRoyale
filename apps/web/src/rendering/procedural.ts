import * as THREE from 'three';
import type { ProcShape } from './visualCatalog';

/** Animation inputs for procedural models. */
export interface ProcState {
  t: number; // seconds
  moving: number; // 0..1 movement speed factor
  attack: number; // 0..1 attack swing phase (0 when idle)
  frozen: boolean;
}

export interface ProcModel {
  root: THREE.Group;
  /** Height of the model's top, for HP bars. */
  top: number;
  flying: boolean;
  animate(s: ProcState): void;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: number, opts: { emissive?: number; rough?: number; metal?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.emissive ?? 0}|${opts.rough ?? 0.75}|${opts.metal ?? 0}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissive ? 0.9 : 0,
      roughness: opts.rough ?? 0.75,
      metalness: opts.metal ?? 0,
      flatShading: true,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

const sphere = (r = 1, d = 1) => geo(`s${d}`, () => new THREE.IcosahedronGeometry(r, d));
const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const cone = (seg = 6) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg));
const cyl = (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg));
const wingGeo = () =>
  geo('wing', () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1, 0.35);
    shape.lineTo(0.85, -0.1);
    shape.lineTo(0.55, -0.25);
    shape.lineTo(0.25, -0.2);
    shape.lineTo(0, 0);
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  });

function part(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function rot(m: THREE.Mesh, axis: 'x' | 'y' | 'z', v: number): THREE.Mesh {
  m.rotation[axis] = v;
  return m;
}

function eyes(parent: THREE.Object3D, y: number, z: number, spread: number, size: number, color = 0xffffff): void {
  for (const sx of [-1, 1]) {
    parent.add(part(sphere(1, 0), mat(color, { emissive: color === 0xffffff ? 0 : color }), size, size, size, sx * spread, y, z));
    parent.add(part(sphere(1, 0), mat(0x111111), size * 0.5, size * 0.5, size * 0.5, sx * spread, y, z + size * 0.7));
  }
}

function wings(body: THREE.Object3D, color: number, span: number, y: number, membrane = true): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, y, 0);
    const w = new THREE.Mesh(wingGeo(), mat(color, { opacity: membrane ? 0.95 : 1 }));
    (w.material as THREE.Material).side = THREE.DoubleSide;
    w.scale.set(span * side, 1, span * 0.9);
    w.castShadow = true;
    pivot.add(w);
    body.add(pivot);
    out.push(pivot);
  }
  return out;
}

function flap(ws: THREE.Object3D[], t: number, speed: number, amp: number): void {
  const a = Math.sin(t * speed) * amp;
  ws.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * a));
}

/** Builds a procedural model; {@code height} is the target height in world units (tiles). */
export function buildProc(shape: ProcShape, height: number, color = 0x888888, color2 = 0xffcc66): ProcModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const c = color;
  const c2 = color2;
  let flying = false;
  let animate: (s: ProcState) => void = () => {};
  let top = height;

  switch (shape) {
    case 'minion':
    case 'megaminion': {
      flying = true;
      const big = shape === 'megaminion';
      body.add(part(sphere(1, 1), mat(c), 0.35, 0.4, 0.32, 0, 0.45, 0));
      const head = part(sphere(1, 1), mat(c), 0.27, 0.25, 0.25, 0, 0.92, 0.05);
      body.add(head);
      for (const sx of [-1, 1]) body.add(part(cone(), mat(0xe8e0c0), 0.06, 0.18, 0.06, sx * 0.15, 1.15, 0.05));
      eyes(head, 0.02, 0.18, 0.1, 0.05, 0xfff066);
      if (big) {
        body.add(part(box(), mat(c2, { metal: 0.5, rough: 0.4 }), 0.75, 0.3, 0.6, 0, 0.55, 0));
        body.add(part(sphere(1, 0), mat(c2, { metal: 0.6 }), 0.32, 0.22, 0.3, 0, 1.0, 0.04));
      }
      const ws = wings(body, shade(c, 0.8), big ? 0.9 : 0.75, 0.6);
      for (const sx of [-1, 1]) body.add(part(sphere(1, 0), mat(c), 0.09, 0.2, 0.09, sx * 0.25, 0.25, 0.15));
      animate = (s) => {
        flap(ws, s.t, s.frozen ? 0 : 14, 0.6);
        body.position.y = Math.sin(s.t * 3) * 0.05;
        body.rotation.x = s.attack > 0 ? Math.sin(s.attack * Math.PI) * 0.5 : 0;
      };
      top = 1.3;
      break;
    }
    case 'bat': {
      flying = true;
      body.add(part(sphere(1, 0), mat(c), 0.22, 0.22, 0.25, 0, 0.5, 0));
      for (const sx of [-1, 1]) body.add(part(cone(4), mat(c), 0.06, 0.15, 0.06, sx * 0.1, 0.72, 0));
      eyes(body, 0.55, 0.18, 0.07, 0.035, 0xff4040);
      const ws = wings(body, shade(c, 0.7), 0.7, 0.5);
      animate = (s) => {
        flap(ws, s.t, s.frozen ? 0 : 20, 0.8);
        body.position.y = Math.sin(s.t * 6) * 0.06;
      };
      top = 0.9;
      break;
    }
    case 'dragon': {
      flying = true;
      const torso = part(sphere(1, 1), mat(c), 0.42, 0.38, 0.55, 0, 0.55, 0);
      body.add(torso);
      body.add(part(sphere(1, 1), mat(c2), 0.3, 0.26, 0.45, 0, 0.45, 0.06));
      const neck = new THREE.Group();
      neck.position.set(0, 0.75, 0.35);
      body.add(neck);
      neck.add(part(sphere(1, 1), mat(c), 0.3, 0.27, 0.36, 0, 0.12, 0.12));
      neck.add(part(box(), mat(c), 0.24, 0.14, 0.28, 0, 0.05, 0.38));
      for (const sx of [-1, 1]) neck.add(part(cone(5), mat(c2), 0.05, 0.22, 0.05, sx * 0.13, 0.36, 0.0));
      eyes(neck, 0.2, 0.32, 0.12, 0.05, 0xffffff);
      body.add(rot(part(cone(6), mat(c), 0.12, 0.6, 0.12, 0, 0.45, -0.6), 'x', -Math.PI / 2.3));
      const ws = wings(body, shade(c2, 0.95), 1.0, 0.75);
      for (const sx of [-1, 1]) body.add(part(cyl(6), mat(c), 0.07, 0.25, 0.07, sx * 0.22, 0.2, 0.1));
      animate = (s) => {
        flap(ws, s.t, s.frozen ? 0 : 7, 0.55);
        body.position.y = Math.sin(s.t * 2.5) * 0.06;
        neck.rotation.x = s.attack > 0 ? -Math.sin(s.attack * Math.PI) * 0.45 : Math.sin(s.t * 2) * 0.05;
      };
      top = 1.3;
      break;
    }
    case 'phoenix': {
      flying = true;
      body.add(part(sphere(1, 1), mat(c, { emissive: c }), 0.3, 0.32, 0.45, 0, 0.6, 0));
      const head = part(sphere(1, 1), mat(c2, { emissive: c2 }), 0.2, 0.2, 0.2, 0, 0.92, 0.3);
      body.add(head);
      head.add(rot(part(cone(4), mat(0xffe080), 0.3, 0.6, 0.3, 0, 0, 1.0), 'x', Math.PI / 2));
      for (let i = 0; i < 3; i++) body.add(rot(part(cone(4), mat(c2, { emissive: c }), 0.08, 0.6, 0.08, (i - 1) * 0.1, 0.55, -0.55), 'x', -1.2));
      const ws = wings(body, c2, 1.0, 0.7, false);
      animate = (s) => {
        flap(ws, s.t, s.frozen ? 0 : 8, 0.65);
        body.position.y = Math.sin(s.t * 2.2) * 0.07;
      };
      top = 1.3;
      break;
    }
    case 'hound':
    case 'pup': {
      flying = true;
      const big = shape === 'hound';
      const s = big ? 1 : 0.45;
      body.add(part(sphere(1, 1), mat(c, { rough: 1 }), 0.75 * s, 0.6 * s, 0.9 * s, 0, 0.7 * s + 0.3, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        body.add(part(sphere(1, 0), mat(c2, { emissive: c2 }), 0.12 * s, 0.12 * s, 0.12 * s, Math.cos(a) * 0.55 * s, 0.75 * s + 0.3, Math.sin(a) * 0.65 * s));
      }
      const head = part(sphere(1, 1), mat(c, { rough: 1 }), 0.42 * s, 0.38 * s, 0.42 * s, 0, 0.95 * s + 0.3, 0.75 * s);
      body.add(head);
      eyes(head, 0.15, 0.32, 0.18, 0.08, 0xffa020);
      const ws = wings(body, shade(c, 0.8), 1.1 * s + 0.2, 0.9 * s + 0.3);
      animate = (st) => {
        flap(ws, st.t, st.frozen ? 0 : big ? 4 : 10, 0.4);
        body.position.y = Math.sin(st.t * 1.6) * 0.08;
      };
      top = big ? 1.9 : 1.0;
      break;
    }
    case 'balloon':
    case 'skelballoon': {
      flying = true;
      const isSkel = shape === 'skelballoon';
      const env = part(sphere(1, 2), mat(isSkel ? 0xd8d0b8 : c), isSkel ? 0.55 : 0.75, isSkel ? 0.65 : 0.85, isSkel ? 0.55 : 0.75, 0, 1.55, 0);
      body.add(env);
      if (!isSkel) {
        for (let i = 0; i < 6; i++) {
          const stripe = part(sphere(1, 2), mat(0xf0e0b0), 0.77, 0.86, 0.12, 0, 1.55, 0);
          stripe.rotation.y = (i / 6) * Math.PI;
          body.add(stripe);
        }
      }
      body.add(part(cyl(6), mat(isSkel ? c : c2), 0.32, 0.35, 0.32, 0, 0.45, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const rope = part(cyl(3), mat(0x5a4a30), 0.015, 0.75, 0.015, sx * 0.25, 0.95, sz * 0.25);
        body.add(rope);
      }
      body.add(part(sphere(1, 1), mat(0xe8e2d0), 0.15, 0.15, 0.15, 0, 0.75, 0));
      const bomb = part(sphere(1, 1), mat(0x222222, { metal: 0.3 }), 0.2, 0.2, 0.2, 0, 0.2, 0);
      body.add(bomb);
      animate = (s) => {
        body.position.y = Math.sin(s.t * 1.8) * 0.08;
        body.rotation.z = Math.sin(s.t * 1.1) * 0.05;
        bomb.position.y = s.attack > 0 ? 0.2 - s.attack * 0.4 : 0.2;
      };
      top = 2.4;
      break;
    }
    case 'flyingmachine': {
      flying = true;
      body.add(rot(part(cyl(8), mat(c), 0.35, 0.9, 0.35, 0, 0.6, 0), 'x', Math.PI / 2));
      const rotor = new THREE.Group();
      rotor.position.set(0, 1.1, 0);
      body.add(rotor);
      for (let i = 0; i < 3; i++) {
        const blade = part(box(), mat(c2, { metal: 0.6 }), 1.4, 0.03, 0.12, 0, 0, 0);
        blade.rotation.y = (i / 3) * Math.PI;
        rotor.add(blade);
      }
      body.add(part(cyl(6), mat(0x555555), 0.04, 0.4, 0.04, 0, 0.9, 0));
      body.add(part(sphere(1, 1), mat(0x9fdc6a), 0.16, 0.16, 0.16, 0, 0.95, -0.15));
      animate = (s) => {
        rotor.rotation.y += s.frozen ? 0 : 0.6;
        body.position.y = Math.sin(s.t * 3) * 0.05;
      };
      top = 1.3;
      break;
    }
    case 'mergemount': {
      flying = true;
      body.add(part(sphere(1, 1), mat(c), 0.4, 0.3, 0.6, 0, 0.6, 0));
      body.add(part(sphere(1, 1), mat(c), 0.22, 0.22, 0.25, 0, 0.8, 0.5));
      const ws = wings(body, c2, 1.0, 0.75);
      body.add(part(sphere(1, 1), mat(0xffe0f0), 0.18, 0.4, 0.18, 0, 1.15, 0));
      animate = (s) => {
        flap(ws, s.t, s.frozen ? 0 : 6, 0.5);
        body.position.y = Math.sin(s.t * 2) * 0.06;
      };
      top = 1.5;
      break;
    }
    case 'golem':
    case 'golemite':
    case 'icegolem': {
      const rockMat = mat(c, { rough: 1 });
      const torso = part(geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)), rockMat, 0.55, 0.5, 0.45, 0, 1.0, 0);
      body.add(torso);
      const head = part(geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)), rockMat, 0.28, 0.25, 0.26, 0, 1.6, 0.05);
      body.add(head);
      eyes(head, 0.05, 0.22, 0.11, 0.06, shape === 'icegolem' ? 0x60c8ff : 0x9fe06a);
      const arms: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(sx * 0.62, 1.25, 0);
        arm.add(part(geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)), rockMat, 0.22, 0.45, 0.22, 0, -0.35, 0));
        arm.add(part(geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)), rockMat, 0.26, 0.24, 0.26, 0, -0.8, 0.05));
        body.add(arm);
        arms.push(arm);
      }
      const legs: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const leg = part(geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)), rockMat, 0.22, 0.3, 0.22, sx * 0.25, 0.32, 0);
        body.add(leg);
        legs.push(leg);
      }
      if (shape === 'icegolem') rockMat.emissive = new THREE.Color(0x205080);
      animate = (s) => {
        const w = s.frozen ? 0 : s.t * 4;
        legs[0].position.z = Math.sin(w) * 0.12 * s.moving;
        legs[1].position.z = -Math.sin(w) * 0.12 * s.moving;
        body.rotation.z = Math.sin(w) * 0.04 * s.moving;
        const swing = s.attack > 0 ? Math.sin(s.attack * Math.PI) : 0;
        arms[0].rotation.x = -swing * 1.4 + Math.sin(w) * 0.2 * s.moving;
        arms[1].rotation.x = -swing * 1.4 - Math.sin(w) * 0.2 * s.moving;
      };
      top = 1.85;
      break;
    }
    case 'elixirblob': {
      const m = mat(c, { emissive: shade(c, 0.4), rough: 0.25, opacity: 0.9 });
      const blob = part(sphere(1, 2), m, 0.55, 0.5, 0.55, 0, 0.5, 0);
      body.add(blob);
      body.add(part(sphere(1, 1), mat(0xffd0ff, { emissive: 0xff60ff }), 0.18, 0.18, 0.18, 0, 0.62, 0.1));
      eyes(body, 0.72, 0.42, 0.15, 0.07);
      animate = (s) => {
        const sq = Math.sin(s.t * 6) * 0.06 * (s.frozen ? 0 : 1);
        blob.scale.set(0.55 + sq, 0.5 - sq, 0.55 + sq);
      };
      top = 1.1;
      break;
    }
    case 'spirit': {
      const m = mat(c, { emissive: c, rough: 0.4 });
      const orb = part(sphere(1, 1), m, 0.32, 0.32, 0.32, 0, 0.45, 0);
      body.add(orb);
      for (let i = 0; i < 4; i++) body.add(part(cone(4), m, 0.08, 0.25, 0.08, Math.cos(i * 1.6) * 0.2, 0.75, Math.sin(i * 1.6) * 0.15));
      eyes(orb, 0.1, 0.8, 0.35, 0.18);
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 9)) * 0.18 * (s.frozen ? 0 : 1);
      };
      top = 0.9;
      break;
    }
    case 'icespirit': {
      // a round snowball with a crown of icicles and a snowflake on its belly
      const snow = mat(c, { rough: 0.55 });
      const orb = part(sphere(1, 2), snow, 0.34, 0.31, 0.34, 0, 0.42, 0);
      body.add(orb);
      const ice = mat(0x8fdcff, { emissive: 0x3aa8ff, rough: 0.2, opacity: 0.92 });
      const spikes: [number, number, number, number][] = [
        [0, 0.78, 0, 0.32],
        [0.16, 0.7, 0.05, 0.24],
        [-0.16, 0.7, 0.05, 0.24],
        [0.08, 0.7, -0.15, 0.22],
        [-0.08, 0.7, -0.15, 0.22],
      ];
      for (const [x, y, z, h] of spikes) {
        const sp = part(geo('oct', () => new THREE.OctahedronGeometry(1, 0)), ice, 0.07, h, 0.07, x, y, z);
        sp.rotation.z = -x * 1.6;
        sp.rotation.x = z * 1.4;
        body.add(sp);
      }
      const flake = new THREE.Group();
      flake.position.set(0, 0.4, 0.33);
      for (let i = 0; i < 3; i++) {
        const arm = part(box(), mat(0x9fe4ff, { emissive: 0x58c0ff }), 0.03, 0.22, 0.02);
        arm.rotation.z = (i * Math.PI) / 3;
        flake.add(arm);
      }
      body.add(flake);
      for (const sx of [-1, 1]) body.add(part(sphere(1, 0), mat(0x9fd8ff), 0.05, 0.04, 0.02, sx * 0.2, 0.43, 0.29));
      eyes(orb, 0.2, 0.82, 0.32, 0.17, 0x1f5fb0);
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 9)) * 0.18 * (s.frozen ? 0 : 1);
        flake.rotation.z = s.t * 1.5;
      };
      top = 1.0;
      break;
    }
    case 'electrospirit': {
      // a dark-blue charged orb with a yellow lightning bolt on top and orbiting sparks
      const orb = part(sphere(1, 1), mat(c, { emissive: 0x2238b0, rough: 0.35 }), 0.3, 0.3, 0.3, 0, 0.45, 0);
      body.add(orb);
      const bolt = mat(0xfff060, { emissive: 0xffd000, rough: 0.3 });
      const zig: [number, number, number][] = [
        [0.02, 0.8, 0.5],
        [-0.04, 0.95, -0.6],
        [0.04, 1.08, 0.5],
      ];
      for (const [x, y, r] of zig) {
        const seg = part(box(), bolt, 0.06, 0.2, 0.06, x, y, 0);
        seg.rotation.z = r;
        body.add(seg);
      }
      body.add(part(cone(4), bolt, 0.07, 0.14, 0.07, 0.08, 1.2, 0));
      const sparks = new THREE.Group();
      sparks.position.y = 0.45;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        sparks.add(part(sphere(1, 0), mat(0xfff7a0, { emissive: 0xfff000 }), 0.06, 0.06, 0.06, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45));
      }
      body.add(sparks);
      eyes(orb, 0.08, 0.82, 0.34, 0.17, 0xfff060);
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 9)) * 0.18 * (s.frozen ? 0 : 1);
        sparks.rotation.y = s.t * 5;
        sparks.rotation.x = Math.sin(s.t * 3) * 0.4;
      };
      top = 1.1;
      break;
    }
    case 'healspirit': {
      const m = mat(c, { emissive: 0xffb000, rough: 0.4 });
      const orb = part(sphere(1, 1), m, 0.3, 0.3, 0.3, 0, 0.45, 0);
      body.add(orb);
      const halo = part(geo('halo', () => new THREE.TorusGeometry(1, 0.12, 6, 18)), mat(0xfff4b0, { emissive: 0xffe060 }), 0.2, 0.2, 0.2, 0, 0.88, 0);
      halo.rotation.x = Math.PI / 2;
      body.add(halo);
      const plus = mat(0x40d860, { emissive: 0x20a040 });
      body.add(part(box(), plus, 0.16, 0.05, 0.03, 0, 0.36, 0.3));
      body.add(part(box(), plus, 0.05, 0.16, 0.03, 0, 0.36, 0.3));
      eyes(orb, 0.12, 0.82, 0.34, 0.17);
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 9)) * 0.18 * (s.frozen ? 0 : 1);
      };
      top = 0.95;
      break;
    }
    case 'hog':
    case 'ram': {
      const isHog = shape === 'hog';
      const hide = mat(c, { rough: 0.9 });
      const torso = part(sphere(1, 1), hide, 0.42, 0.38, 0.65, 0, 0.62, 0);
      body.add(torso);
      const head = new THREE.Group();
      head.position.set(0, 0.72, 0.62);
      body.add(head);
      head.add(part(sphere(1, 1), hide, 0.27, 0.25, 0.3, 0, 0, 0.05));
      if (isHog) {
        head.add(rot(part(cyl(8), mat(0xe8a090), 0.12, 0.1, 0.12, 0, -0.04, 0.33), 'x', Math.PI / 2));
        for (const sx of [-1, 1]) head.add(part(cone(4), mat(0xffffff), 0.03, 0.14, 0.03, sx * 0.12, -0.05, 0.3));
      } else {
        for (const sx of [-1, 1]) {
          const horn = part(geo('torus', () => new THREE.TorusGeometry(1, 0.35, 5, 8, Math.PI * 1.4)), mat(0xa08a60), 0.13, 0.13, 0.13, sx * 0.2, 0.12, -0.02);
          horn.rotation.y = Math.PI / 2;
          head.add(horn);
        }
      }
      eyes(head, 0.08, 0.24, 0.12, 0.04);
      const legs: THREE.Mesh[] = [];
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const leg = part(cyl(6), mat(shade(c, 0.75)), 0.08, 0.35, 0.08, sx * 0.22, 0.2, sz * 0.38);
        body.add(leg);
        legs.push(leg);
      }
      animate = (s) => {
        const w = s.frozen ? 0 : s.t * 14;
        legs.forEach((l, i) => (l.rotation.x = Math.sin(w + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * s.moving));
        body.position.y = Math.abs(Math.sin(w)) * 0.05 * s.moving;
        head.rotation.x = s.attack > 0 ? Math.sin(s.attack * Math.PI) * 0.4 : 0;
      };
      top = 1.15;
      break;
    }
    case 'batteringram': {
      const log = part(cyl(10), mat(c, { rough: 1 }), 0.28, 1.6, 0.28, 0, 0.55, 0);
      log.rotation.x = Math.PI / 2;
      body.add(log);
      body.add(rot(part(cyl(10), mat(0x888888, { metal: 0.6 }), 0.3, 0.2, 0.3, 0, 0.55, 0.8), 'x', Math.PI / 2));
      for (const sx of [-1, 1]) {
        body.add(part(sphere(1, 1), mat(0xd8a070), 0.18, 0.28, 0.18, sx * 0.4, 0.55, -0.1));
        body.add(part(sphere(1, 1), mat(0xffd0a0), 0.14, 0.14, 0.14, sx * 0.4, 0.95, -0.1));
      }
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 12)) * 0.05 * s.moving;
      };
      top = 1.1;
      break;
    }
    case 'sparky':
    case 'zappy':
    case 'machine': {
      const big = shape !== 'zappy';
      const base = part(box(), mat(c, { rough: 0.8 }), big ? 1.0 : 0.6, 0.35, big ? 1.2 : 0.6, 0, 0.45, 0);
      body.add(base);
      const wheels: THREE.Mesh[] = [];
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const wh = part(cyl(10), mat(0x4a3a2a), 0.22, 0.12, 0.22, sx * (big ? 0.55 : 0.35), 0.22, sz * (big ? 0.4 : 0.22));
        wh.rotation.z = Math.PI / 2;
        body.add(wh);
        wheels.push(wh);
      }
      let coil: THREE.Object3D | null = null;
      if (shape === 'machine') {
        body.add(part(box(), mat(c2, { metal: 0.5, rough: 0.4 }), 0.7, 0.7, 0.6, 0, 1.0, 0));
        body.add(rot(part(cyl(8), mat(0x777777, { metal: 0.7 }), 0.12, 0.8, 0.12, 0.35, 1.2, 0.3), 'x', Math.PI / 3));
        body.add(part(sphere(1, 1), mat(0x9fdc6a), 0.2, 0.2, 0.2, 0, 1.55, -0.1));
      } else {
        coil = new THREE.Group();
        coil.position.set(0, big ? 0.9 : 0.75, 0);
        for (let i = 0; i < 4; i++) {
          coil.add(rot(part(geo('torusc', () => new THREE.TorusGeometry(1, 0.18, 6, 14)), mat(0xb08a50, { metal: 0.8, rough: 0.3 }), big ? 0.32 : 0.2, big ? 0.32 : 0.2, big ? 0.32 : 0.2, 0, i * 0.12, 0), 'x', Math.PI / 2));
        }
        coil.add(part(sphere(1, 1), mat(c2, { emissive: c2 }), big ? 0.25 : 0.15, big ? 0.25 : 0.15, big ? 0.25 : 0.15, 0, big ? 0.65 : 0.5, 0));
        body.add(coil);
      }
      animate = (s) => {
        for (const w of wheels) w.rotation.x += s.frozen ? 0 : 0.25 * s.moving;
        if (coil) {
          const orb = coil.children[coil.children.length - 1] as THREE.Mesh;
          const charge = s.attack > 0 ? 1 + Math.sin(s.attack * Math.PI) * 0.6 : 1;
          orb.scale.setScalar((big ? 0.25 : 0.15) * charge);
        }
      };
      top = big ? 1.7 : 1.2;
      break;
    }
    case 'furnace': {
      body.add(part(cyl(8), mat(c, { rough: 1 }), 0.55, 1.0, 0.55, 0, 0.9, 0));
      body.add(part(cone(8), mat(shade(c, 0.8)), 0.6, 0.4, 0.6, 0, 1.6, 0));
      const fire = part(sphere(1, 1), mat(c2, { emissive: c2 }), 0.25, 0.2, 0.08, 0, 0.8, 0.52);
      body.add(fire);
      const legs: THREE.Mesh[] = [];
      for (const sx of [-1, 1]) {
        const leg = part(cyl(6), mat(0x4a3a2a), 0.1, 0.4, 0.1, sx * 0.3, 0.2, 0);
        body.add(leg);
        legs.push(leg);
      }
      animate = (s) => {
        const w = s.frozen ? 0 : s.t * 8;
        legs[0].rotation.x = Math.sin(w) * 0.5 * s.moving;
        legs[1].rotation.x = -Math.sin(w) * 0.5 * s.moving;
        fire.scale.setScalar(0.22 + Math.sin(s.t * 20) * 0.03);
      };
      top = 1.85;
      break;
    }
    case 'egg': {
      const egg = part(sphere(1, 2), mat(c, { emissive: shade(c, 0.5) }), 0.32, 0.42, 0.32, 0, 0.42, 0);
      body.add(egg);
      animate = (s) => {
        egg.rotation.z = Math.sin(s.t * 8) * 0.12;
      };
      top = 0.9;
      break;
    }
    case 'bomb': {
      const b = part(sphere(1, 1), mat(c, { metal: 0.4, rough: 0.5 }), 0.3, 0.3, 0.3, 0, 0.3, 0);
      body.add(b);
      const spark = part(sphere(1, 0), mat(0xffd040, { emissive: 0xff8020 }), 0.08, 0.08, 0.08, 0, 0.66, 0);
      body.add(spark);
      animate = (s) => {
        spark.scale.setScalar(0.06 + Math.abs(Math.sin(s.t * 25)) * 0.06);
        b.scale.setScalar(0.3 + Math.abs(Math.sin(s.t * 6)) * 0.03);
      };
      top = 0.8;
      break;
    }
    case 'bottle': {
      body.add(part(sphere(1, 1), mat(c, { emissive: shade(c, 0.5), opacity: 0.85 }), 0.25, 0.28, 0.25, 0, 0.3, 0));
      body.add(part(cyl(6), mat(0xa08060), 0.08, 0.22, 0.08, 0, 0.62, 0));
      top = 0.8;
      break;
    }
    case 'barrel': {
      body.add(part(cyl(10), mat(c, { rough: 1 }), 0.35, 0.6, 0.35, 0, 0.35, 0));
      for (const y of [0.15, 0.55]) body.add(part(cyl(10), mat(0x555555, { metal: 0.6 }), 0.36, 0.06, 0.36, 0, y, 0));
      top = 0.8;
      break;
    }
    case 'crate': {
      body.add(part(box(), mat(c, { rough: 1 }), 0.8, 0.8, 0.8, 0, 0.4, 0));
      top = 0.9;
      break;
    }
    case 'bush': {
      for (let i = 0; i < 5; i++) {
        body.add(part(sphere(1, 1), mat(shade(c, 0.85 + i * 0.05)), 0.4, 0.38, 0.4, Math.cos(i * 1.3) * 0.25, 0.35 + (i % 2) * 0.15, Math.sin(i * 1.3) * 0.2));
      }
      animate = (s) => {
        body.position.y = Math.abs(Math.sin(s.t * 10)) * 0.05 * s.moving;
      };
      top = 0.9;
      break;
    }
    case 'drillmound': {
      body.add(part(sphere(1, 1), mat(c, { rough: 1 }), 0.55, 0.25, 0.55, 0, 0.05, 0));
      animate = (s) => {
        body.rotation.y = s.t * 4;
      };
      top = 0.4;
      break;
    }
  }

  // Normalise to the requested height (models are authored roughly 1.5 units tall).
  const authored = top;
  const scale = height / authored;
  body.scale.setScalar(scale);
  return { root, top: height, flying, animate };
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Procedural mount (hog / horse / ram) under a rider. */
export function buildMount(kind: 'hog' | 'horse' | 'ram'): ProcModel {
  if (kind === 'horse') {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hide = mat(0x6a4a30, { rough: 0.9 });
    body.add(part(sphere(1, 1), hide, 0.32, 0.32, 0.62, 0, 0.75, 0));
    const neck = new THREE.Group();
    neck.position.set(0, 0.9, 0.5);
    body.add(neck);
    neck.add(rot(part(cyl(6), hide, 0.13, 0.5, 0.13, 0, 0.18, 0.08), 'x', 0.6));
    neck.add(part(box(), hide, 0.18, 0.18, 0.42, 0, 0.4, 0.3));
    neck.add(part(box(), mat(0x2a1a10), 0.04, 0.2, 0.3, 0, 0.45, 0.05));
    const legs: THREE.Mesh[] = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const leg = part(cyl(6), mat(0x4a3020), 0.06, 0.55, 0.06, sx * 0.18, 0.3, sz * 0.42);
      body.add(leg);
      legs.push(leg);
    }
    body.add(rot(part(cone(5), mat(0x2a1a10), 0.08, 0.5, 0.08, 0, 0.75, -0.7), 'x', -2.4));
    return {
      root,
      top: 1.1,
      flying: false,
      animate: (s) => {
        const w = s.frozen ? 0 : s.t * 12;
        legs.forEach((l, i) => (l.rotation.x = Math.sin(w + (i % 2 ? Math.PI : 0)) * 0.55 * s.moving));
        body.position.y = Math.abs(Math.sin(w)) * 0.06 * s.moving;
      },
    };
  }
  return buildProc(kind === 'hog' ? 'hog' : 'ram', 1.0, kind === 'hog' ? 0xd88a6a : 0xe8e0d0);
}
