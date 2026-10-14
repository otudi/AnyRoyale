# Vendored engine: crforge

| | |
|---|---|
| Upstream | https://github.com/voonhous/crforge |
| Pinned commit | `b41cf9b6276945152ec4c869ce56f98a5fa3f513` (2026-09-21) |
| License | Apache License 2.0 (`LICENSE`, `NOTICE` in this directory) |
| Copied | `core/src` → `crforge-core/src`, `data/src` → `crforge-data/src` (main + tests), `gradle/wrapper`, `gradlew*`, `docs/*.md` → `upstream-docs/` |
| Not copied | `desktop/` (LibGDX debug viewer), `gym-bridge/` + `python/` (RL bridge), `tools/` |

Upstream tests are kept and run in CI (`./gradlew :crforge-core:test :crforge-data:test`, 933 tests).

## AnyRoyale modifications (Apache-2.0 §4(b): modified files carry a notice)

1. **Per-engine entity ids** — new `org/crforge/core/util/EntityIds.java`; `AbstractEntity`,
   `Projectile`, `GameEngine` changed. Upstream used global static id counters that
   `GameState.reset()` rewinds to 1. In a server running matches concurrently, one match starting
   would rewind another match's ids and produce duplicate entity ids (entities compare by id).
   `GameEngine.useIsolatedEntityIds()` (called by AnyRoyale for every match) gives each engine its
   own counters, bound to the ticking thread. Without the call behaviour is unchanged, so all
   upstream tests still pass.
2. **Tornado placement** — `match/Match.java`: `spellAsDeploy` spells were always limited to the
   player's own side, which wrongly rejected Tornado (data: `canDeployOnEnemySide: true`) on the
   enemy side. Now only `spellAsDeploy` spells without `canDeployOnEnemySide` (Log, Barbarian
   Barrel, Heal Spirit, Royal Delivery) are restricted. Regression test:
   `server/app/src/test/java/com/anyroyale/server/match/SpellPlacementRegressionTest.java`.
3. **Configurable placement delay** — `engine/DeploymentSystem.java` and `engine/GameEngine.java`:
   the 1.0 s `PLACEMENT_SYNC_DELAY` between a play and its deploy timer is now a per-engine value
   (`GameEngine.setPlacementSyncDelay`), default unchanged so upstream tests are unaffected.
   AnyRoyale uses 0.3 s (`BattleSetup.PLACEMENT_DELAY`), identical for both players.

The build no longer applies upstream's Spotless formatter or the Gradle JDK-17 toolchain
download; bytecode still targets Java 17 (`options.release = 17`).
