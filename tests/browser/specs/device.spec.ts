import { expect, test } from '@playwright/test';
import { affordableTroopSlot, openPlayer, ownSpot, state, surrender, waitElixir, waitRunning } from './helpers';

test('touch drag deploys a card (real touch events, Chromium CDP)', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch emulation is Chromium-only; other engines use the pointer drag tests');
  const p = await openPlayer(browser, { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await p.page.locator('[data-act="bot"]').tap();
  await p.page.locator('[data-act="d_easy"]').tap();
  const s = await waitRunning(p.page);
  await waitElixir(p.page, 4);
  const slot = await affordableTroopSlot(p.page);
  const box = (await p.page.locator(`[data-slot="${slot}"]`).boundingBox())!;
  const spot = ownSpot(s.match!.you, 'left');
  const target = await p.page.evaluate(([x, y]) => (window as any).__anyroyale.debugProject(x, y), [spot.gx, spot.gy]);
  const cdp = await p.ctx.newCDPSession(p.page);
  const at = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(start.x, start.y) });
  for (let i = 1; i <= 10; i++) {
    const x = start.x + ((target.x - start.x) * i) / 10;
    const y = start.y + ((target.y - start.y) * i) / 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x, y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const elixirBefore = s.match!.elixir ?? 10;
  await expect.poll(async () => (await state(p.page)).match!.view.units, { timeout: 15_000 }).toBeGreaterThan(0);
  void elixirBefore;
  await surrender(p.page);
  await p.ctx.close();
});

test('tap a card then tap the arena also deploys', async ({ browser }) => {
  const p = await openPlayer(browser);
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  const s = await waitRunning(p.page);
  await waitElixir(p.page, 4);
  const slot = await affordableTroopSlot(p.page);
  await p.page.locator(`[data-slot="${slot}"]`).click();
  await expect(p.page.locator(`[data-slot="${slot}"]`)).toHaveClass(/selected/);
  const spot = ownSpot(s.match!.you, 'right');
  const target = await p.page.evaluate(([x, y]) => (window as any).__anyroyale.debugProject(x, y), [spot.gx, spot.gy]);
  await p.page.mouse.click(target.x, target.y);
  await expect.poll(async () => (await state(p.page)).match!.view.units, { timeout: 15_000 }).toBeGreaterThan(0);
  await surrender(p.page);
  await p.ctx.close();
});

test('dropping a troop on the enemy side is refused before reaching the server', async ({ browser }) => {
  const p = await openPlayer(browser);
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  const s = await waitRunning(p.page);
  await waitElixir(p.page, 4);
  const slot = await affordableTroopSlot(p.page);
  const elixir = (await state(p.page)).match!.elixir!;
  const enemy = s.match!.you === 'BLUE' ? { gx: 9500, gy: 22500 } : { gx: 9500, gy: 9500 };
  const box = (await p.page.locator(`[data-slot="${slot}"]`).boundingBox())!;
  const target = await p.page.evaluate(([x, y]) => (window as any).__anyroyale.debugProject(x, y), [enemy.gx, enemy.gy]);
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await p.page.mouse.move(target.x, target.y, { steps: 8 });
  await p.page.mouse.up();
  await expect(p.page.locator('.toast')).toBeVisible();
  await p.page.waitForTimeout(1500);
  expect((await state(p.page)).match!.elixir!).toBeGreaterThanOrEqual(elixir);
  await surrender(p.page);
  await p.ctx.close();
});

test('rotating the device keeps the battle rendering and the tray usable', async ({ browser }) => {
  const p = await openPlayer(browser, { viewport: { width: 390, height: 844 } });
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  await waitRunning(p.page);
  await p.page.setViewportSize({ width: 844, height: 390 });
  await p.page.waitForTimeout(1000);
  const canvas = await p.page.locator('canvas.game-canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(300);
  await expect(p.page.locator('[data-slot="0"]')).toBeVisible();
  await p.page.setViewportSize({ width: 390, height: 844 });
  await p.page.waitForTimeout(500);
  const t0 = (await state(p.page)).match!.tick;
  await expect.poll(async () => (await state(p.page)).match!.tick).toBeGreaterThan(t0);
  await surrender(p.page);
  await p.ctx.close();
});

test('going to the background and back keeps the match', async ({ browser }) => {
  const p = await openPlayer(browser);
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  const s = await waitRunning(p.page);
  await p.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.page.waitForTimeout(2000);
  await p.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await state(p.page)).match!.tick, { timeout: 10_000 }).toBeGreaterThan(s.match!.tick);
  expect((await state(p.page)).match!.id).toBe(s.match!.id);
  await surrender(p.page);
  await p.ctx.close();
});
