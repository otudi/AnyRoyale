# AnyRoyale — Play Instantly in Your Browser

A real-time 1v1 lane-battle game in the style of Clash Royale that runs directly in the browser
(Safari on iPhone, Chrome on Android/desktop, Safari on macOS, Firefox) with WebGL and Web Audio.
No install, no emulator, no streaming, no account.

What makes AnyRoyale different: **nobody builds a deck.** For every match the server draws one
random but playable 8-card deck and gives it to **both** players: same cards, same level (11),
same first four cards and the same next card. The arena is random too; every arena has the same
layout and only looks different.

## Features

- **Battle engine:** [crforge](https://github.com/voonhous/crforge) (Apache-2.0), vendored and run
  authoritatively on the server at 20 ticks/s. It covers 3-minute matches with double elixir,
  overtime with triple elixir, tie-breaks, king-tower activation, river/bridges, targeting,
  splash, projectiles, spells, buildings, air/ground units, abilities, death spawns and status
  effects. 111 cards are playable. Champions and evolutions are not implemented in crforge.
  [docs/CARD_SUPPORT.md](docs/CARD_SUPPORT.md) lists every card.
- **Online:** a matchmaking queue with real players only (never a disguised bot), and private
  rooms with a 5-character code or an invite link. Reconnecting within 20 s resumes the match,
  and a reload resumes too. Rematch offers the same or a new deck.
- **Training:** play against bots at Easy, Normal, Hard or Expert. The levels differ in decision
  quality only, never in stats. You can replay the same deck or draw a new one.
- **Guest identity:** a name like `Royal_4821`, editable and kept in `localStorage`, plus a
  server-signed guest token.
- **3D client:** three.js with animated CC0 characters, procedural creatures, particles, shadows,
  health bars and a fixed camera fitted to any screen. Drag-and-drop or tap-to-deploy works on
  touch and mouse. Arabic/English UI (RTL).
- **Audio:** recorded CC0 sound effects (synthesised fallback) and recorded CC0 music. Audio
  unlocks on the first tap, which Safari requires, and plays even with the iPhone on silent.
  Sound and music volumes are separate.

Graphics and audio are **not** the original game's: see [docs/ASSETS.md](docs/ASSETS.md).

## Run locally

Requirements: JDK 17+ (tested with 21) and Node 22.

```bash
./gradlew :server:installDist                      # engine + server
(cd apps/web && npm ci && npm run build)           # browser client
./server/app/build/install/anyroyale-server/bin/anyroyale-server
# open http://localhost:8080  (two tabs/browsers to play online against yourself)
```

Client development with hot reload: run the server, then `cd apps/web && npm run dev`
(http://localhost:5173 proxies `/api`, `/healthz` and `/ws` to :8080).

Docker: `docker build -t anyroyale . && docker run -p 8080:8080 anyroyale`.
Render: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (`render.yaml` blueprint included).

## Tests

```bash
./gradlew :crforge-core:test :crforge-data:test :server:test   # engine + server (incl. bot tournament)
cd tests/browser && npm ci && npx playwright install && npx playwright test
python3 -m unittest discover -s tools/asset-inventory -p 'test_*.py'
node tools/compatibility/card-support.mjs --check
```

Results and known gaps: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Documentation

| Document | Content |
|---|---|
| [docs/SOURCE_AUDIT.md](docs/SOURCE_AUDIT.md) | audited projects, licences, why crforge |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | server authority, match lifecycle, shared deck, bots, rendering |
| [shared/protocols/PROTOCOL.md](shared/protocols/PROTOCOL.md) | WebSocket protocol |
| [docs/CARD_SUPPORT.md](docs/CARD_SUPPORT.md) | every card: stats, units, engine/web/graphics/audio/test status |
| [docs/ASSETS.md](docs/ASSETS.md) | asset sources, licences, what is missing, using files you own |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Render / Docker |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | what was tested, where, results |

## Licences

AnyRoyale includes the crforge engine (Apache-2.0, modified; see `server/engine/VENDOR.md`) and
CC0 models by Kay Lousberg. See [NOTICE](NOTICE). Not affiliated with or endorsed by Supercell.
