import * as THREE from 'three';
import type { CardInfo } from '../network/protocol';
import { TEAM_COLORS, UnitVisual, type Side } from './UnitFactory';
import { visualFor } from './visualCatalog';


interface Marker {
  card: CardInfo;
  side: Side;
  x: number;
  z: number;
  age: number;
  life: number;
  root: THREE.Group;
  timer: THREE.Mesh;
  ghost: UnitVisual | null;
  local: boolean;
}

const SEGMENTS = 32;

/**
 * Shows a play the moment it is made, like the reference game: a translucent silhouette of the
 * unit (or the spell's area) at the drop point with a circular countdown until the units appear.
 * Without it the 1 s server deploy delay looks like the game ignored the drop.
 */
export class PlayMarkers {
  readonly root = new THREE.Group();
  private markers: Marker[] = [];
  private discGeo = new THREE.CircleGeometry(1, SEGMENTS);
  private ringGeo = new THREE.RingGeometry(0.86, 1, SEGMENTS);

  /** @param delay seconds between a play and its units appearing (from matchStart). */
  constructor(private readonly delay = 1.0) {
    this.discGeo.rotateX(-Math.PI / 2);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  /** {@code local}: placed by this client before the server confirmed it. */
  add(card: CardInfo, x: number, z: number, side: Side, local: boolean): void {
    if (!local) {
      // The server echo of a play this client already shows: keep the existing marker.
      const mine = this.markers.find((m) => m.local && m.card.id === card.id && Math.hypot(m.x - x, m.z - z) < 1.5);
      if (mine) {
        mine.local = false;
        return;
      }
    }
    const color = TEAM_COLORS[side];
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const spell = card.type === 'SPELL';
    const radius = spell
      ? Math.max(1, (card.spell?.radius ?? 1000) / 1000)
      : Math.max(1.0, ((card.unit?.radius ?? 500) / 1000) * (card.count > 1 ? 2.4 : 1.6));
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.scale.setScalar(radius);
    ring.position.y = 0.06;
    ring.renderOrder = 3;
    const timer = new THREE.Mesh(this.discGeo.clone(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    timer.scale.setScalar(radius * 0.92);
    timer.position.y = 0.05;
    timer.renderOrder = 3;
    root.add(ring, timer);
    let ghost: UnitVisual | null = null;
    if (!spell && card.unit) {
      const kind = card.type === 'BUILDING' ? 'B' : 'T';
      ghost = new UnitVisual(visualFor(card.unit.name, kind, card.unit.movement === 'AIR' ? 1 : 0, card.unit.radius), side);
      ghost.setOpacity(0.6);
      ghost.root.position.y = card.unit.movement === 'AIR' ? 2 : 0;
      ghost.root.rotation.y = side === 'own' ? Math.PI : 0;
      root.add(ghost.root);
    }
    this.root.add(root);
    this.markers.push({ card, side, x, z, age: 0, life: this.delay + (spell ? 0.25 : 0.6), root, timer, ghost, local });
  }

  /** A real unit appeared: drop the marker it replaces. */
  unitAppeared(side: Side, x: number, z: number): void {
    const i = this.markers.findIndex((m) => m.side === side && m.card.type !== 'SPELL' && m.age > Math.min(0.3, this.delay * 0.5) && Math.hypot(m.x - x, m.z - z) < 3);
    if (i >= 0) this.remove(i);
  }

  /** The server rejected a local play. */
  cancelLocal(cardId: string): void {
    const i = this.markers.findIndex((m) => m.local && m.card.id === cardId);
    if (i >= 0) this.remove(i);
  }

  update(dt: number, cameraQuat: THREE.Quaternion): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.age += dt;
      if (m.age >= m.life) {
        this.remove(i);
        continue;
      }
      // countdown: the filled disc shrinks as a pie until the units land
      const k = Math.min(1, m.age / Math.max(0.05, this.delay));
      const tris = Math.max(1, Math.round(SEGMENTS * (1 - k)));
      m.timer.geometry.setDrawRange(0, tris * 3);
      if (m.ghost) {
        m.ghost.update(dt, 0, { frozen: false });
        m.ghost.root.position.y = (m.card.unit?.movement === 'AIR' ? 2 : 0) + Math.sin(m.age * 6) * 0.05;
      }
      void cameraQuat;
    }
  }

  private remove(i: number): void {
    const m = this.markers[i];
    this.markers.splice(i, 1);
    m.ghost?.dispose();
    m.timer.geometry.dispose();
    for (const c of m.root.children) {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
    }
    m.root.removeFromParent();
  }

  clear(): void {
    while (this.markers.length) this.remove(this.markers.length - 1);
  }

  dispose(): void {
    this.clear();
    this.discGeo.dispose();
    this.ringGeo.dispose();
    this.root.removeFromParent();
  }
}
