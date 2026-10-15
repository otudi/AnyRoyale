/**
 * Floating damage / heal numbers over the battle ("-202", "+120"). Pooled DOM elements animated by
 * CSS, so dozens per second cost almost nothing.
 */
export class DamageNumbers {
  private readonly layer: HTMLElement;
  private pool: HTMLElement[] = [];
  private live = 0;
  private static readonly MAX_LIVE = 24;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'dmg-layer';
    parent.appendChild(this.layer);
  }

  /**
   * @param amount positive damage, negative = heal
   * @param victim whose unit was hit: 'own' numbers are red-tinted, 'enemy' white/yellow
   * @param big emphasise (large hits, tower damage)
   */
  show(x: number, y: number, amount: number, victim: 'own' | 'enemy', big: boolean): void {
    if (this.live >= DamageNumbers.MAX_LIVE || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const el = this.pool.pop() ?? document.createElement('div');
    const heal = amount < 0;
    el.className = `dmg ${heal ? 'heal' : victim} ${big ? 'big' : ''}`;
    el.textContent = heal ? `+${Math.round(-amount)}` : `-${Math.round(amount)}`;
    // small horizontal jitter so simultaneous hits do not stack exactly
    const jx = (Math.random() - 0.5) * 18;
    el.style.left = `${x + jx}px`;
    el.style.top = `${y}px`;
    this.layer.appendChild(el);
    this.live++;
    // timer rather than animationend: background tabs may never fire animation events
    window.setTimeout(() => {
      el.remove();
      this.live = Math.max(0, this.live - 1);
      this.pool.push(el);
    }, big ? 1000 : 850);
  }

  clear(): void {
    this.layer.replaceChildren();
    this.live = 0;
  }

  dispose(): void {
    this.layer.remove();
  }
}
