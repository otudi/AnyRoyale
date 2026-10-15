import { expect, test } from '@playwright/test';
import { CARD_TEXTS } from '../../../apps/web/src/game/cardTexts';
import { openPlayer, state, surrender, waitRunning } from './helpers';

test('every card shows its bilingual display name, portrait, cost and stats', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, ctx, errors } = await openPlayer(browser, { locale: 'en-US' });
  const catalog = await (await page.request.get('/api/cards')).json();
  for (const lang of ['en', 'ar', 'en'] as const) {
    await page.locator('[data-act="cards"]').click();
    await expect(page.locator('[data-card]')).toHaveCount(catalog.cards.length);
    for (const c of catalog.cards) {
      const tile = page.locator(`[data-card="${c.id}"]`);
      await expect(tile.locator('.nm')).toHaveText(CARD_TEXTS[c.id][lang]);
      await expect(tile.locator('.mm-cost')).toHaveText(String(c.cost));
    }
    // Open every detail through its real UI event handler (no mock card data).
    const details = await page.evaluate((ids: string[]) => ids.map((id) => {
      document.querySelector<HTMLButtonElement>(`[data-card="${id}"]`)!.click();
      const modal = document.querySelector<HTMLElement>('.mm-modal')!;
      const image = modal.querySelector<HTMLImageElement>('.mm-detail-head img')!;
      const result = {
        id,
        name: modal.querySelector('.nm')!.textContent,
        english: modal.querySelector('.en')?.textContent ?? null,
        desc: modal.querySelector('.mm-desc')!.textContent,
        cost: modal.querySelector('.mm-badge.cost')!.textContent,
        stats: modal.querySelectorAll('.mm-stat').length,
        portrait: image.src,
      };
      modal.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
      return result;
    }), catalog.cards.map((c: { id: string }) => c.id));
    for (const d of details) {
      const c = catalog.cards.find((c: { id: string }) => c.id === d.id)!;
      expect(d.name).toBe(CARD_TEXTS[d.id][lang]);
      expect(d.english).toBe(lang === 'ar' ? CARD_TEXTS[d.id].en : null);
      expect(d.desc).toBe(CARD_TEXTS[d.id][lang === 'ar' ? 'da' : 'de']);
      expect(d.cost).toContain(String(c.cost));
      expect(d.stats).toBeGreaterThan(0);
      expect(d.portrait).toMatch(/^data:image\//);
    }
    await expect.poll(() => page.locator('img[data-art]').evaluateAll((imgs) =>
      imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
    )).toBe(true);
    await page.locator('[data-act="back"]').click();
    await page.locator('[data-act="lang"]').click();
  }
  expect(errors).toEqual([]);
  await ctx.close();
});

for (const lang of ['en', 'ar'] as const) {
  test(`pre-match deck and battle card tooltips use ${lang} names`, async ({ browser }) => {
    const { page, ctx, errors } = await openPlayer(browser, { locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    await page.locator('[data-act="bot"]').click();
    await page.locator('[data-act="d_easy"]').click();
    await expect(page.locator('[data-screen="intro"] .mm-tile')).toHaveCount(8);
    // the intro is up before the battle session exists (it waits for the deck's models)
    await expect.poll(async () => (await state(page)).match?.deck?.length ?? 0).toBe(8);
    const deck = (await state(page)).match!.deck;
    const titles = await page.locator('[data-screen="intro"] .mm-tile').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(titles).toEqual(deck.map((id) => CARD_TEXTS[id][lang]));
    await waitRunning(page);
    await expect(page.locator('[data-slot][data-card], [data-next][data-card]')).toHaveCount(5);
    for (const card of await page.locator('[data-slot][data-card], [data-next][data-card]').all()) {
      const id = (await card.getAttribute('data-card'))!;
      await expect(card).toHaveAttribute('title', CARD_TEXTS[id][lang]);
      await expect(card.locator('img')).toHaveAttribute('alt', CARD_TEXTS[id][lang]);
    }
    await surrender(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
