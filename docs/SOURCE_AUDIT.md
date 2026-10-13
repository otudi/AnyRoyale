# Source audit and engine choice

Audit date: 2026-10-13. Every repository was cloned, its licence file read, its file tree and
engine code inspected, and (where it can run on Linux without third-party game binaries) built
and tested. Commit SHAs are the exact revisions audited.

## Summary

| Project | Commit | Licence | Tech | Runs headless on Linux | Used in AnyRoyale |
|---|---|---|---|---|---|
| [voonhous/crforge](https://github.com/voonhous/crforge) | `b41cf9b6276945152ec4c869ce56f98a5fa3f513` | Apache-2.0 | Java 17, Gradle, Jackson, Lombok | **Yes — built, 933/933 tests pass** | **Yes: battle engine (vendored core + data)** |
| [Jaasssoooonnnnn/FirstLight_CR](https://github.com/Jaasssoooonnnnn/FirstLight_CR) | `3ade158c52bf33de3ffcea600ce380946b7de0d8` | Apache-2.0 (game files excluded) | Python 3.12, PyTorch, Android probe | No — needs Null's Royale 15.535.13 APK in a MuMu Android 12 emulator | No code (reference only, see below) |
| [Jaasssoooonnnnn/FL-Royale](https://github.com/Jaasssoooonnnnn/FL-Royale) | `cf16ef1759f465d74f1797c5e92fe3d939bbb4fc` | Apache-2.0 (game files excluded) | Android APK patching, ONNX export, Java/Python on-device | No — produces a modified Android APK from user-supplied game files | No |
| [Jason-XII/clash-royale-simulator](https://github.com/Jason-XII/clash-royale-simulator) | `82bcbf3088102318125fc0193f0e5bc38e7886b2` | **None** (all rights reserved) | Python, pygame, SB3 | Yes (Python) | No code; behaviour notes only |
| [ironiamison/clash-arena](https://github.com/ironiamison/clash-arena) ("TrenchRoyal") | `19d0654f3824a2c62da8e2d7f79795733f4e9a51` | **None** in repo | TypeScript, Phaser 3 (2D), Node `ws` relay, Privy auth | Yes | No code; architecture reference only |
| [kylemath/ClashRoyale](https://github.com/kylemath/ClashRoyale) | `917f84e7ec4edc2783dbcbd57968b407ffa53eaa` | **None** | React, socket.io | Yes | No code |

Projects without a licence file are copyrighted by default; nothing from them was copied.

## crforge — chosen engine

What exists and works (verified by reading the code and running the tests):

- `GameEngine` with a fixed 20 TPS tick and a documented 17-step system order; deterministic
  (seeded targeting RNG, seeded hand shuffle, fixed-point position integration).
- `Standard1v1Match`: 3:00 regular time, double elixir in the last minute, 2:00 overtime with
  triple elixir after one minute, crown / tower-HP tie-breaks, draw.
- Arena: 18x32 tiles, river rows 15-16, two 3-wide bridges, tower footprints, banned corners,
  pocket deployment zones opened by destroyed princess towers, freed tower tiles.
- Elixir (start 5, 2.8 s regen, ×2/×3 multipliers, cap 10), 8-card deck, 4-card hand + next card,
  card cycle, Mirror.
- Targeting (two-phase locking, ground/air/buildings-only, retention range), melee/ranged combat,
  projectiles (homing, position-targeted, piercing, returning, scatter, chain lightning,
  spawn-on-impact), area effects (one-shot, ticking, targeted, laser), status effects (stun, slow,
  rage, freeze, poison, curse...), abilities (charge, dash, hook, reflect, tunnel, hiding,
  variable damage, buff ally...), death spawns/damage, spawners, transformations, level scaling.
- Card data: 240 records loaded from JSON with reference resolution; upstream tracker lists 113
  cards as DONE (champions, evolutions, hero variants and some special-mode cards are not).
- 933 unit/integration tests in `core` and `data`.

Problems found and fixed in the vendored copy (details: `server/engine/VENDOR.md`):

1. Global static entity/projectile id counters reset by `GameState.reset()` — unsafe with several
   matches in one server process (duplicate ids). Added per-engine id allocators (opt-in, upstream
   tests unchanged).
2. Tornado (`spellAsDeploy` + `canDeployOnEnemySide`) was rejected on the enemy half. Fixed.
3. A king-tower kill is recorded on `GameState` (not `Match`); AnyRoyale reads both (server-side).

Not taken: `desktop/` (LibGDX debug viewer), `gym-bridge/` and `python/` (RL bridge).

## FirstLight CR / FL Royale — why not used

- Both drive the **original Android client** (a specific Null's Royale build) through a native
  probe inside an Android emulator (FirstLight) or a patched APK (FL Royale). The battle logic is
  the game binary itself; there is no portable engine in the repositories. Shipping that to the
  browser would mean emulating Android or streaming video, both explicitly forbidden.
- The released AI checkpoints (≈48 MB each, PyTorch, Apache-2.0) take a "V4" tensor input built
  from native-engine telemetry: card vocab ids and runtime forms, tower features and extents,
  48 "groups", effects and pairwise relations (see FL Royale
  `research/mobile_inference/production_tensor_schema_uint8.json`). crforge does not produce those
  semantics (different entity model, no runtime-form ids, no relation features), so feeding it
  would be out-of-distribution input; running 48 MB models per bot per tick on a small Render
  instance is also impractical. AnyRoyale's bots are therefore engine-native (see
  `docs/ARCHITECTURE.md` → Bots), and their strength ordering is measured by tests.
- Ideas taken (no code): opponent difficulty as decision quality rather than stats; evaluation
  by bot-vs-bot series.

## Jason-XII simulator

Python, 47 cards, A* pathfinding, LAN play over sockets. No licence file, so no code could be
reused. It confirmed the expected behaviours checked in AnyRoyale tests (lane/bridge pathing,
tower targeting) but crforge already implements them with tests.

## Web projects (clash-arena, kylemath)

- clash-arena: Phaser 3 2D lane battler with original card names/stats, Node WebSocket relay,
  Privy wallet auth, AI fallback in the queue. Useful as a reference for client/relay separation;
  its design (bot fallback in ranked queue, accounts) conflicts with AnyRoyale requirements, and
  there is no licence, so nothing was reused.
- kylemath/ClashRoyale: React + socket.io prototype with client-side simulation; no licence.

## Resulting architecture

One Java 17+ service runs crforge authoritatively (one engine per match) and serves a
TypeScript/three.js client over HTTP + WebSocket; see `docs/ARCHITECTURE.md`.
