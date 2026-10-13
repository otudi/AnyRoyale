import type { CardInfo } from '../network/protocol';

/** Card catalog served by the server from live engine data (/api/cards). */
export class CardCatalog {
  private byId = new Map<string, CardInfo>();
  private byUnit = new Map<string, CardInfo>();
  level = 11;

  async load(): Promise<void> {
    if (this.byId.size) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('/api/cards');
        if (!res.ok) throw new Error(`/api/cards ${res.status}`);
        const json = (await res.json()) as { level: number; cards: CardInfo[] };
        this.level = json.level;
        for (const c of json.cards) {
          this.byId.set(c.id, c);
          if (c.unit) this.byUnit.set(c.unit.name, c);
        }
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  get(id: string): CardInfo | undefined {
    return this.byId.get(id);
  }

  forUnit(name: string): CardInfo | undefined {
    return this.byUnit.get(name);
  }

  all(): CardInfo[] {
    return [...this.byId.values()];
  }

  /** Attack interval of an entity, used to time attack animations. */
  hitSpeed(unitName: string): number {
    if (unitName === 'Princess Tower') return 0.8;
    if (unitName === 'Crown Tower') return 1.0;
    return this.byUnit.get(unitName)?.unit?.hitSpeed ?? 1.0;
  }

  isMelee(unitName: string): boolean {
    const u = this.byUnit.get(unitName)?.unit;
    return u ? u.range < 2000 : true;
  }
}

export const cards = new CardCatalog();
