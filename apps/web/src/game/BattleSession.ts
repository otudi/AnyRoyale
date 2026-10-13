import { audio } from '../audio/AudioManager';
import { t } from '../i18n/strings';
import { DragDeploy } from '../input/DragDeploy';
import type { Connection } from '../network/Connection';
import type { MatchStart, ServerMessage, Snapshot } from '../network/protocol';
import type { CardArt } from '../rendering/CardArt';
import { DeployPreview } from '../rendering/DeployPreview';
import type { Renderer3D } from '../rendering/Renderer3D';
import { Hud } from '../ui/Hud';
import { getSettings } from '../ui/settings';
import { BattleView } from './BattleView';
import { cards } from './cards';
import type { TowerState } from './placement';

/**
 * One match on the client: owns the 3D view, HUD and input for that match and translates server
 * messages into them. Card plays are sent as intents with a sequence number; the card is dimmed and
 * its elixir reserved until the server acknowledges or rejects it.
 */
export class BattleSession {
  readonly view: BattleView;
  readonly hud: Hud;
  private input: DragDeploy;
  private preview: DeployPreview;
  private seq = Date.now() % 1_000_000;
  private pending = new Map<number, { slot: number; cost: number }>();
  private towers: TowerState = {
    princessDown: { BLUE: { left: false, right: false }, RED: { left: false, right: false } },
  };
  private removeUpdater: () => void;
  running = false;
  ended = false;
  lastSnapshot: Snapshot | null = null;
  /** Recent authoritative states by tick (for cross-client consistency checks in tests). */
  readonly history = new Map<number, { ids: number[]; towers: Record<number, number>; hand: (string | null)[] | null }>();

  constructor(
    readonly start: MatchStart,
    private readonly conn: Connection,
    r: Renderer3D,
    hudRoot: HTMLElement,
    art: CardArt,
    stage: HTMLElement,
  ) {
    this.view = new BattleView(r, start.you, start.arena.id);
    this.hud = new Hud(hudRoot, art);
    this.hud.reset();
    this.hud.setOpponent(start.opponent.name);
    this.preview = new DeployPreview();
    r.scene.add(this.preview.root);
    this.input = new DragDeploy(stage, r, this.hud, this.preview, start.you, () => this.towers);
    this.input.enabled = false;
    this.input.onPlay = (slot, card, gx, gy) => this.play(slot, card.id, card.cost, gx, gy);
    this.input.onInvalid = (reason) => this.hud.toast(reason === 'elixir' ? t('notEnoughElixir') : t('invalidPlacement'));
    this.hud.onSurrender = () => this.onSurrender();
    this.view.onPhase = (phase) => {
      if (phase === 'double') this.hud.banner(t('doubleElixir'));
      if (phase === 'overtime') this.hud.banner(t('overtime'));
      if (phase === 'triple') this.hud.banner(t('tripleElixir'));
      audio.setMusicIntensity(phase === 'regular' ? 1 : 1.12);
      audio.play('battleStart', { volume: 0.5 });
    };
    this.view.onTowerDestroyed = () => this.updateTowerState();
    this.removeUpdater = r.addUpdater((dt) => {
      this.preview.update(dt);
      this.hud.setTowers(this.view.towerLabels());
      const s = this.view.stats();
      this.hud.tick(r.fps, getSettings().showFps, `${s.units}u ${Math.round(conn.rttMs)}ms`);
    });
    this.hud.show();
    const fit = () => r.setInsets(this.hud.tray.offsetHeight / Math.max(1, stage.clientHeight), 0.07);
    requestAnimationFrame(fit);
    this.onResize = fit;
    window.addEventListener('resize', fit);
    if (start.state === 'RUNNING') this.begin(false);
  }

  onSurrender: () => void = () => {};
  private onResize: () => void = () => {};

  get matchId(): string {
    return this.start.matchId;
  }

  begin(withBanner = true): void {
    if (this.running) return;
    this.running = true;
    this.input.enabled = true;
    if (withBanner) {
      this.hud.banner(t('battleBegins'));
      audio.play('battleStart');
    }
    audio.playMusic('battle');
  }

  handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snap':
        this.onSnapshot(msg);
        break;
      case 'battleStart':
        this.begin(true);
        break;
      case 'ack': {
        const p = this.pending.get(msg.seq);
        if (p) {
          this.pending.delete(msg.seq);
          // keep the elixir reserved until the next snapshot reflects the spend
        }
        break;
      }
      case 'reject': {
        const p = this.pending.get(msg.seq);
        if (p) {
          this.pending.delete(msg.seq);
          this.hud.unreserve(p.cost);
          this.hud.markPending(p.slot, false);
          this.hud.shake(p.slot);
        }
        audio.play('reject', { volume: 0.6 });
        this.hud.toast(msg.reason === 'elixir' ? t('notEnoughElixir') : t('invalidPlacement'));
        break;
      }
      case 'opponentStatus':
        this.hud.setOpponentConnected(msg.connected, msg.graceSeconds ?? 30);
        this.hud.toast(msg.connected ? t('opponentReconnected') : t('opponentDisconnected', { s: msg.graceSeconds ?? 30 }));
        break;
      default:
        break;
    }
  }

  private onSnapshot(s: Snapshot): void {
    this.lastSnapshot = s;
    const towers: Record<number, number> = {};
    for (const e of s.e) if (e[3] === 'K' || e[3] === 'P') towers[e[0]] = e[7];
    this.history.set(s.tick, { ids: s.e.map((e) => e[0]).sort((a, b) => a - b), towers, hand: s.me?.hand ?? null });
    if (this.history.size > 120) this.history.delete(this.history.keys().next().value!);
    this.view.ingest(s);
    if (s.me) {
      this.hud.setHand(s.me.hand, s.me.next);
      this.hud.setElixir(s.me.elixir, s.elixirRate);
      this.hud.setCrowns(s.me.crowns, s.opp?.crowns ?? 0);
      // Re-reserve elixir for plays the server has not processed yet.
      for (const p of this.pending.values()) this.hud.reserve(p.cost);
    }
    this.hud.setTime(s.timeLeft, s.phase);
    this.updateTowerState(s);
  }

  private updateTowerState(s: Snapshot | null = this.lastSnapshot): void {
    if (!s) return;
    const alive = { BLUE: { left: false, right: false }, RED: { left: false, right: false } };
    for (const e of s.e) {
      if (e[3] !== 'P') continue;
      const team = e[2] === 0 ? 'BLUE' : 'RED';
      if (e[5] < 9000) alive[team].left = true;
      else alive[team].right = true;
    }
    this.towers = {
      princessDown: {
        BLUE: { left: !alive.BLUE.left, right: !alive.BLUE.right },
        RED: { left: !alive.RED.left, right: !alive.RED.right },
      },
    };
  }

  private play(slot: number, cardId: string, cost: number, gx: number, gy: number): void {
    if (!this.running || this.ended) return;
    const seq = ++this.seq;
    const card = cards.get(cardId);
    const effectiveCost = card?.mirror ? 0 : cost;
    this.pending.set(seq, { slot, cost: effectiveCost });
    this.hud.reserve(effectiveCost);
    this.hud.markPending(slot, true);
    const sent = this.conn.send({ type: 'play', matchId: this.matchId, seq, slot, card: cardId, x: gx, y: gy }, false);
    if (!sent) {
      this.pending.delete(seq);
      this.hud.unreserve(effectiveCost);
      this.hud.markPending(slot, false);
      this.hud.toast(t('reconnecting'));
      return;
    }
    audio.play('click', { volume: 0.4 });
    setTimeout(() => {
      // Safety net: never leave a card dimmed if a reply got lost.
      const p = this.pending.get(seq);
      if (p) {
        this.pending.delete(seq);
        this.hud.unreserve(p.cost);
        this.hud.markPending(p.slot, false);
      }
    }, 2500);
  }

  end(): void {
    this.ended = true;
    this.input.enabled = false;
    this.input.cancel();
    this.hud.setOpponentConnected(true);
  }

  dispose(): void {
    this.end();
    this.removeUpdater();
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.preview.dispose();
    this.view.dispose();
    this.hud.reset();
    this.hud.hide();
  }
}
