# Character forge

Builds a separate model (`forged_<Unit>.glb`) for every human unit, so units that used to share a
KayKit body with a different tint now each have their own look.

How a unit is made (`forge.py`, run headless in Blender 4.2):

1. **Parts:** every KayKit Adventurers/Skeletons character uses the same skeleton, so a unit can
   combine a head, body, arms, legs and weapons from different characters.
2. **Colours:** each texture region (skin, hair, cloth, leather, metal…) is recoloured on its own,
   keeping the original light-to-dark shading.
3. **Accessories:** procedural crowns, helmets with visors, horns, ears, beards, armour, wings,
   capes, spears, hammers, staffs… are attached to bones.
4. **Merge:** everything is merged into one skinned mesh with one 512 px atlas (`Body`), plus a
   `Team` mesh that the game tints blue or red. That's 2 draw calls per unit instead of ~8.

No animation is exported: the game plays the shared clip library (`anims.glb`) on the same bones.

## Rebuild

```sh
cd tools/asset-pipeline && npm ci && node build.mjs     # clones the pinned CC0 packs into .cache
cd ../character-forge
python3 recipes.py                                      # writes recipes.json
blender --background --python forge.py -- recipes.json out [Unit ...]
cd ../asset-pipeline && node build.mjs                  # compresses out/*.glb into apps/web/public/assets/models
```

To preview, run `python3 -m http.server 8123` from the repository root and open
`/tools/character-forge/preview/index.html?u=Knight,Wizard&a=Idle`.

After adding a unit to `recipes.py`, list it in `FORGED_UNITS` (or `FORGED_ALIASES`) in
`apps/web/src/rendering/visualCatalog.ts`. If a listed file is missing or still downloading, the
unit falls back to its old KayKit look.

The designs are original stylised interpretations of each card's role, built from CC0 parts. They
are not copies of any game's art.
