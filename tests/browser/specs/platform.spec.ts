import { expect, test } from '@playwright/test';
import { contextOptions, openPlayer, state } from './helpers';

test('audio starts after the first user gesture and the recorded effects decode', async ({ browser }) => {
  const p = await openPlayer(browser);
  expect((await state(p.page)).audio.unlocked).toBe(false);
  await p.page.locator('[data-act="settings"]').click();
  await expect.poll(async () => (await state(p.page)).audio.unlocked).toBe(true);
  await expect.poll(async () => (await state(p.page)).audio.state, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => (await state(p.page)).audio.ready, { timeout: 20_000 }).toBe(true);
  // Every recorded sample (MP3, decodable in Chromium, WebKit and Firefox) is decoded.
  const index = await (await p.page.request.get('/assets/sfx/index.json')).json();
  await expect.poll(async () => (await state(p.page)).audio.samples, { timeout: 20_000 }).toBe(Object.keys(index.sounds).length);
  await p.ctx.close();
});

test('calm menu music plays; the mute button silences it completely; battles switch track', async ({ browser }) => {
  const p = await openPlayer(browser);
  const music = async () => (await state(p.page)).audio.music as { track: string | null; playing: boolean; muted: boolean };
  await p.page.locator('[data-act="cards"]').click(); // first gesture unlocks audio
  await p.page.locator('[data-act="back"]').click();
  await expect.poll(async () => (await music()).track, { timeout: 10_000 }).toBe('menu');
  await expect.poll(async () => (await music()).playing, { timeout: 10_000 }).toBe(true);
  // mute: the music element itself stops (not only the Web Audio gain)
  await p.page.locator('[data-act="mute"]').click();
  await expect.poll(async () => (await music()).playing).toBe(false);
  expect((await music()).muted).toBe(true);
  // unmute: the same track resumes
  await p.page.locator('[data-act="mute"]').click();
  await expect.poll(async () => (await music()).playing, { timeout: 10_000 }).toBe(true);
  // a battle switches to the battle theme
  await p.page.locator('[data-act="bot"]').click();
  await p.page.locator('[data-act="d_easy"]').click();
  await expect.poll(async () => (await music()).track, { timeout: 40_000 }).toBe('battle');
  await p.ctx.close();
});

test('every model in the asset index loads; arena themes match the server list', async ({ browser, request }) => {
  const p = await openPlayer(browser);
  expect((await state(p.page)).failedAssets).toEqual([]);
  const index = await (await request.get('/assets/models/index.json')).json();
  const files = Object.keys(index.files);
  expect(files.length).toBeGreaterThanOrEqual(15);
  for (const f of files) {
    const res = await request.get(`/assets/models/${f}`);
    expect(res.status(), f).toBe(200);
    expect(res.headers()['content-type']).toContain('model/gltf-binary');
    expect((await res.body()).length).toBe(index.files[f].bytes);
  }
  const arenas = (await (await request.get('/api/arenas')).json()).arenas.map((a: any) => a.id);
  const clientThemes: string[] = await p.page.evaluate(() => (window as any).__anyroyaleThemes ?? []);
  expect([...clientThemes].sort()).toEqual([...arenas].sort());
  await p.ctx.close();
});

test('health endpoint and card catalog reflect the engine', async ({ request }) => {
  const health = await (await request.get('/healthz')).json();
  expect(health.status).toBe('ok');
  expect(health.cards).toBe(111);
  const cards = await (await request.get('/api/cards')).json();
  expect(cards.count).toBe(111);
  expect(cards.level).toBe(11);
  for (const c of cards.cards) {
    expect(c.cost).toBeGreaterThan(0);
    expect(['TROOP', 'SPELL', 'BUILDING']).toContain(c.type);
  }
});

test('without WebGL the player gets a clear message instead of a blank page', async ({ browser }) => {
  const ctx = await browser.newContext(contextOptions());
  await ctx.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as any).call(this, type, ...rest);
    } as typeof original;
  });
  const page = await ctx.newPage();
  await page.goto('/');
  const screen = page.locator('[data-screen="error"]');
  await expect(screen).toBeVisible({ timeout: 30_000 });
  await expect(screen).toContainText('WebGL');
  await expect(screen.locator('[data-act="retry"]')).toBeVisible();
  await ctx.close();
});
