import { expect, test } from '@playwright/test';
import { openPlayer, state } from './helpers';

test.describe('guest identity and home screen', () => {
  test('first visit creates a guest without any sign-up', async ({ browser }) => {
    const { page, ctx, errors } = await openPlayer(browser);
    const s = await state(page);
    expect(s.name).toMatch(/^Royal_\d{4}$/);
    expect(s.guestId).toMatch(/^g_[a-z0-9]{14}$/);
    // No login, e-mail or password fields anywhere.
    await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
    await expect(page.locator('[data-act="online"]')).toBeVisible();
    await expect(page.locator('[data-act="bot"]')).toBeVisible();
    await expect(page.locator('[data-act="friend"]')).toBeVisible();
    await expect(page.locator('[data-act="settings"]')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('identity and edited name survive a reload', async ({ browser }) => {
    const { page, ctx } = await openPlayer(browser);
    const before = await state(page);
    await page.locator('[data-act="name"]').click();
    await page.locator('[data-name-input]').fill('Tester_42');
    await page.locator('[data-m="save"]').click();
    await expect(page.locator('[data-act="name"]')).toContainText('Tester_42');
    await page.reload();
    await expect(page.locator('[data-screen="home"]')).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await state(page)).name).toBe('Tester_42');
    const after = await state(page);
    expect(after.guestId).toBe(before.guestId);
    await ctx.close();
  });

  test('two browsers get two different guests', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    expect((await state(a.page)).guestId).not.toBe((await state(b.page)).guestId);
    await a.ctx.close();
    await b.ctx.close();
  });

  test('settings: language switch to Arabic flips layout to RTL; volumes persist', async ({ browser }) => {
    const { page, ctx } = await openPlayer(browser, { locale: 'en-US' });
    await page.locator('[data-act="settings"]').click();
    await page.locator('[data-s="music"]').fill('0.2');
    await page.locator('[data-s="lang"]').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-act="online"]')).toContainText('العب أونلاين');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('anyroyale.settings.v1') || '{}'));
    expect(saved.music).toBeCloseTo(0.2);
    await ctx.close();
  });
});
