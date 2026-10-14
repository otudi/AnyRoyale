import { expect, test } from '@playwright/test';
import { contextOptions, openPlayer, state, surrender, waitRunning } from './helpers';

test('private room: code and invite link start a match; a third player cannot join', async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await openPlayer(browser);
  await host.page.locator('[data-act="play"]').click();
  await host.page.locator('[data-act="friend"]').click();
  await host.page.locator('[data-act="create"]').click();
  const codeEl = host.page.locator('[data-room-code]');
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // Friend opens the invite link.
  const friendCtx = await browser.newContext(contextOptions());
  const friend = await friendCtx.newPage();
  await friend.goto(`/?room=${code}`);
  const sh = await waitRunning(host.page, 90_000);
  const sf = await waitRunning(friend, 90_000);
  expect(sh.match!.id).toBe(sf.match!.id);
  expect(sh.match!.mode).toBe('private');
  expect(sh.match!.deck).toEqual(sf.match!.deck);

  // A third player with the same code is refused (the room closed when the friend joined).
  const third = await openPlayer(browser);
  await third.page.locator('[data-act="play"]').click();
  await third.page.locator('[data-act="friend"]').click();
  await third.page.locator('[data-code-box="0"]').fill(code);
  await third.page.locator('[data-act="join"]').click();
  await expect(third.page.locator('.toast')).toBeVisible();
  await third.page.waitForTimeout(1500);
  expect((await state(third.page)).match).toBeNull();

  await surrender(friend);
  await expect.poll(async () => (await state(host.page)).result?.youWon, { timeout: 15_000 }).toBe(true);
  await host.ctx.close();
  await friendCtx.close();
  await third.ctx.close();
});

test('joining with a wrong code shows an error', async ({ browser }) => {
  const p = await openPlayer(browser);
  await p.page.locator('[data-act="play"]').click();
  await p.page.locator('[data-act="friend"]').click();
  await p.page.locator('[data-code-box="0"]').fill('ZZZZZ');
  await p.page.locator('[data-act="join"]').click();
  await expect(p.page.locator('.toast')).toBeVisible();
  await p.ctx.close();
});
