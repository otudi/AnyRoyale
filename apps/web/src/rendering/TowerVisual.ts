import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { mergeStatic } from './mergeStatic';
import { towerTopCharacter, type Side, UnitVisual } from './UnitFactory';

/**
 * Princess tower (3x3 tiles) or King tower (4x4 tiles) in the reference game's proportions: a
 * short round stone tower with a battlement and team banner for princesses, a wide square fortress
 * with four team-roofed turrets for the king. Built from primitives (our own geometry) and merged
 * into a few draw calls, with an animated character on top: an archer on princess towers and the
 * king on the king tower. The king sleeps until the server reports the tower active.
 */
export class TowerVisual {
  readonly root = new THREE.Group();
  readonly top: UnitVisual;
  private building: THREE.Object3D | null = null;
  private ruins: THREE.Object3D | null = null;
  height: number;
  destroyed = false;
  private active = true;
  private zzz: THREE.Sprite | null = null;
  private time = 0;

  constructor(
    readonly kind: 'K' | 'P',
    readonly side: Side,
  ) {
    const team = side === 'own' ? 0x2f7fe8 : 0xe23b3b;
    const b = kind === 'K' ? buildKingTower(team) : buildPrincessTower(team);
    mergeStatic(b.group);
    b.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    // Drawn smaller than their footprint so troops keep their scale next to them (the engine's
    // tower size, targeting and collision are unchanged): slimmer bases, the king's keep stays the
    // largest building on the field.
    const sxz = kind === 'K' ? 0.8 : 0.72;
    const sy = kind === 'K' ? 0.86 : 0.8;
    b.group.scale.set(sxz, sy, sxz);
    this.root.add(b.group);
    this.building = b.group;
    this.height = b.topY * sy;
    this.top = towerTopCharacter(kind === 'K' ? 'king' : 'archer', side);
    this.top.root.position.y = this.height - (kind === 'K' ? 0.22 : 0.12);
    this.root.add(this.top.root);
  }

  setActive(active: boolean): boolean {
    const woke = !this.active && active;
    this.active = active;
    if (this.kind === 'K') {
      if (!active && !this.zzz) {
        this.zzz = makeZzz();
        this.zzz.position.set(0.5, this.height + 1.2, 0);
        this.root.add(this.zzz);
      } else if (active && this.zzz) {
        this.zzz.removeFromParent();
        this.zzz.material.map?.dispose();
        this.zzz.material.dispose();
        this.zzz = null;
      }
    }
    return woke;
  }

  update(dt: number, frozen: boolean): void {
    this.time += dt;
    if (this.destroyed) return;
    this.top.update(dt, 0, { frozen });
    if (this.zzz) {
      this.zzz.position.y = this.height + 1.2 + Math.sin(this.time * 2) * 0.15;
      this.zzz.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.3;
    }
  }

  /** Turns the archer/king towards a world point. */
  face(target: THREE.Vector3): void {
    const local = this.root.worldToLocal(target.clone());
    this.top.root.rotation.y = Math.atan2(local.x, local.z);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.top.root.visible = false;
    if (this.building) this.building.visible = false;
    if (this.zzz) this.zzz.visible = false;
    const src = assets.node('env_core.glb', 'ruins') ?? assets.node('props_dungeon.glb', 'rubble');
    if (src) {
      const r = src.clone();
      const box = new THREE.Box3().setFromObject(r);
      const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 0.01);
      r.scale.multiplyScalar((this.kind === 'K' ? 3.0 : 2.2) / w);
      const box2 = new THREE.Box3().setFromObject(r);
      r.position.y -= box2.min.y - 0.25;
      this.root.add(r);
      this.ruins = r;
    }
  }

  dispose(): void {
    this.top.dispose();
    this.root.removeFromParent();
    void this.ruins;
  }
}

function makeZzz(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillStyle = '#e8f0ff';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 5;
  g.textAlign = 'center';
  g.strokeText('z z Z', 64, 44);
  g.fillText('z z Z', 64, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(1.4, 0.7, 1);
  return s;
}

// --- Procedural tower geometry --------------------------------------------------------------------

const MATS = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = MATS.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    MATS.set(color, m);
  }
  return m;
}

const STONE = 0xa89c82;
const STONE_DARK = 0x887c66;
const STONE_LIGHT = 0xc2b59a;
const WOOD = 0x8a5a32;

function put(g: THREE.Group, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  g.add(m);
  return m;
}

