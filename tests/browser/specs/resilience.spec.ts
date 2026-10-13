import { expect, test } from '@playwright/test';
import { openPlayer, state, surrender, waitRunning } from './helpers';

test('reloading the page during a match resumes the same match', async ({ browser }) => {
  test.setTimeout(180_000);
  const p = await openPlayer(browser);
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  const before = await waitRunning(p.page);
  await p.page.waitForTimeout(3000);
  await p.page.reload();
  const after = await waitRunning(p.page, 90_000);
  expect(after.match!.id).toBe(before.match!.id);
  expect(after.match!.deck).toEqual(before.match!.deck);
  await expect.poll(async () => (await state(p.page)).match!.tick, { timeout: 15_000 }).toBeGreaterThan(before.match!.tick);
  await surrender(p.page);
  await p.ctx.close();
});

test('losing the network shows the reconnect banner, the opponent is told, and play resumes', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser);
  const B = await openPlayer(browser);
  await A.page.locator('[data-act="online"]').click();
  await B.page.locator('[data-act="online"]').click();
  const sa = await waitRunning(A.page);
  await waitRunning(B.page);
  // Offline emulation blocks new connections but keeps an open WebSocket alive, so also drop the
  // live socket the way a lost mobile connection would.
  await A.ctx.setOffline(true);
  await A.page.evaluate(() => (window as any).__anyroyale.conn.ws?.close());
  await expect(A.page.locator('.status-bar')).toBeVisible({ timeout: 20_000 });
  await expect(B.page.locator('.toast')).toBeVisible({ timeout: 30_000 });
  await A.ctx.setOffline(false);
  await expect(A.page.locator('.status-bar')).toHaveCount(0, { timeout: 40_000 });
  await expect.poll(async () => (await state(A.page)).match?.id, { timeout: 30_000 }).toBe(sa.match!.id);
  const t0 = (await state(A.page)).match!.tick;
  await expect.poll(async () => (await state(A.page)).match!.tick, { timeout: 15_000 }).toBeGreaterThan(t0);
  await surrender(A.page);
  await expect.poll(async () => (await state(B.page)).result?.youWon, { timeout: 20_000 }).toBe(true);
  await A.ctx.close();
  await B.ctx.close();
});

test('a player who stays disconnected past the grace period forfeits', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser);
  const B = await openPlayer(browser);
  await A.page.locator('[data-act="online"]').click();
  await B.page.locator('[data-act="online"]').click();
  await waitRunning(A.page);
  await waitRunning(B.page);
  await A.ctx.close(); // tab closed for good (server grace in tests: 20 s)
  await expect.poll(async () => (await state(B.page)).result?.reason, { timeout: 60_000 }).toBe('disconnect');
  expect((await state(B.page)).result!.youWon).toBe(true);
  await B.ctx.close();
});
