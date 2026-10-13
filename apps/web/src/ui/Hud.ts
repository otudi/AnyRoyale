import { cards } from '../game/cards';
import type { TowerLabel } from '../game/BattleView';
import { t } from '../i18n/strings';
import type { CardArt } from '../rendering/CardArt';

/** DOM HUD drawn over the 3D canvas. All numbers shown come from server snapshots. */
export class Hud {
  readonly el: HTMLElement;
  readonly tray: HTMLElement;
  readonly cardEls: HTMLElement[] = [];
  private nextEl: HTMLElement;
  private elixirFill: HTMLElement;
  private elixirNum: HTMLElement;
  private elixirBar: HTMLElement;
  private timerEl: HTMLElement;
  private timerBox: HTMLElement;
  private crownsMine: HTMLElement;
  private crownsOpp: HTMLElement;
  private oppTag: HTMLElement;
  private towerEls = new Map<number, HTMLElement>();
  private fpsEl: HTMLElement;
  private hand: (string | null)[] = [null, null, null, null];
  private next: string | null = null;
  private displayedElixir = 0;
  private serverElixir = 0;
  private reservedElixir = 0;
  private elixirRate = 1;
  private lastServerAt = 0;
  private timeLeft = 180;
  private timeAt = 0;
  private overtime = false;
  selected = -1;
  onSurrender: () => void = () => {};