function battlement(g: THREE.Group, radius: number, y: number, count: number, size: number): void {
  const geo = new THREE.BoxGeometry(size, size * 0.9, size * 0.7);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    put(g, geo, STONE_LIGHT, Math.sin(a) * radius, y, Math.cos(a) * radius, a);
  }
}

function buildPrincessTower(team: number): { group: THREE.Group; topY: number } {
  const g = new THREE.Group();
  // square plinth on the 3x3 footprint
  put(g, new THREE.BoxGeometry(3.0, 0.3, 3.0), STONE_DARK, 0, 0.15, 0);
  put(g, new THREE.BoxGeometry(2.7, 0.18, 2.7), STONE, 0, 0.39, 0);
  // round body, slightly tapered, with two darker courses
  put(g, new THREE.CylinderGeometry(1.08, 1.22, 1.9, 10), STONE, 0, 1.43, 0);
  put(g, new THREE.CylinderGeometry(1.25, 1.25, 0.14, 10), STONE_DARK, 0, 0.9, 0);
  put(g, new THREE.CylinderGeometry(1.14, 1.14, 0.12, 10), STONE_DARK, 0, 1.75, 0);
  // team-coloured band under the parapet
  put(g, new THREE.CylinderGeometry(1.32, 1.12, 0.32, 10), team, 0, 2.48, 0);
  // parapet platform + crenellations
  put(g, new THREE.CylinderGeometry(1.42, 1.32, 0.26, 10), STONE_LIGHT, 0, 2.77, 0);
  battlement(g, 1.3, 3.05, 8, 0.36);
  // banner on the front (towards the river) and the door at the back
  put(g, new THREE.BoxGeometry(0.62, 0.9, 0.06), team, 0, 1.55, 1.2);
  put(g, new THREE.BoxGeometry(0.66, 0.1, 0.08), WOOD, 0, 2.03, 1.2);
  put(g, new THREE.BoxGeometry(0.5, 0.7, 0.08), WOOD, 0, 0.82, -1.18);
  return { group: g, topY: 2.92 };
}

function buildKingTower(team: number): { group: THREE.Group; topY: number } {
  const g = new THREE.Group();
  put(g, new THREE.BoxGeometry(4.1, 0.3, 4.1), STONE_DARK, 0, 0.15, 0);
  // square keep
  put(g, new THREE.BoxGeometry(3.3, 1.8, 3.3), STONE, 0, 1.2, 0);
  put(g, new THREE.BoxGeometry(3.45, 0.14, 3.45), STONE_DARK, 0, 0.72, 0);
  put(g, new THREE.BoxGeometry(3.6, 0.26, 3.6), STONE_LIGHT, 0, 2.2, 0);
  // crenellations along the edges
  const merlon = new THREE.BoxGeometry(0.36, 0.34, 0.36);
  for (let i = -2; i <= 2; i++) {
    if (Math.abs(i) === 2) continue;
    const o = i * 0.7;
    put(g, merlon, STONE_LIGHT, o, 2.5, 1.62);
    put(g, merlon, STONE_LIGHT, o, 2.5, -1.62);
    put(g, merlon, STONE_LIGHT, 1.62, 2.5, o);
    put(g, merlon, STONE_LIGHT, -1.62, 2.5, o);
  }
  // four corner turrets with team roofs
  const turret = new THREE.CylinderGeometry(0.5, 0.56, 2.7, 8);
  const roof = new THREE.ConeGeometry(0.66, 0.85, 8);
  for (const x of [-1.62, 1.62]) {
    for (const z of [-1.62, 1.62]) {
      put(g, turret, STONE, x, 1.55, z);
      put(g, roof, team, x, 3.32, z);
    }
  }
  // gate and banners towards the river
  put(g, new THREE.BoxGeometry(0.9, 1.0, 0.08), WOOD, 0, 0.85, 1.68);
  put(g, new THREE.BoxGeometry(0.7, 1.0, 0.06), team, -0.95, 1.45, 1.68);
  put(g, new THREE.BoxGeometry(0.7, 1.0, 0.06), team, 0.95, 1.45, 1.68);
  // the king's cannon
  const barrel = put(g, new THREE.CylinderGeometry(0.16, 0.22, 1.0, 8), 0x3a3a42, 0, 2.62, 0.75);
  barrel.rotation.x = Math.PI / 2.4;
  return { group: g, topY: 2.42 };
}
