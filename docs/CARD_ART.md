# Card illustrations

Every playable card has a dedicated illustration in `apps/web/public/assets/card-art/<card-id>.webp`.
These images were generated for AnyRoyale with the built-in image generation tool. They are UI illustrations, independent of the battlefield models.

- Source: card names and gameplay descriptions in `apps/web/src/game/cardTexts.ts`.
- Inventory and generation direction: `docs/card-art-manifest.json`.
- Export: 384 × 480 pixels, WebP quality 85.
- Composition: a large readable character, signature weapon, spell effect or complete building, on a dark background; no embedded text or UI.
- `CardArt.preload` loads illustrations alongside the core models. Each image is composed into the existing rarity frame and cached at 240 × 300.
- Missing, failed or slow images retain the existing model/spell fallback. Loading does not wait longer than eight seconds for illustrations.
- The hand, collection, details and match introduction share the same `CardArt.get` path.
- When replacing artwork, increment the image URL revision in `CardArt.ts` because `/assets/` uses immutable HTTP caching.

No gameplay stats, card names, models or multiplayer behavior are changed.
