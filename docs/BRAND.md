# AnyRoyale — Brand identity / هوية اللعبة

This is the single source of truth for how AnyRoyale looks, sounds and feels outside the 3D
arena: menus, HUD, icons, logo, store/meta images. Every UI change is checked against it (see the
`brand-designer` agent in `.claude/agents/`). Everything here is original to AnyRoyale; do not
import the look, art, fonts or icons of another game or product.

## 1. Idea / الفكرة

**"ساحة الممالك" — Royal Night & Gold.** Two small kingdoms meet on a lane arena at night, under
torchlight. The menus are the castle hall before the battle: deep night blue stone, warm gold trim,
banners in the two team colours. Playful and chunky (rounded shapes, thick outlines, pressable
buttons), never grim or realistic.

Personality: confident, friendly, quick. One tap to battle. No clutter, no fake currencies, no
pressure tactics.

Tagline — AR: «نفس التشكيلة... والمهارة تحسم» · EN: "Same deck. Pure skill."

## 2. Logo / الشعار

- **Crest**: a rounded heater shield split diagonally into the two team colours (blue start side,
  red end side), a gold rim, a gold crown sitting on the top edge and a white "A" monogram whose
  crossbar is a sword guard. Built in code (`apps/web/src/ui/brand.ts → crest()`), so it is crisp at
  any size and needs no image file.
- **Wordmark**: "AnyRoyale" in Baloo Bhaijaan 2 ExtraBold, gold gradient fill, dark navy outline and
  a 3 px drop. "Any" and "Royale" are one word, capital A and R.
- Lock-up: crest above the wordmark (menus); crest alone for the favicon / app icon.
- Clear space around the crest ≥ ¼ of its width. Never stretch, recolour per screen or add
  effects beyond the defined glow.

## 3. Colour / الألوان

| Token | Hex | Use |
|---|---|---|
| `--night-900` | `#0b1030` | deepest background, outlines |
| `--night-800` | `#141b45` | page background |
| `--night-700` | `#1d2660` | panels |
| `--night-600` | `#2a3580` | raised panels, inputs |
| `--gold-300` | `#ffe08a` | highlights, gold text top |
| `--gold-500` | `#ffc23d` | primary action, rims |
| `--gold-700` | `#c9800e` | gold button depth |
| `--ivory` | `#fff6e0` | text on dark, parchment (day theme) |
| `--blue-team` | `#3d8bff` | own side, secondary action |
| `--red-team` | `#ff4d5a` | enemy side, danger / surrender |
| `--elixir` | `#c04bff` | elixir, cost badges |
| `--green-ok` | `#38c172` | success, "easy" |

Day theme ("Daylight") keeps the same components on a sky-blue scene with ivory parchment panels
and navy ink. Team colours always mean: blue = you, red = opponent. Never use red for a neutral
action.

## 4. Type / الخطوط

- **Baloo Bhaijaan 2** (OFL, Arabic + Latin, bundled via `@fontsource`): 800 for titles, buttons
  and numbers; 600 for labels; 500 for body. One family for both languages keeps Arabic and English
  screens the same shape.
- Titles: ExtraBold, ivory or gold, with a 2 px navy outline/drop (`--title-shadow`).
- Numbers (cost, HP, timer, crowns): ExtraBold, tabular where they change.
- Minimum body size 14 px on phones; buttons 18–22 px.

## 5. Shape & components / الأشكال والمكونات

- Radius: 14 px (buttons, tiles), 20 px (panels, sheets). Outline 3 px `--night-900` on every
  pressable thing; a 1 px inner highlight on top.
- **Buttons** are pressable blocks: gradient face, 6 px depth below in a darker tone; on press the
  face drops 4 px and the depth shrinks. Variants: `gold` (primary — one per screen), `blue`
  (secondary), `red` (danger), `stone` (neutral).
- **Panels** ("royal plates"): night gradient, 3 px dark outline, gold hairline inside.
- **Menu background**: the castle courtyard illustration supplied by the owner
  (`apps/web/public/assets/ui/menu-bg.webp`): blue and red banners on twin keeps, a bridge and
  river in the valley, a stone terrace in front. It sits in a fixed layer (`#menu-bg`) behind every
  menu, extended past the screen edges in its sky and stone colours; night mode tints it.
- **Ribbon titles**: screen titles sit on a gold ribbon banner with folded ends.
- **Tiles**: cards and modes are tiles with an illustration area and a label strip.
- **Icons**: Material Icons for utility glyphs (settings, sound, back…), custom SVG for brand
  glyphs (crest, crossed swords, crown). Icons inside buttons sit on a darker round plate.
- Motion: 120–300 ms, ease-out; a press is instant (60 ms). Respect `prefers-reduced-motion`.

## 6. Layout & UX rules / قواعد الاستخدام

1. One primary action per screen, in gold, reachable by the thumb (lower half on phones).
2. Back is always at the top start corner; destructive actions ask once (surrender).
3. Text is short and in the player's language; Arabic is RTL with the same layout mirrored.
4. Touch targets ≥ 44 px; spacing on an 8 px grid; 16 px side gutters on phones.
5. Contrast ≥ 4.5 : 1 for text; never put text on busy art without a plate behind it.
6. The battle HUD stays minimal: the arena is the hero; HUD pieces use the same plates and fonts.
7. Both themes and both languages must be checked before shipping a UI change.

## 7. Voice / النبرة

Short, warm, game-like verbs: «معركة»، «تدريب»، «البطاقات»، «إعادة»، «انسحاب». English:
"Battle", "Training", "Cards", "Rematch". No exclamation spam, no dark patterns.

## 8. Don't / ممنوع

- No assets, UI layouts, fonts or icons copied from other games or apps (including the owner's
  other projects) — AnyRoyale has its own look.
- No flat white "app" cards, no thin hairline buttons, no system fonts for titles.
- No more than one gold button per view; no gradients outside the defined tokens.
