import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { towerTopCharacter, type Side, UnitVisual } from './UnitFactory';

/**
 * Princess tower (3x3 tiles) or King tower (4x4 tiles) built from the CC0 medieval kit, with an
 * animated character on top: an archer on princess towers and the king on the king tower. The
 * king sleeps until the server reports the tower active.
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
    const color = side === 'own' ? 'blue' : 'red';
    const key = kind === 'K' ? `castle_${color}` : `tower_${color}`;
    const width = kind === 'K' ? 4.1 : 3.1;
    const src = assets.node('env_core.glb', key);
    let topY = kind === 'K' ? 3.2 : 3.6;
    // Stone base plate matching the footprint
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.62, width * 0.68, 0.35, kind === 'K' ? 8 : 6),
      new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95, flatShading: true }),
    );
    base.position.y = 0.17;
    base.receiveShadow = true;
    base.castShadow = true;
    this.root.add(base);
    if (src) {
      const b = src.clone();
      const box = new THREE.Box3().setFromObject(b);
      const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      const s = (width * (kind === 'K' ? 0.95 : 0.85)) / w;
      b.scale.multiplyScalar(s);
      const box2 = new THREE.Box3().setFromObject(b);
      b.position.y += 0.3 - box2.min.y;
      b.position.x -= (box2.min.x + box2.max.x) / 2;
      b.position.z -= (box2.min.z + box2.max.z) / 2;
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      this.root.add(b);
      this.building = b;
      topY = box2.max.y - box2.min.y + 0.3;
      if (kind === 'P') topY *= 0.86; // archer stands inside the battlement
    } else {
      const fallback = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.4, width * 0.48, topY, 8),
        new THREE.MeshStandardMaterial({ color: side === 'own' ? 0x5a7ac8 : 0xc85a5a }),
      );
      fallback.position.y = topY / 2;
      this.root.add(fallback);
      this.building = fallback;
    }
    this.height = topY;
    this.top = towerTopCharacter(kind === 'K' ? 'king' : 'archer', side);
    this.top.root.position.y = topY - (kind === 'K' ? 0.6 : 0.35);
    this.root.add(this.top.root);
  }

  setActive(active: boolean): boolean {
    const woke = !this.active && active;
    this.active = active;
    if (this.kind === 'K') {
      if (!active && !this.zzz) {
        this.zzz = makeZzz();
        this.zzz.position.set(0.5, this.height + 1.4, 0);
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
      this.zzz.position.y = this.height + 1.4 + Math.sin(this.time * 2) * 0.15;
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
      r.scale.multiplyScalar((this.kind === 'K' ? 3.6 : 2.8) / w);
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
