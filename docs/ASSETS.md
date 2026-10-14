# Assets

AnyRoyale ships **no Clash Royale / Supercell files**: no models, textures, sounds, music, fonts,
card art or logos. Everything you see or hear comes from one of three sources:

| Source | What | Licence |
|---|---|---|
| KayKit packs by Kay Lousberg (pinned commits, below) | rigged humanoid characters, skeletons, medieval buildings (card buildings, tower ruins), props, weapons, one shared animation library | CC0 1.0 |
| Code in `apps/web/src/rendering/` | procedural low-poly creatures/machines, crown towers, arena terrain, river, bridges, particles, projectiles, card icons | this repository |
| npm packages `@fontsource/tajawal` 5.2.7, `material-icons` 1.13.14 (bundled at build time) | Tajawal font (Arabic + Latin) and Material Icons used by the menus | OFL-1.1 / Apache-2.0 |
| Code in `apps/web/src/audio/` | every sound effect and both music tracks, synthesised with Web Audio at load time | this repository |

None of these is the original artwork, and none is presented as identical to it. Unit names come
from the crforge card data (Apache-2.0); the game is not affiliated with or endorsed by Supercell.

## 3D models (`apps/web/public/assets/models`, ≈3.3 MB)

Built by `tools/asset-pipeline/build.mjs` from these sources (`tools/asset-pipeline/sources.json`):

| Pack | Repository | Commit |
|---|---|---|
| Adventurers Character Pack 1.0 | KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | `672074b73ba276876a19e8816ecdc5241817ab47` |
| Character Pack: Skeletons 1.0 | KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | `15b62b9bad122f72926c10fb14d622c73819fa54` |
| Medieval Hexagon Pack 1.0 | KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | `84fa4e91af6a88989be7c99e0891cede11f2ca38` |
| Dungeon Remastered 1.0 | KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | `b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07` |
| Halloween Bits 1.0 | KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | `6dc69bf6b2fa766a985754f35ec6a0324090e6c6` |

The pipeline:

1. clones each pack at its pinned commit into `tools/asset-pipeline/.cache` (git-ignored);
2. keeps only the meshes listed in `tools/asset-pipeline/manifest.json`;
3. moves all animation clips (26) into `anims.glb` and strips them from the characters, also
   dropping IK/control channels that the runtime does not need;
4. prunes, deduplicates, quantises and meshopt-compresses (`@gltf-transform` 4.5.1,
   `meshoptimizer` 1.3.0);
5. writes `index.json` with byte size, SHA-256 and origin (pack, repo, commit, path) of every file.

Rebuild: `cd tools/asset-pipeline && npm ci && node build.mjs`.

### Coverage of the 111 playable cards (from `docs/CARD_SUPPORT.md`)

| Graphics used by a card | Cards |
|---|---|
| uses a CC0 rigged character (KayKit) for at least one of its units | 62 |
| uses a procedural model for at least one of its units | 42 |
| uses a CC0 building | 12 |
| spell drawn with procedural area/projectile VFX | 22 |

Cards whose units are **only** procedural stand-ins (no suitable CC0 model exists for flying
creatures, golems, dragons and machines): Minions, Balloon, Golem, Baby Dragon, Minion Horde,
Lava Hound, Ice Spirits, Fire Spirits, Zap Machine (Sparky), Inferno Dragon, Ice Golem,
Mega Minion, Bats, Mini Sparkys, Dart Barrel, Royal Hogs, Electro Dragon, Elixir Golem,
Skeleton Dragons, Electro Spirit, Phoenix, Goblin Machine, Merge Maiden, Fire Spirit Hut, and
the Rage/Heal spells. They have simple procedural animation (wing flaps, bobbing, wheel spin) but
no skeletal animation.

Humanoid units share a small set of CC0 bodies (knight, barbarian, mage, rogue, hooded rogue and
four skeleton types) distinguished by scale, weapon, team-coloured cape/hat and tint. So for
example Knight, Prince and Valkyrie are visibly different but are not faithful recreations of the
originals.

## Audio

All audio is synthesised by `apps/web/src/audio/sfx.ts` (40 effects rendered once into
`AudioBuffer`s with `OfflineAudioContext`) and `music.ts` (menu and battle loops built from
oscillators and noise). There are no audio files to download, so there is nothing to cache and
nothing that can fail to load. Effects are chosen by category (deploy, melee weapon type, ranged
projectile type, spell type, death, tower events, countdown, victory/defeat); there are **no
per-card voice lines**. Safari/iOS: the `AudioContext` is created and resumed inside the first
user gesture and a silent buffer is played to unlock output.

## Missing compared with the original game

- Original 3D models, textures and animations for every unit, building, tower and arena.
- Original card artwork (cards show generated icons: unit silhouette, type colour, cost).
- Original sound effects, voice lines and music.
- Arena decorations of the 8 themed arenas are recoloured CC0 props, not the original arenas.
- Emotes, card-specific deploy/death animations, evolution and champion visuals (those cards are
  not playable, see `docs/CARD_SUPPORT.md`).

## Using game files you own

`tools/asset-inventory/inventory.py` lists the content of an APK/XAPK or extracted folder that
you are entitled to analyse (formats, sizes, hashes, what would need conversion). It writes only
to `tools/asset-inventory/output/` (git-ignored) and never uploads or copies asset contents.

Owning a copy of the game, or a tool's open-source licence, does **not** give the right to
redistribute its assets. Do not commit extracted files to this repository or deploy them to a
public server unless you hold a licence that allows it. `.gitignore` excludes `*.apk`, `*.xapk`,
`user-provided/` and the inventory output to avoid accidental commits.

If licensed replacement assets become available, the integration points are:
`apps/web/src/rendering/visualCatalog.ts` (entity → model/visual), `tools/asset-pipeline/manifest.json`
(which meshes to build) and `apps/web/src/audio/AudioManager.ts` (swap synthesised buffers for
decoded files; provide AAC/MP3 next to OGG for Safari).

## Menu design

The menu screens (layout, pressed-3D buttons, circle buttons, setup cards, code boxes, help
overlay, Arabic/English toggle) follow the owner's own menu design from their game, recoloured
for AnyRoyale (`apps/web/src/ui/menu.css`). Card descriptions on the Cards page are original
short texts (`apps/web/src/game/cardTexts.ts`); numbers come from the engine.
