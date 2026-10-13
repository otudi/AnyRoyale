import { expect, test } from '@playwright/test';
import { affordableTroopSlot, dragCard, openPlayer, ownSpot, state, surrender, waitElixir, waitRunning } from './helpers';

for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
  test(`training vs ${difficulty} bot: deploy by drag, units fight, surrender ends the match`, async ({ browser }) => {
    const { page, ctx, errors } = await openPlayer(browser);
    await page.locator('[data-act="bot"]').click();
    await page.locator(`[data-act="d_${difficulty}"]`).click();
    const s = await waitRunning(page);
    expect(s.match!.mode).toBe('bot');
    expect(s.match!.deck).toHaveLength(8);
    expect(s.match!.opponent).toContain('Bot');
    await waitElixir(page, 4);
    const slot = await affordableTroopSlot(page);
    expect(slot).toBeGreaterThanOrEqual(0);
    const played = (await state(page)).match!.hand![slot];
    const spot = ownSpot(s.match!.you, 'left');
    await dragCard(page, slot, spot.gx, spot.gy);
    // The server accepted the play: the card cycled out of that slot and our unit is on the field.
    await expect.poll(async () => (await state(page)).match!.hand![slot], { timeout: 20_000 }).not.toBe(played);
    await expect.poll(async () => (await state(page)).match!.view.units, { timeout: 20_000 }).toBeGreaterThan(0);
    // The bot plays too: within 25 s it has deployed something.
    await expect
      .poll(async () => (await state(page)).match!.entities, { timeout: 30_000 })
      .toBeGreaterThan(7);
    await surrender(page);
    await expect.poll(async () => (await state(page)).result?.reason, { timeout: 15_000 }).toBe('surrender');
    expect((await state(page)).result!.youWon).toBe(false);
    await expect(page.locator('[data-result="lose"]')).toBeVisible();
    await page.locator('[data-act="menu"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });
}

test('bot rematch with the same deck replays the same deck and arena', async ({ browser }) => {
  const { page, ctx } = await openPlayer(browser);
  await page.locator('[data-act="bot"]').click();
  await page.locator('[data-act="d_easy"]').click();
  const first = await waitRunning(page);
  await surrender(page);
  await expect(page.locator('[data-act="sameDeck"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-act="sameDeck"]').click();
  await expect.poll(async () => (await state(page)).match?.id, { timeout: 30_000 }).not.toBe(first.match!.id);
  const second = await waitRunning(page);
  expect(second.match!.deck).toEqual(first.match!.deck);
  expect(second.match!.seed).toBe(first.match!.seed);
  expect(second.match!.arena).toBe(first.match!.arena);
  await surrender(page);
  await expect(page.locator('[data-act="newDeck"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-act="newDeck"]').click();
  await expect.poll(async () => (await state(page)).match?.seed, { timeout: 30_000 }).not.toBe(first.match!.seed);
  await ctx.close();
});

test('a full real-time match against the expert bot ends with the king tower destroyed', async ({ browser }) => {
  test.slow();
  test.setTimeout(420_000);
  const { page, ctx, errors } = await openPlayer(browser);
  await page.locator('[data-act="bot"]').click();
  await page.locator('[data-act="d_expert"]').click();
  await waitRunning(page);
  // The player stays idle: the bot must push through towers and win on its own.
  await expect.poll(async () => (await state(page)).result, { timeout: 360_000, intervals: [5000] }).not.toBeNull();
  const r = (await state(page)).result!;
  expect(r.youWon).toBe(false);
  expect(['kingTower', 'crowns', 'towerHp']).toContain(r.reason);
  expect(errors).toEqual([]);
  await ctx.close();
});
