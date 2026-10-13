import { audio } from '../audio/AudioManager';
import { cards } from '../game/cards';
import { isValid, placementKind, snap, troopGrid, type TowerState } from '../game/placement';
import type { CardInfo, TeamName } from '../network/protocol';
import { fromWorld } from '../rendering/coords';
import type { DeployPreview } from '../rendering/DeployPreview';
import type { Renderer3D } from '../rendering/Renderer3D';
import type { Hud } from '../ui/Hud';

/**
 * Card deployment by touch or mouse, like the reference game:
 *  - drag a card from the tray onto the arena and release to deploy;
 *  - or tap a card to select it, then tap the arena;
 *  - keys 1-4 select cards on desktop.
 * Pointer events cover mouse, touch and pen uniformly (Safari iOS 13+).
 */
export class DragDeploy {
  private dragging = false;
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private moved = false;
  enabled = true;
  onPlay: (slot: number, card: CardInfo, gx: number, gy: number) => void = () => {};
  onInvalid: (reason: 'elixir' | 'placement') => void = () => {};

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) this.selectSlot(n - 1);
    if (e.key === 'Escape') this.cancel();
  };

  constructor(
    private readonly stage: HTMLElement,
    private readonly r: Renderer3D,
    private readonly hud: Hud,
    private readonly preview: DeployPreview,
    private readonly team: TeamName,
    private readonly towers: () => TowerState,
  ) {
    hud.cardEls.forEach((el, slot) => {
      el.addEventListener('pointerdown', (e) => this.onCardDown(e, slot));
    });
    stage.addEventListener('pointermove', this.onMove);
    stage.addEventListener('pointerup', this.onUp);
    stage.addEventListener('pointercancel', this.onCancel);
    r.renderer.domElement.addEventListener('pointerdown', this.onArenaDown);
    window.addEventListener('keydown', this.onKey);
  }

  private card(slot: number): CardInfo | undefined {
    const id = this.hud.cardAt(slot);
    return id ? cards.get(id) : undefined;
  }

  private selectSlot(slot: number): void {
    const card = this.card(slot);
    if (!card) return;
    if (this.hud.selected === slot) {
      this.cancel();
      return;
    }
    this.hud.select(slot);
    audio.play('select', { volume: 0.6 });
    this.preview.showGrid(troopGrid(this.team, this.towers(), placementKind(card)));
  }

  private onCardDown = (e: PointerEvent, slot: number) => {
    if (!this.enabled) return;
    e.preventDefault();
    const card = this.card(slot);
    if (!card) return;
    this.hud.select(slot);
    audio.play('select', { volume: 0.6 });
    this.preview.showGrid(troopGrid(this.team, this.towers(), placementKind(card)));
    this.dragging = true;
    this.moved = false;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private overTray(e: PointerEvent): boolean {
    const rect = this.hud.tray.getBoundingClientRect();
    return e.clientY >= rect.top + 6;
  }

  private evaluate(e: PointerEvent): { gx: number; gy: number; valid: boolean } | null {
    const slot = this.hud.selected;
    const card = this.card(slot);
    if (!card || this.overTray(e)) return null;
    const p = this.local(e);
    const hit = this.r.pickGround(p.x, p.y);
    if (!hit) return null;
    // Lift the touch point a little so the finger does not hide the ghost (drag only).
    const g = fromWorld(hit.x, hit.z);
    const snapped = snap(g.gx, g.gy, card);
    return { ...snapped, valid: isValid(card, snapped.gx, snapped.gy, this.team, this.towers()) };
  }

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging || e.pointerId !== this.pointerId) return;
    if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 8) this.moved = true;
    const card = this.card(this.hud.selected);
    const at = this.evaluate(e);
    if (card && at) {
      this.preview.show(card, at.gx, at.gy, at.valid);
    } else {
      this.preview.hide();
      if (card) this.preview.showGrid(troopGrid(this.team, this.towers(), placementKind(card)));
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.dragging = false;
    const at = this.evaluate(e);
    if (!this.moved || !at) {
      // A tap on a card keeps it selected for tap-to-place; a drag back to the tray cancels.
      if (this.moved) this.cancel();
      return;
    }
    this.tryPlay(at);
  };

  private onCancel = () => {
    this.dragging = false;
    this.cancel();
  };

  private onArenaDown = (e: PointerEvent) => {
    if (!this.enabled || this.dragging || this.hud.selected < 0) return;
    const at = this.evaluate(e);
    if (at) this.tryPlay(at);
  };

  private tryPlay(at: { gx: number; gy: number; valid: boolean }): void {
    const slot = this.hud.selected;
    const card = this.card(slot);
    if (!card) return;
    if (!at.valid) {
      this.onInvalid('placement');
      this.hud.shake(slot);
      audio.play('reject', { volume: 0.6 });
      this.cancel();
      return;
    }
    if (this.hud.currentElixir() + 0.001 < card.cost && !card.mirror) {
      this.onInvalid('elixir');
      this.hud.shake(slot);
      audio.play('reject', { volume: 0.6 });
      this.cancel();
      return;
    }
    this.onPlay(slot, card, at.gx, at.gy);
    this.cancel();
  }

  cancel(): void {
    this.hud.select(-1);
    this.preview.hide();
  }

  dispose(): void {
    this.stage.removeEventListener('pointermove', this.onMove);
    this.stage.removeEventListener('pointerup', this.onUp);
    this.stage.removeEventListener('pointercancel', this.onCancel);
    this.r.renderer.domElement.removeEventListener('pointerdown', this.onArenaDown);
    window.removeEventListener('keydown', this.onKey);
  }
}
