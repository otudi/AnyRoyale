# Test report

Date: 2026-10-13. Branch `claude/anyroyale-browser-game-6g7zwk`.
Two environments were used: a Linux dev container (JDK 21, Node 22, Chromium 1194 with
SwiftShader software WebGL, Docker; no GPU, no WebKit or Firefox binaries) and GitHub Actions
(`ubuntu-latest`, Playwright-installed Chromium, WebKit and Firefox).

**Not tested at all:** a real iPhone or iPad, a real Android phone, Safari on macOS, and a Render
deployment. Playwright's WebKit build on Linux is close to Safari's engine, but it is **not**
Safari on iOS: it does not reproduce iOS memory limits, GPU behaviour, audio-session rules, or
Safari's own UI.

## 1. Engine (vendored crforge)

| Suite | Tests | Result |
|---|---|---|
| `:crforge-core:test` | 892 | all pass |
| `:crforge-data:test` | 41 | all pass |

These are the upstream tests run unchanged against the modified copy (see
`server/engine/VENDOR.md`).

## 2. Server

`:server:test`: 145 tests. 143 pass; 2 are diagnostic tools that only run when an environment
variable is set (`BotDebugTest`, `BotExperimentTest`) and are skipped otherwise.

| Class | What it proves |
|---|---|
| `CardPoolSmokeTest` (111) | every pool card deploys in a real engine match and produces entities |
| `EntityInventoryTest` | records the entities of each card (feeds docs/CARD_SUPPORT.md) |
| `SharedRandomDeckGeneratorTest` (5) | same seed ⇒ same deck and order; decks valid; whole pool appears across 4,000 decks; validator rejects decks without air defence or spells |
| `FairnessTest` (11) | identical hand, next card and cycle for both players; equal levels, elixir and towers; 180°-rotated identical plays give rotated outcomes (no seat advantage) |
| `MatchSessionTest` (11) | same deck/arena for both seats; snapshots hide the opponent's hand/elixir; valid play acknowledged and visible to both; illegal plays rejected with reasons; duplicate sequence numbers ignored; a stranger cannot act; surrender; resume within grace, forfeit after; rematch needs both; missing player ⇒ cancelled; full bot match's replay reproduces exactly |
| `HiddenInformationTest` | invisible enemy troops are not sent to the opponent |
| `SpellPlacementRegressionTest` (2) | Tornado can be cast on the enemy side; normal spell rules unchanged |
| `BotTournamentTest` | strength ordering of bot levels (below) |

### Bot strength (BotTournamentTest)

30 full matches per pairing on fixed seeds (random shared decks, both seat orders). Results from
the current code:

| Pairing | Wins | Required |
|---|---|---|
| Expert vs Hard | 16-14 | Expert > Hard |
| Hard vs Normal | 20-10 | Hard > Normal |
| Normal vs Easy | 21-9 | Normal > Easy |
| Expert vs Easy | 25-5 | ≥ 75 % |

The levels differ only in `BotProfile` decision parameters. Card stats and levels are identical.
Expert vs Hard is close (16-14). With random shared decks the deck draw matters a lot, so this
margin can move by a few matches with another seed set. Expert's edge over Hard is small; the
other gaps are clear.

Before the last fix, the Expert bot could stall with a hand of only buildings and spells (4 plays
in 3 minutes). It now spends elixir before it leaks, with any card type. In a full real-time
browser match against an idle player it now wins by king tower, 3-0, in 80 s (7 plays). Before
the fix it won 1-0 on crowns after the full 3 minutes.

## 3. Tools

- `tools/asset-inventory`: unit test passes (builds a synthetic APK with a binary manifest).
- `tools/compatibility/card-support.mjs --check`: 111 playable cards, 121 entities, 0 without a
  visual; the generated table matches the committed docs.

## 4. Browser (Playwright, real production build + real Java server)

Specs: `home` (4), `platform` (4), `bot` (5 + 1 long), `device` (5), `online` (2),
`resilience` (3), `room` (2). Players A and B are two independent browser contexts with separate
storage, identities and WebSockets.

What the main tests check:

- **Two browsers online:** A alone in the queue is never given a bot. A and B are matched and
  see the same deck, arena and match id from opposite seats. Both deploy by drag, and each
  screen shows its own and enemy units. Every snapshot tick both received has identical tower
  HP and entity sets (except invisible units). A surrenders, B wins, and the server replay holds
  both players' plays. Rematch needs both clicks and gives the same deck to both. B leaves, A
  wins, and both return to the menu without page errors.
- **Bots:** all four levels. Drag deploy, units fight, surrender ends the match. Rematch with
  the same deck replays the same deck and arena. A full real-time match against Expert ends with
  a result.
