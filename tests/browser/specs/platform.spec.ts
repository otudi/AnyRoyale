import { expect, test } from '@playwright/test';
import { openPlayer, state } from './helpers';

test('audio starts after the first user gesture and effects are synthesised', async ({ browser }) => {
  const p = await openPlayer(browser);
  expect((await state(p.page)).audio.unlocked).toBe(false);
  await p.page.locator('[data-act="settings"]').click();
  await expect.poll(async () => (await state(p.page)).audio.unlocked).toBe(true);
  await expect.poll(async () => (await state(p.page)).audio.state, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => (await state(p.page)).audio.ready, { timeout: 20_000 }).toBe(true);
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
