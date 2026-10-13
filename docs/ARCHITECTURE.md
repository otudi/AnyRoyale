# Architecture

```
Browser (Safari / Chrome / Firefox)                        Render web service (one container)
┌───────────────────────────────────────┐   HTTPS          ┌─────────────────────────────────────────────┐
│ apps/web  (Vite + TypeScript + three)  │ ───────────────▶ │ Javalin 7 / Jetty 12                        │
│  ui/        screens, HUD, settings     │  static files    │  /            built client (apps/web/dist)  │
│  network/   WebSocket client, identity │  /api/cards      │  /api/cards   live card catalog             │
│  game/      BattleSession, BattleView  │  /api/arenas     │  /healthz     health check                  │
│  rendering/ arena, units, FX, camera   │  /api/replays/id │  /api/stats   load / memory / CPU / matches │
│  input/     drag & tap deployment      │                  │                                             │
│  audio/     Web Audio SFX + music      │   WebSocket /ws  │  websocket/   GameGateway (JSON protocol)   │
│                                         │ ◀══════════════▶ │  sessions/    guest ids (HMAC tokens)       │
│ sends intents: play(slot, card, x, y)   │  intents ▲       │  matchmaking/ online queue (no bot fill)    │
│ receives full snapshots @10 Hz          │  snapshots ▼     │  rooms/       private rooms (5-char codes)  │
└───────────────────────────────────────┘                  │  match/       MatchSession × N (20 TPS)     │
                                                             │  bots/        HeuristicBot (4 levels)       │
                                                             │  cards/       pool, traits, shared deck     │
                                                             │  replay/      replay store + verifier       │
                                                             │  engine/      crforge core + data (vendored)│
                                                             └─────────────────────────────────────────────┘
```

## Server authority

- The browser never simulates gameplay. It sends **intents** (`play` with hand slot, card id,
  position and a sequence number). Each `MatchSession` validates them (match state, seat owner,
  sequence, card actually in that slot, elixir incl. Mirror cost, placement via crforge rules),
  queues them into crforge and ticks the engine at 20 TPS.
- Elixir, damage, health, deaths, crowns, timers and the winner exist only on the server.
- At most one accepted play per player per tick (the hand cycles inside the tick, so a second
  play would be validated against a stale hand).
- Snapshots (10 Hz) are **full state**, not deltas, so any snapshot fully resynchronises a client.
  The opponent's hand and elixir are never sent; invisible enemy troops (Royal Ghost, Suspicious
  Bush) are omitted from the opponent's snapshots.
- Threading: each match is a fixed-rate task on a shared `ScheduledExecutorService`; network
  threads only append to the match inbox. No locks around the engine.

## Match lifecycle

`WAITING_READY` (clients load assets; 25 s timeout) → `INTRO` (3 s, both see arena + shared deck)
→ `RUNNING` → `ENDED` (result, 60 s rematch window) → `CLOSED`.

- Before the battle: a player gone for 8 s, or not loaded within `READY_TIMEOUT_SECONDS` (25),
  cancels the match without result (`matchCancelled`). In an online match the other player is
  put straight back into the queue (`requeued: true`); nobody plays against an empty seat. A bot
  match starts anyway once the timeout passes.
- Disconnect: the seat is kept for `RECONNECT_GRACE_SECONDS` (20). Reconnecting with the same
  guest token resumes (`matchStart{resume:true}` + snapshot). Past the grace period the player
  forfeits; if both are gone the match is abandoned. The opponent sees a countdown while the
  seat is empty.
- Dead-connection detection: the client re-dials on the browser `offline` event or after 12 s
  without any server message (it pings every 4 s; snapshots arrive at 10 Hz), with exponential
  backoff; the server pings every 5 s and drops sockets idle for 20 s. After a reconnect the client
  re-joins the online queue if it was searching; a hosted room is kept for 30 s while the host
  reconnects.
- A different guest can never act in a match: commands are routed by the authenticated guest id
  and seats are fixed at creation. Rooms hold exactly two seats.
- Rematch requires both humans (bot matches: one click; "same deck" reuses the seed).
- `SIGTERM` (Render deploy): matches are told the server restarts, the scheduler stops, sockets
  close with code 1012.

## Fair shared deck

`SharedRandomDeckGenerator` draws 8 distinct cards uniformly from the 111-card pool with a
SecureRandom seed per match, rejecting only unplayable decks (needs 1-3 spells incl. a damaging
one, ≤2 buildings, ≥2 anti-air troops/buildings, splash, a win condition, ≥2 cards costing ≤3,
≤2 cards costing 7+, average 2.6-4.6). Tests show every pool card appears across 4,000 decks.

Both players get the same `Deck` object order and `new Random(handSeed(seed))` for their hand,
so the 4 starting cards, the next card and the whole initial cycle are identical. All cards and
towers are level 11. Seats (blue/red) are assigned randomly; `FairnessTest` checks that
180°-rotated identical plays give rotated outcomes (no first/second-player advantage).

The arena is picked from the same seed; every arena uses the identical engine layout and differs
only visually.

## Bots

`HeuristicBot` sees only what a player sees (own hand/elixir, visible entities, the opponent's
public plays, the shared deck) and plays through the same validation as humans. Difficulties
differ only in decision quality (`BotProfile`): think interval, reaction delay, mistake rate,
placement jitter, attack threshold, spell value threshold, counter selection, building pulls,
leak avoidance, counter-pushing; Expert also counts the opponent's elixir and cycle, picks the
cheapest adequate counter and defends under its towers. `BotTournamentTest` asserts
Expert > Hard > Normal > Easy on fixed seeds.

## Client rendering

- Interpolation renders ~150 ms behind the newest snapshot; events (hits, deaths, AoE, plays)
  are applied when their snapshot is reached so effects line up with positions.
- Characters: CC0 KayKit skinned models cloned with `SkeletonUtils`, one shared animation
  library (26 clips) bound by bone name; team colour on capes/hats; status tints (freeze, rage,
  poison...). Creatures/machines without CC0 models are procedural low-poly meshes with
  procedural animation. Buildings and towers use the CC0 medieval kit in blue/red variants.
- Effects: one `THREE.Points` particle field per blend mode (2 draw calls for all particles),
  pooled projectiles, pooled shockwave rings, instanced health bars (3 draw calls for all bars).
- Camera: solved per screen shape so the arena fits between the HUD and the card tray; the red
  player's camera is mirrored, so everyone defends at the bottom.
- Quality: `auto` lowers pixel ratio (and drops shadows) after 3 s under 45 FPS and raises it
  after 8 s above 57 FPS; `low` = no shadows, pixel ratio 1.

## Assets

`tools/asset-pipeline` rebuilds `apps/web/public/assets/models/*.glb` from pinned CC0 packs
(see docs/ASSETS.md). URLs carry the file hash (`?v=`), so `/assets/**` is served with
`immutable` caching; matches reuse parsed scenes in memory (no reload per match). Loading shows
real byte progress; failed files are retried and fall back to procedural models.

## Repository layout

```
apps/web/                 browser client (Vite)
server/app/               AnyRoyale server (Gradle project ":server")
server/engine/            vendored crforge core + data (":crforge-core", ":crforge-data")
shared/protocols/         wire protocol
tests/browser/            Playwright end-to-end tests
tools/asset-pipeline/     CC0 model build
tools/asset-inventory/    local inventory of user-owned game files (never committed)
tools/compatibility/      card support report + visual coverage check
docs/                     this documentation
```