- **Device:** touch drag via real touch events (Chromium CDP), tap-card-then-tap-arena,
  enemy-side drop refused on the client, rotation keeps rendering, going to the background and
  back.
- **Resilience:** a reload mid-match resumes the same match. On network loss A sees the
  reconnect banner and B sees a persistent "opponent disconnected" countdown; after
  reconnecting, play resumes and B's notice clears. Staying away past the grace period forfeits.
- **Rooms:** code and invite link start a match, a third player cannot join, a wrong code shows
  an error.
- **Platform:** audio unlocks only after a gesture and the synthesised effects are ready; all 15
  model files load with the right MIME type and size; client arena themes match the server
  list; health/catalog endpoints. Without WebGL the player sees a clear message, not a blank
  page.

### Results

| Where | Project | Result |
|---|---|---|
| Dev container, Docker runtime image limited to 512 MB / 0.5 CPU (Render starter size) | chromium-mobile (Pixel 7) | **24/24 pass** (13.4 min) + no-WebGL test pass + full real-time Expert match pass |
| GitHub Actions run 1 (`0d8a2f8`) | chromium-mobile | 23/24: the two-browser test failed on a race **in the test** (snapshot history evicted between calls). Fixed in `e7f6d95`. |
| GitHub Actions run 1 | webkit-iphone (iPhone 14 profile) | 22/24 + 1 skipped (CDP touch is Chromium-only; WebKit covers tap deploy): the same test race. Fixed in `e7f6d95`. |
| GitHub Actions run 1 | firefox-desktop | 1/24: headless Firefox on the GPU-less runner refused WebGL, so the app could not start. Fixed in `e7f6d95` by forcing software WebGL in the test profile. The app itself now shows an error screen instead of a blank page. |
| GitHub Actions run 2 (`e7f6d95`) | chromium-mobile | **all pass** |
| GitHub Actions run 2 | webkit-iphone | **24 pass, 1 skipped** (Chromium-only CDP touch test) |
| GitHub Actions run 2 | firefox-desktop | 2/25: WebGL2 allowed now, but headless Firefox has no GL driver on the runner (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`). The app correctly showed its WebGL error screen. Next commit runs Firefox headed under Xvfb with Mesa software GL, with a WebGL preflight step that fails fast. |

The two-browser test and the network-loss test also failed in the first container run, on
timing: a transient 1.7 s toast was missed, and a result was read before it arrived. Fixing that
showed a real gap: the client never noticed a silently dead socket. The client now drops the
socket on the browser's `offline` event, or after 12 s with no server message, and re-dials.

## 5. Performance

Measured only in software rendering (SwiftShader, no GPU), where the battle runs at about 10 FPS
in headless Chromium. That says nothing about phones with GPUs. Scene budget at peak:
about 150 draw calls and 70k triangles; particles take 2 draw calls and health bars 3. Quality
`auto` lowers the pixel ratio and turns off shadows under 45 FPS. **The 60 FPS target and the
30 FPS minimum have not been verified on any real device.** Server: `BotTournamentTest` simulates
120 full bot-vs-bot matches (engine + both bots) in 11.6 s on the dev container, far faster than
real time. Live, in the 0.5-CPU container during real browser matches (`/api/stats`, sampled
every 2 s): average match loop 0.6-0.8 ms per tick (budget 50 ms at 20 TPS), worst single loop
20 ms (JIT warm-up/GC), outbound snapshot traffic about 7 KB/s per player (405 KB in 57 s). The 512 MB / 0.5 CPU
container ran the whole browser suite, several matches at a time included, without errors.

## 6. CI

`.github/workflows/ci.yml` runs on every push: engine + server tests, card-support check, tool
tests, browser tests in Chromium (Pixel 7), WebKit (iPhone 14) and Firefox, and a Docker build
with a smoke test of the image.

Run 1 (`0d8a2f8`): server tests ✅, Docker build + smoke ✅, browser failures as described
above. Run 2 (`e7f6d95`): server ✅, tools ✅, Docker ✅, Chromium ✅, WebKit ✅, Firefox ❌
(no GL driver in headless mode, see above). Later runs: see the Actions tab.

**Firefox is therefore not yet verified** by an automated run that reaches the game.

## 7. Known gaps

- Real iOS Safari, real Android Chrome and macOS Safari: not tested (no devices available).
- Render: not deployed (no access to a Render account). The image was run locally at Render's
  starter size and built in CI.
- Champions, evolutions and hero cards: not implemented by crforge, so not in the pool.
- No mechanic-by-mechanic comparison with the original game was possible, so exact parity is
  not claimed. Behaviour matches crforge's data and tests.
- Graphics and audio are CC0 or procedural stand-ins (docs/ASSETS.md).
