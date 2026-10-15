import { cards } from '../game/cards';
import { BattleView } from '../game/BattleView';
import { t } from '../i18n/strings';
import type { EntityTuple, Snapshot } from '../network/protocol';
import type { CardArt } from '../rendering/CardArt';
import type { Renderer3D } from '../rendering/Renderer3D';
import { Hud } from './Hud';
import { applyCardSize, DEFAULT_CARD_SIZE, getSettings, updateSettings } from './settings';

/**
 * Card size preview (Settings → Card size → Preview): the real battle HUD over a real arena with
 * its six towers, at the actual screen size. The player tries the five sizes live, then saves,
 * cancels (back to the saved size) or restores the default.
 */
export class CardSizePreview {
  private readonly view: BattleView;
  private readonly hud: Hud;
  private readonly panel: HTMLElement;
  private readonly removeUpdater: () => void;
  private readonly onResize = () => this.fit();
  private size: number;
  private readonly saved: number;

  constructor(
    private readonly r: Renderer3D,
    art: CardArt,
    private readonly hudRoot: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.saved = getSettings().cardSize;
    this.size = this.saved;
    const root = document.documentElement;
    root.classList.remove('menu-mode');
    root.classList.add('previewing');
    document.getElementById('screens')!.style.display = 'none';
    window.dispatchEvent(new Event('resize'));

    this.view = new BattleView(r, 'BLUE', 'meadow', 1);
    this.view.ingest(previewSnapshot(1));
    this.view.ingest(previewSnapshot(2));
    const deck = cards
      .all()
      .filter((c) => c.type === 'TROOP')
      .slice(0, 5)
      .map((c) => c.id);
    this.hud = new Hud(hudRoot, art);
    this.hud.reset();
    this.hud.setOpponent(t('preview'));
    this.hud.setHand(deck.slice(0, 4), deck[4] ?? null);
    this.hud.setElixir(7, 1);
    this.hud.show();
    this.removeUpdater = r.addUpdater(() => {
      this.hud.setTowers(this.view.towerLabels());
      this.hud.tick(r.fps, false);
    });

    this.panel = document.createElement('div');
    this.panel.className = 'size-panel';
    this.panel.dataset.sizePreview = '';
    this.panel.innerHTML = `
      <div class="size-title"></div>
      <div class="size-steps">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-size="${n}"></button>`).join('')}</div>
      <div class="size-actions">
        <button type="button" data-size-act="default"></button>
        <button type="button" data-size-act="cancel"></button>
        <button type="button" class="primary" data-size-act="save"></button>
      </div>`;
    this.panel.querySelector('.size-title')!.textContent = `${t('cardSize')} · ${t('previewHint')}`;
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      b.textContent = t(`cardSize${b.dataset.size}` as 'cardSize1');
      b.addEventListener('click', () => this.pick(Number(b.dataset.size)));
    }
    const act = (name: string, label: string, fn: () => void) => {
      const b = this.panel.querySelector<HTMLButtonElement>(`[data-size-act="${name}"]`)!;
      b.textContent = label;
      b.addEventListener('click', fn);
    };
    act('default', t('restoreDefault'), () => this.pick(DEFAULT_CARD_SIZE));
    act('cancel', t('cancel'), () => this.close(false));
    act('save', t('save'), () => this.close(true));
    hudRoot.appendChild(this.panel);
    window.addEventListener('resize', this.onResize);
    this.pick(this.size);
  }

  private pick(size: number): void {
    this.size = size;
    applyCardSize(size);
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      b.classList.toggle('on', Number(b.dataset.size) === size);
    }
    requestAnimationFrame(() => this.fit());
  }

  /** The camera keeps the field between the top HUD (and the size panel) and the tray, like in a match. */
  private fit(): void {
    const stage = this.hudRoot.parentElement!;
    // the size panel sits at the top for the preview only: keep the far towers below it
    // (on wide phones it is a side column instead, and the field slides right of it)
    const pr = this.panel.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const column = getComputedStyle(this.panel).flexDirection === 'column';
    const above = column ? 0 : (pr.bottom - sr.top) / Math.max(1, sr.height);
    const beside = column ? (pr.right - sr.left) / Math.max(1, sr.width) : 0;
    this.r.setInsets(this.hud.tray.offsetHeight / Math.max(1, stage.clientHeight), Math.max(0.07, above), beside);
  }

  private close(save: boolean): void {
    window.removeEventListener('resize', this.onResize);
    if (save) updateSettings({ cardSize: this.size });
    else applyCardSize(this.saved);
    this.removeUpdater();
    this.view.dispose();
    this.panel.remove();
    this.hud.reset();
    this.hud.hide();
    this.hudRoot.replaceChildren();
    document.documentElement.classList.remove('previewing');
    document.getElementById('screens')!.style.display = '';
    this.onClose();
  }
}

/** The six towers at their engine positions (blue at the bottom rows, red at the top). */
function previewSnapshot(tick: number): Snapshot {
  const tower = (id: number, team: 0 | 1, kind: 'K' | 'P', x: number, y: number): EntityTuple =>
    [id, kind === 'K' ? 'KingTower' : 'PrincessTower', team, kind, 2, x, y, kind === 'K' ? 4824 : 3052, kind === 'K' ? 4824 : 3052, 0, 0, 0, 1000, 0] as unknown as EntityTuple;
  return {
    type: 'snap',
    tick,
    timeLeft: 180,
    phase: 'regular',
    elixirRate: 1,
    e: [
      tower(1, 0, 'K', 9000, 3000),
      tower(2, 0, 'P', 3500, 6500),
      tower(3, 0, 'P', 14500, 6500),
      tower(4, 1, 'K', 9000, 29000),
      tower(5, 1, 'P', 3500, 25500),
      tower(6, 1, 'P', 14500, 25500),
    ],
    p: [],
    ev: [],
  } as Snapshot;
}
