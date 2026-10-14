# AnyRoyale wire protocol (v1)

Transport: one WebSocket per browser tab at `/ws`, JSON text frames (max 8 KiB inbound),
server pings every 15 s, idle timeout 60 s, inbound limit 40 messages/s.
Positions are crforge game units: 1000 per tile, x 0..18000 (left→right from blue's view),
y 0..32000 (blue's king tower at the bottom). TypeScript types: `apps/web/src/network/protocol.ts`.

## Client → server

| type | fields | notes |
|---|---|---|
| `hello` | `guestId?`, `token?`, `name?` | first message; invalid/missing token ⇒ new identity |
| `ping` | `t` | echoed in `pong` |
| `setName` | `name` | 2-16 letters/digits (any script), sanitised server-side |
| `queue` / `cancelQueue` | — | online 1v1 queue (real players only) |
| `createRoom` / `cancelRoom` | — | private room |
| `joinRoom` | `code` | 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` |
| `startBot` | `difficulty` (`easy`/`normal`/`hard`/`expert`), `seed?` | `seed` replays a deck |
| `ready` | `matchId` | assets loaded |
| `play` | `matchId`, `seq`, `slot`, `card`, `x`, `y` | `seq` strictly increasing; duplicates ignored |
| `leave` | `matchId` | surrender while running; leave result screen otherwise |
| `rematch` | `matchId`, `sameDeck` | both humans must ask |

## Server → client

| type | fields |
|---|---|
| `welcome` | `guestId`, `token`, `name`, `newIdentity`, `protocol`, `serverTime`, `activeMatch` |
| `pong` | `t`, `serverTime` |
| `nameSet` | `name` |
| `queued` | `waiting` |
| `roomCreated` | `code` |
| `matchStart` | `matchId`, `resume`, `mode`, `you` (`BLUE`/`RED`), `seed`, `level`, `arena{id,number,name,nameAr}`, `deck[8]`, `opponent{name,bot,difficulty?}`, `state`, `durationSeconds`, `overtimeSeconds` |
| `intro` | `seconds` |
| `battleStart` | — |
| `snap` | see below |
| `ack` / `reject` | `seq` (+ `reason`: `badSlot`, `staleHand`, `nothingToMirror`, `elixir`, `placement`, `notRunning`, `rateLimited`) |
| `opponentStatus` | `connected`, `graceSeconds?` |
| `end` | `matchId`, `winner`, `draw`, `youWon`, `reason` (`kingTower`/`crowns`/`towerHp`/`draw`/`surrender`/`disconnect`/`abandoned`), `crowns{BLUE,RED}`, `towerHp{BLUE,RED}`, `seconds`, `canRematch` |
| `rematchStatus` | `opponentWants?`, `opponentLeft?` |
| `matchCancelled` | `reason` (`opponentMissing`/`opponentNotReady`/`opponentLeft`/`youNotReady`), `matchId`, `requeued` (true: the server already put you back into the online queue) |
| `replaced` | another tab took over this guest |
| `serverShutdown` | `reason` |
| `error` | `code`, `message` |

## Snapshot (`snap`, 20 Hz, full state per player)

```json
{ "type":"snap", "tick":1234, "timeLeft":118.3, "phase":"regular|double|overtime|triple", "elixirRate":1,
  "me":  { "elixir":6.42, "hand":["knight","zap","giant","arrows"], "next":"musketeer", "crowns":0 },
  "opp": { "crowns":1 },
  "e":  [[id, name, team, kind, move, x, y, hp, maxHp, shield, flags, targetId, radius, extra], ...],
  "p":  [[id, team, x, y, targetX, targetY, sourceId, aoeRadius, visualKey], ...],
  "ev": [["play",team,cardId,x,y], ["aoe",x,y,radius,team], ["hit",attackerId,targetId],
         ["die",id,name,x,y,team,towerKind], ["phase",phase]] }
```

- `team`: 0 = BLUE, 1 = RED. `kind`: `T` troop, `B` building, `K` king tower, `P` princess tower,
  `A` area effect. `move`: 0 ground, 1 air, 2 building.
- `flags` bits: 1 deploying, 2 attacking, 4 stunned, 8 frozen, 16 slowed, 32 raged, 64 invisible,
  128 jumping, 256 tunnelling, 512 poisoned, 1024 inactive tower, 2048 attached, 4096 hidden
  building, 8192 cursed.
- `extra`: area effects → remaining-life fraction; buildings → remaining-lifetime fraction.
- `visualKey`: source entity name, or the spell card id for source-less spell projectiles.
