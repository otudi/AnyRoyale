#!/usr/bin/env node
// Run with Node >= 22.18 after `npm ci` in apps/web.
// Validates the live CardPool, not a hard-coded card count or documentation table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';
import { CARD_TEXTS } from '../../apps/web/src/game/cardTexts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const records = JSON.parse(read('server/engine/crforge-data/src/main/resources/cards/cards.json'));
const poolSource = read('server/app/src/main/java/com/anyroyale/server/cards/CardPool.java');
const ids = [...poolSource.split('List.of(')[1].split(');')[0].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
assert.match(poolSource, /DISABLED = Map\.of\(\)/, 'Update this check if CardPool disables cards');
assert.equal(new Set(ids).size, ids.length);
const byId = new Map(records.map((c) => [c.id, c]));
const audit = JSON.parse(read('docs/card-name-audit.json'));
assert.equal(audit.filter((c) => c.playable).length, ids.length);
assert.deepEqual(audit.filter((c) => c.playable).map((c) => c.id).sort(), [...ids].sort());
const champions = records.filter((c) => c.type === 'HERO' && c.cost > 0 && !c.id.endsWith('_hero'));
for (const id of [...ids, ...champions.map((c) => c.id)]) {
  assert.ok(byId.has(id), `Unknown Card ID: ${id}`);
  const text = CARD_TEXTS[id];
  assert.ok(text, `Missing display text: ${id}`);
  for (const field of ['en', 'ar', 'de', 'da']) assert.ok(text[field]?.trim(), `${id}: missing ${field}`);
  assert.match(text.ar, /[\u0600-\u06ff]/, `${id}: not Arabic`);
}
for (const lang of ['en', 'ar']) {
  const names = Object.values(CARD_TEXTS).map((c) => c[lang].normalize('NFKC').trim().toLowerCase());
  assert.equal(new Set(names).size, names.length, `Duplicate ${lang} display names`);
}
for (const entry of audit) {
  assert.equal(CARD_TEXTS[entry.id].en, entry.en);
  assert.equal(CARD_TEXTS[entry.id].ar, entry.ar);
  if (entry.decision === 'rename') {
    assert.notEqual(entry.en, entry.oldEn);
    if (entry.oldAr) assert.notEqual(entry.ar, entry.oldAr);
  }
  if (entry.decision === 'keep') {
    assert.equal(entry.en, entry.oldEn);
    if (entry.oldAr) assert.equal(entry.ar, entry.oldAr);
  }
}

// Exercise the actual label functions, including switching the active language on the same card.
globalThis.localStorage = { getItem: () => 'en', setItem: () => {} };
globalThis.document = { documentElement: {} };
const stringsUrl = pathToFileURL(path.join(root, 'apps/web/src/i18n/strings.ts')).href;
const { setLang } = await import(stringsUrl);
let source = ts.transpileModule(read('apps/web/src/ui/cardLabels.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
source = source.replace('../game/cardTexts', pathToFileURL(path.join(root, 'apps/web/src/game/cardTexts.ts')).href)
  .replace('../i18n/strings', stringsUrl);
const { cardName, cardDesc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
for (const id of ids) {
  const card = { id, name: byId.get(id).name };
  const original = structuredClone(card);
  for (const lang of ['ar', 'en', 'ar']) {
    setLang(lang);
    assert.equal(cardName(card), CARD_TEXTS[id][lang]);
    assert.equal(cardName(card, 'en'), CARD_TEXTS[id].en);
    assert.equal(cardDesc(card), CARD_TEXTS[id][lang === 'ar' ? 'da' : 'de']);
  }
  assert.deepEqual(card, original, 'Display lookup must not mutate network data');
}
// Guard the formerly leaking UI locations and existing battle text/pre-match paths.
const app = read('apps/web/src/ui/App.ts');
const hud = read('apps/web/src/ui/Hud.ts');
assert.doesNotMatch(app, /prettyName\(c\.name\)/);
assert.doesNotMatch(hud, /(?:img\.alt|el\.title)\s*=\s*card\.name/);
assert.match(app, /cardName\(c, 'en'\)/);
assert.match(read('apps/web/src/game/BattleView.ts'), /this\.fx\.label\(cardName\(card\)/);
console.log(`PASS: ${records.length} engine records, ${ids.length} playable bilingual names, ${champions.length} reserved champions, unique names, language switching and unmodified network names.`);
