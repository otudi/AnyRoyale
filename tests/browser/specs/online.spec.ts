import { expect, test, type Page } from '@playwright/test';
import { affordableTroopSlot, dragCard, openPlayer, ownSpot, state, surrender, waitElixir, waitRunning } from './helpers';

async function commonTickConsistency(a: Page, b: Page): Promise<number> {
  // Find ticks both clients received and compare the authoritative state at each. Each client's
  // history is captured in one evaluate: it is a sliding window that keeps moving while we compare.
  const capture = (p: Page): Promise<Map<number, any>> =>
    p
      .evaluate(() => {
        const r = (window as any).__anyroyale;
        return r.debugTicks().map((t: number) => [t, r.debugSnapshot(t)]);
      })
      .then((entries: [number, any][]) => new Map(entries));
  const ha = await capture(a);
  const hb = await capture(b);
  const common = [...ha.keys()].filter((t) => hb.has(t));
  for (const tick of common) {
    const sa = ha.get(tick);
    const sb = hb.get(tick);
    expect(sa.towers, `tower HP at tick ${tick}`).toEqual(sb.towers);
    // Entity lists match except invisible units, which are only sent to their owner.
    const onlyA = sa.ids.filter((id: number) => !sb.ids.includes(id));
    const onlyB = sb.ids.filter((id: number) => !sa.ids.includes(id));
    expect(onlyA.length + onlyB.length, `entity sets at tick ${tick}`).toBeLessThanOrEqual(2);
    // Both players hold identical hands until they play differently; we only check hand size here.
    expect(sa.hand).toHaveLength(4);
  }
  return common.length;
}

test('two browsers: matchmaking, identical deck and arena, synchronised battle, result, rematch', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser);
  const B = await openPlayer(browser);
  await A.page.locator('[data-act="play"]').click();
  await A.page.locator('[data-act="online"]').click();
  await expect(A.page.locator('[data-screen="queue"]')).toBeVisible();
  // Alone in the queue: no bot is ever substituted.
  await A.page.waitForTimeout(3000);
  expect((await state(A.page)).match).toBeNull();
  await B.page.locator('[data-act="play"]').click();
  await B.page.locator('[data-act="online"]').click();

  const sa = await waitRunning(A.page);
  const sb = await waitRunning(B.page);
  expect(sa.match!.id).toBe(sb.match!.id);
  expect(sa.match!.mode).toBe('online');
  expect(sa.match!.deck).toEqual(sb.match!.deck);
  expect(sa.match!.seed).toBe(sb.match!.seed);
  expect(sa.match!.arena).toBe(sb.match!.arena);
  expect(sa.match!.you).not.toBe(sb.match!.you);
  expect(sa.match!.opponent).toBe(sb.name);
  expect(sb.match!.opponent).toBe(sa.name);
  // Same starting hand for both players.
  await expect.poll(async () => (await state(A.page)).match!.hand).toEqual((await state(B.page)).match!.hand);

  // Both deploy troops by drag.
  await waitElixir(A.page, 5);
  for (const P of [A, B]) {
    const s = await state(P.page);
    const slot = await affordableTroopSlot(P.page);
    expect(slot).toBeGreaterThanOrEqual(0);
    const spot = ownSpot(s.match!.you, 'right');
    await dragCard(P.page, slot, spot.gx, spot.gy);
  }
  // Each screen shows units from both players.
  for (const P of [A, B]) {
    await expect.poll(async () => (await state(P.page)).match!.view.spawnedOwn, { timeout: 45_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await state(P.page)).match!.view.spawnedEnemy, { timeout: 45_000 }).toBeGreaterThan(0);
  }
  await A.page.waitForTimeout(8000);
  const compared = await commonTickConsistency(A.page, B.page);
  expect(compared).toBeGreaterThan(20);

  // A surrenders: A loses, B wins.
  await surrender(A.page);
  await expect.poll(async () => (await state(B.page)).result?.youWon, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await state(A.page)).result?.youWon, { timeout: 15_000 }).toBe(false);
  expect((await state(B.page)).result?.reason).toBe('surrender');
  // The server's replay of the match contains both players' plays.
  const replay = await (await A.page.request.get(`/api/replays/${sa.match!.id}`)).json();
  const teams = new Set(replay.actions.map((x: any) => x.team));
  expect(teams.size).toBe(2);
  expect(replay.result.reason).toBe('surrender');

  // Rematch requires both.
  await A.page.locator('[data-act="rematch"]').click({ timeout: 15_000 });
  await expect(B.page.locator('[data-rematch-status]')).not.toBeEmpty({ timeout: 10_000 });
  await B.page.locator('[data-act="rematch"]').click();
  await expect.poll(async () => (await state(A.page)).match?.id, { timeout: 30_000 }).not.toBe(sa.match!.id);
  const ra = await waitRunning(A.page);
  const rb = await waitRunning(B.page);
  expect(ra.match!.id).toBe(rb.match!.id);
  expect(ra.match!.deck).toEqual(rb.match!.deck);

  // B leaves: A wins by surrender/leave, then both return to the menu.
  await surrender(B.page);
  await expect.poll(async () => (await state(A.page)).result?.youWon, { timeout: 15_000 }).toBe(true);
  await A.page.locator('[data-act="menu"]').click();
  await expect(A.page.locator('[data-screen="home"]')).toBeVisible();
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

test('queue can be cancelled', async ({ browser }) => {
  const A = await openPlayer(browser);
  await A.page.locator('[data-act="play"]').click();
  await A.page.locator('[data-act="online"]').click();
  await expect(A.page.locator('[data-screen="queue"]')).toBeVisible();
  await A.page.locator('[data-act="cancel"]').click();
  // cancelling returns to the game-mode menu (quick match / private room)
  await expect(A.page.locator('[data-screen="mode"]')).toBeVisible();
  // A second player now must not be matched with the cancelled one.
  const B = await openPlayer(browser);
  await B.page.locator('[data-act="play"]').click();
  await B.page.locator('[data-act="online"]').click();
  await B.page.waitForTimeout(3000);
  expect((await state(B.page)).match).toBeNull();
  await B.page.locator('[data-act="cancel"]').click();
  await A.ctx.close();
  await B.ctx.close();
});