  constructor(
    root: HTMLElement,
    private readonly art: CardArt,
  ) {
    this.el = root;
    root.innerHTML = `
      <div class="top">
        <div class="opp-tag" data-opp></div>
        <div class="score">
          <div class="timer"><div class="label" data-timer-label></div><div class="value" data-timer>3:00</div></div>
          <div class="crowns"><span class="c red" data-crowns-opp>👑 0</span><span class="c blue" data-crowns-mine>👑 0</span></div>
        </div>
      </div>
      <button class="surrender" data-surrender title="${t('surrender')}">🏳️</button>
      <div class="towers" data-towers></div>
      <div class="tray">
        <div class="hand">
          <div class="next"><div class="card small" data-next><img alt="" /><div class="cost"><span></span></div></div><div>${t('next')}</div></div>
          ${[0, 1, 2, 3]
            .map((i) => `<div class="card" data-slot="${i}"><img alt="" draggable="false" /><div class="charge"></div><div class="cost"><span></span></div></div>`)
            .join('')}
        </div>
        <div class="elixir" data-elixir><div class="fill"></div><div class="ticks">${'<i></i>'.repeat(10)}</div><div class="num">0</div></div>
      </div>
      <div class="fps hidden" data-fps></div>`;
    this.tray = root.querySelector('.tray')!;
    for (let i = 0; i < 4; i++) this.cardEls.push(root.querySelector(`[data-slot="${i}"]`)!);
    this.nextEl = root.querySelector('[data-next]')!;
    this.elixirBar = root.querySelector('[data-elixir]')!;
    this.elixirFill = this.elixirBar.querySelector('.fill')!;
    this.elixirNum = this.elixirBar.querySelector('.num')!;
    this.timerEl = root.querySelector('[data-timer]')!;
    this.timerBox = root.querySelector('.timer')!;
    this.crownsMine = root.querySelector('[data-crowns-mine]')!;
    this.crownsOpp = root.querySelector('[data-crowns-opp]')!;
    this.oppTag = root.querySelector('[data-opp]')!;
    this.fpsEl = root.querySelector('[data-fps]')!;
    root.querySelector<HTMLButtonElement>('[data-surrender]')!.addEventListener('click', () => this.onSurrender());
    (root.querySelector('[data-timer-label]') as HTMLElement).textContent = t('arena');
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  setOpponent(name: string): void {
    this.oppTag.textContent = name;
  }

  setHand(hand: (string | null)[], next: string | null): void {
    for (let i = 0; i < 4; i++) {
      if (hand[i] !== this.hand[i]) {
        this.hand[i] = hand[i];
        this.renderCard(this.cardEls[i], hand[i]);
        this.cardEls[i].classList.remove('pending');
      }
    }
    if (next !== this.next) {
      this.next = next;
      this.renderCard(this.nextEl, next);
    }
  }

  cardAt(slot: number): string | null {
    return this.hand[slot] ?? null;
  }

  private renderCard(el: HTMLElement, id: string | null): void {
    const img = el.querySelector('img')!;
    const cost = el.querySelector('.cost span')!;
    el.classList.remove('rare', 'epic', 'legendary', 'common');
    if (!id) {
      img.removeAttribute('src');
      cost.textContent = '';
      return;
    }
    const card = cards.get(id);
    if (!card) return;
    img.src = this.art.get(card);
    img.alt = card.name;
    el.title = card.name;
    el.dataset.card = id;
    cost.textContent = String(card.cost);
    el.classList.add(card.rarity.toLowerCase());
  }

  setElixir(value: number, rate: number): void {
    this.serverElixir = value;
    this.elixirRate = rate;
    this.lastServerAt = performance.now();
    this.reservedElixir = 0;
    this.elixirBar.classList.toggle('x2', rate >= 2);
  }

  /** Optimistic elixir spend until the server's next snapshot confirms it. */
  reserve(cost: number): void {
    this.reservedElixir += cost;
  }

  unreserve(cost: number): void {
    this.reservedElixir = Math.max(0, this.reservedElixir - cost);
  }

  currentElixir(): number {
    return this.displayedElixir;
  }

  setTime(timeLeft: number, phase: string): void {
    this.timeLeft = timeLeft;
    this.timeAt = performance.now();
    this.overtime = phase === 'overtime' || phase === 'triple';
    this.timerBox.classList.toggle('ot', this.overtime);
    (this.el.querySelector('[data-timer-label]') as HTMLElement).textContent = this.overtime ? t('overtime').replace('!', '') : '';
  }

  setCrowns(mine: number, opp: number): void {
    this.crownsMine.textContent = `👑 ${mine}`;
    this.crownsOpp.textContent = `👑 ${opp}`;
  }

  setTowers(labels: (TowerLabel & { sx: number; sy: number })[]): void {
    const container = this.el.querySelector('[data-towers]')!;
    for (const l of labels) {
      let el = this.towerEls.get(l.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `tower-label ${l.side}`;
        container.appendChild(el);
        this.towerEls.set(l.id, el);
      }
      if (!l.alive) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.left = `${l.sx}px`;
      el.style.top = `${l.sy}px`;
      const text = String(Math.max(0, l.hp));
      if (el.textContent !== text) el.textContent = text;
    }
  }

  /** Per-frame: smooth elixir and timer between snapshots. */
  tick(fps: number, showFps: boolean, extra = ''): void {
    const now = performance.now();
    const predicted = Math.min(10, this.serverElixir + ((now - this.lastServerAt) / 1000) * (this.elixirRate / 2.8));
    this.displayedElixir = Math.max(0, predicted - this.reservedElixir);
    this.elixirFill.style.width = `${this.displayedElixir * 10}%`;
    this.elixirNum.textContent = String(Math.floor(this.displayedElixir));
    for (let i = 0; i < 4; i++) {
      const id = this.hand[i];
      const card = id ? cards.get(id) : undefined;
      const el = this.cardEls[i];
      const cost = card?.cost ?? 0;
      const affordable = this.displayedElixir >= cost;
      el.classList.toggle('unaffordable', !affordable);
      const charge = el.querySelector<HTMLElement>('.charge')!;
      charge.style.height = affordable ? '0%' : `${Math.min(100, (this.displayedElixir / Math.max(1, cost)) * 100)}%`;
    }
    const left = Math.max(0, this.timeLeft - (now - this.timeAt) / 1000);
    const m = Math.floor(left / 60);
    const s = Math.floor(left % 60);
    this.timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.fpsEl.classList.toggle('hidden', !showFps);
    if (showFps) this.fpsEl.textContent = `${fps.toFixed(0)} fps ${extra}`;
  }

  select(slot: number): void {
    this.selected = slot;
    this.cardEls.forEach((el, i) => el.classList.toggle('selected', i === slot));
  }

  markPending(slot: number, pending: boolean): void {
    this.cardEls[slot]?.classList.toggle('pending', pending);
  }

  shake(slot: number): void {
    const el = this.cardEls[slot];
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  banner(text: string): void {
    const b = document.createElement('div');
    b.className = 'banner';
    b.textContent = text;
    this.el.appendChild(b);
    setTimeout(() => b.remove(), 1900);
  }

  toast(text: string): void {
    for (const old of this.el.querySelectorAll('.toast')) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  reset(): void {
    this.hand = [null, null, null, null];
    this.next = null;
    for (const el of this.towerEls.values()) el.remove();
    this.towerEls.clear();
    this.select(-1);
    for (const el of this.cardEls) el.classList.remove('pending', 'shake');
    for (const el of this.el.querySelectorAll('.banner, .toast')) el.remove();
  }
}
