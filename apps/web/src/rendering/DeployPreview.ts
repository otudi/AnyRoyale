import * as THREE from 'three';
import type { CardInfo } from '../network/protocol';
import { toWorld } from './coords';
import { UnitVisual } from './UnitFactory';
import { visualFor } from './visualCatalog';

/**
 * Drag feedback: red overlay on tiles where the selected card cannot be deployed, a translucent
 * ghost of the unit (or a radius ring for spells) at the snapped position, tinted red when the
 * spot is invalid.
 */
export class DeployPreview {
  readonly root = new THREE.Group();
  private overlay: THREE.Mesh;
  private data = new Uint8Array(18 * 32 * 4);
  private tex: THREE.DataTexture;
  private ring: THREE.Mesh;
  private footprint: THREE.Mesh;
  private ghost: UnitVisual | null = null;
  private ghostCard: string | null = null;
  private time = 0;

  constructor() {
    this.tex = new THREE.DataTexture(this.data, 18, 32, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(18, 32);
    geo.rotateX(-Math.PI / 2);
    this.overlay = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.overlay.position.y = 0.04;
    this.overlay.renderOrder = 2;
    // Plane v grows towards -z (gameY up) — matches DataTexture row order (row 0 = gameY 0).
    this.root.add(this.overlay);
    const ringGeo = new THREE.RingGeometry(0.94, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.position.y = 0.07;
    const fpGeo = new THREE.PlaneGeometry(1, 1);
    fpGeo.rotateX(-Math.PI / 2);
    this.footprint = new THREE.Mesh(fpGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    this.footprint.position.y = 0.06;
    this.root.add(this.ring, this.footprint);
    this.hide();
  }

  showGrid(grid: boolean[][]): void {
    for (let ty = 0; ty < 32; ty++) {
      for (let tx = 0; tx < 18; tx++) {
        const i = (ty * 18 + tx) * 4;
        const ok = grid[ty][tx];
        this.data[i] = 230;
        this.data[i + 1] = 40;
        this.data[i + 2] = 40;
        this.data[i + 3] = ok ? 0 : 70;
      }
    }
    this.tex.needsUpdate = true;
    this.overlay.visible = true;
  }

  /** Positions the ghost; {@code side} 'own' colours it like the player's units. */
  show(card: CardInfo, gx: number, gy: number, valid: boolean): void {
    const p = toWorld(gx, gy);
    const radius = card.spell?.radius ? card.spell.radius / 1000 : card.unit ? Math.max(0.6, card.unit.radius / 1000) : 1;
    this.ring.visible = true;
    this.ring.position.set(p.x, 0.07, p.z);
    this.ring.scale.setScalar(card.type === 'SPELL' ? Math.max(1, radius) : radius + 0.2);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0xffffff : 0xff4040);
    if (card.type === 'BUILDING' && card.unit) {
      const size = Math.ceil((card.unit.radius * 2) / 1000 - 0.001);
      this.footprint.visible = true;
      this.footprint.position.set(p.x, 0.06, p.z);
      this.footprint.scale.set(size, 1, size);
      (this.footprint.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0xffffff : 0xff4040);
    } else {
      this.footprint.visible = false;
    }
    if (card.type !== 'SPELL' && card.unit) {
      if (this.ghostCard !== card.id) {
        this.ghost?.dispose();
        this.ghost = new UnitVisual(visualFor(card.unit.name, card.type === 'BUILDING' ? 'B' : 'T', card.unit.movement === 'AIR' ? 1 : 0, card.unit.radius), 'own');
        this.ghost.setOpacity(0.55);
        this.ghostCard = card.id;
        this.root.add(this.ghost.root);
      }
      this.ghost!.root.visible = true;
      this.ghost!.root.position.set(p.x, card.unit.movement === 'AIR' ? 2 : 0, p.z);
      this.ghost!.setStatus(!valid, false, false, false, false);
    } else if (this.ghost) {
      this.ghost.root.visible = false;
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ring.visible) (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.time * 8) * 0.2;
    if (this.ghost?.root.visible) this.ghost.update(dt, 0, { frozen: false });
  }

  hide(): void {
    this.overlay.visible = false;
    this.ring.visible = false;
    this.footprint.visible = false;
    if (this.ghost) this.ghost.root.visible = false;
  }

  dispose(): void {
    this.ghost?.dispose();
    this.tex.dispose();
    this.overlay.geometry.dispose();
    (this.overlay.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
