import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Project device settings + baseURL; Playwright only applies them to fixture-created contexts. */
export function contextOptions(extra: Parameters<Browser['newContext']>[0] = {}): Parameters<Browser['newContext']>[0] {
  const use = test.info().project.use as Record<string, unknown>;
  const keys = ['baseURL', 'viewport', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'userAgent', 'locale', 'colorScheme'];
  const base: Record<string, unknown> = {};
  for (const k of keys) if (use[k] !== undefined) base[k] = use[k];
  return { ...base, ...extra } as Parameters<Browser['newContext']>[0];
}

export interface DebugState {
  screen: string;
  name: string;
  guestId?: string;
  connected: boolean;
  roomCode: string | null;
  match: null | {
    id: string;
    you: 'BLUE' | 'RED';
    arena: string;
    seed: string;
    opponent: string;
    deck: string[];
    mode: string;
    running: boolean;
    ended: boolean;
    tick: number;
    elixir: number | null;
    hand: (string | null)[] | null;
    entities: number;
    towers: { id: number; team: number; kind: string; hp: number }[];
    view: { units: number; projectiles: number; areas: number; spawnedOwn: number; spawnedEnemy: number };
  };
  fps: number;
  audio: { unlocked: boolean; ready: boolean; state: string; samples: number };
  failedAssets: string[];
  result: null | { youWon: boolean; draw: boolean; reason: string };
}

export async function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as any).__anyroyale.debugState());
}

/** Opens the game in a fresh context (separate localStorage = separate guest). */
export async function openPlayer(browser: Browser, extra: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext(contextOptions(extra));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.PW_CONSOLE) page.on('console', (m) => console.log(`[browser] ${m.text()}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebGL|GPU|swiftshader|favicon/i.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await state(page)).connected, { timeout: 30_000 }).toBe(true);
  return { ctx, page, errors };
}

export async function waitRunning(page: Page, timeout = 60_000): Promise<DebugState> {
  await expect.poll(async () => (await state(page)).match?.running ?? false, { timeout }).toBe(true);
  return state(page);
}

/** Own-side deploy position (game units) in front of the given lane, from this player's view. */
export function ownSpot(you: 'BLUE' | 'RED', lane: 'left' | 'right', depth = 11500): { gx: number; gy: number } {
  const x = lane === 'left' ? 3500 : 14500;
  return you === 'BLUE' ? { gx: x, gy: depth } : { gx: 18000 - x, gy: 32000 - depth };
}

/**
 * Real pointer drag of the card in `slot` onto the arena position (game units). This goes through
 * the same DOM/pointer-event path a player uses.
 */
export async function dragCard(page: Page, slot: number, gx: number, gy: number): Promise<void> {
  if (process.env.PW_CONSOLE) {
    await page.evaluate(() => {
      const app = (window as any).__anyroyale;
      app.conn.on((m: any) => { if (m.type === 'ack' || m.type === 'reject' || m.type === 'error') console.log('WS', JSON.stringify(m)); });
      const send = app.conn.send.bind(app.conn);
      app.conn.send = (o: any, q?: boolean) => { const r = send(o, q); if (o.type === 'play') console.log('SEND', JSON.stringify(o), r); return r; };
      const inp = app.battle.input;
      const op = inp.onPlay;
      inp.onPlay = (...a: any[]) => { console.log('onPlay', a[0], a[1].id, a[2], a[3]); op(...a); };
      const ev = inp.evaluate.bind(inp);
      inp.evaluate = (e: PointerEvent) => { const r = ev(e); if (e.type !== 'pointermove') console.log('EVAL', e.type, JSON.stringify(r), inp.hud.selected); return r; };
    });
  }
  const card = page.locator(`[data-slot="${slot}"]`);
  const box = (await card.boundingBox())!;
  const target = await page.evaluate(([x, y]) => (window as any).__anyroyale.debugProject(x, y), [gx, gy]);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
}

/** Picks a hand slot whose card is affordable and is a troop or building (not a spell). */
export async function affordableTroopSlot(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const app = (window as any).__anyroyale;
    const st = app.debugState();
    const res = await fetch('/api/cards');
    const json = await res.json();
    const byId = new Map(json.cards.map((c: any) => [c.id, c]));
    const hand: string[] = st.match?.hand ?? [];
    let best = -1;
    for (let i = 0; i < hand.length; i++) {
      const c: any = byId.get(hand[i]);
      if (!c || c.type === 'SPELL' || c.canDeployOnEnemySide || c.mirror) continue;
      if (c.cost <= (st.match?.elixir ?? 0) && (best < 0 || c.cost < (byId.get(hand[best]) as any).cost)) best = i;
    }
    return best;
  });
}

export async function waitElixir(page: Page, amount: number, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await state(page)).match?.elixir ?? 0, { timeout }).toBeGreaterThanOrEqual(amount);
}

export async function surrender(page: Page): Promise<void> {
  await page.locator('[data-surrender]').click();
  await page.locator('[data-m="yes"]').click();
}
