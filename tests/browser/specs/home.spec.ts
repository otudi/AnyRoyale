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
    for (const act of ['play', 'bot', 'cards', 'settings', 'lang', 'theme', 'mute', 'help']) {
      await expect(page.locator(`[data-act="${act}"]`)).toBeVisible();
    }
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
    await expect(page.locator('[data-act="play"]')).toContainText('ابدأ اللعب');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('anyroyale.settings.v1') || '{}'));
    expect(saved.music).toBeCloseTo(0.2);
    await ctx.close();
  });

  test('language button, help screen and the cards page', async ({ browser }) => {
    const { page, ctx, errors } = await openPlayer(browser, { locale: 'en-US' });
    // one tap switches the whole UI between English and Arabic
    await page.locator('[data-act="lang"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('[data-act="lang"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    // short how-to-play overlay
    await page.locator('[data-act="help"]').click();
    await expect(page.locator('.mm-help h3')).toHaveCount(5);
    await page.locator('.mm-help-close').click();
    await expect(page.locator('.mm-help')).toHaveCount(0);
    // every playable card is listed; tapping one explains it
    await page.locator('[data-act="cards"]').click();
    const total = (await (await page.request.get('/api/cards')).json()).cards.length;
    await expect(page.locator('[data-card]')).toHaveCount(total);
    await page.locator('[data-card="hogrider"]').click();
    await expect(page.locator('.mm-desc')).toContainText('buildings');
    await expect(page.locator('.mm-stat')).not.toHaveCount(0);
    await page.locator('.mm-modal [data-act="close"]').click();
    await page.locator('[data-filter="SPELL"]').click();
    await expect(page.locator('[data-card="arrows"]')).toBeVisible();
    await expect(page.locator('[data-card="knight"]')).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
