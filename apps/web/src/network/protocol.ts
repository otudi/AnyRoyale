// Wire protocol shared with the Java server. Keep in sync with shared/protocols/PROTOCOL.md and
// server/app/src/main/java/com/anyroyale/server/match/SnapshotWriter.java.

export type TeamName = 'BLUE' | 'RED';

/** Entity tuple: [id, name, team, kind, move, x, y, hp, maxHp, shield, flags, targetId, radius, extra] */
export type EntityTuple = [
  number,
  string,
  0 | 1,
  'T' | 'B' | 'K' | 'P' | 'A',
  0 | 1 | 2,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Projectile tuple: [id, team, x, y, targetX, targetY, sourceId, aoeRadius, visualKey] */
export type ProjectileTuple = [number, 0 | 1, number, number, number, number, number, number, string];

export type GameEvent =
  | ['play', 0 | 1, string, number, number]
  | ['aoe', number, number, number, 0 | 1]
  | ['hit', number, number]
  | ['die', number, string, number, number, 0 | 1, '' | 'K' | 'P']
  | ['phase', Phase];

export type Phase = 'regular' | 'double' | 'overtime' | 'triple';

export const F = {
  DEPLOYING: 1,
  ATTACKING: 2,
  STUNNED: 4,
  FROZEN: 8,
  SLOWED: 16,
  RAGED: 32,
  INVISIBLE: 64,
  JUMPING: 128,
  TUNNELING: 256,
  POISONED: 512,
  INACTIVE_TOWER: 1024,
  ATTACHED: 2048,
  HIDDEN_BUILDING: 4096,
  CURSED: 8192,
} as const;

export interface Snapshot {
  type: 'snap';
  tick: number;
  timeLeft: number;
  phase: Phase;
  elixirRate: number;
  me?: { elixir: number; hand: (string | null)[]; next: string | null; crowns: number };
  opp?: { crowns: number };
  e: EntityTuple[];
  p: ProjectileTuple[];
  ev: GameEvent[];
}

export interface ArenaInfo {
  id: string;
  number: number;
  name: string;
  nameAr: string;
}

export interface MatchStart {
  type: 'matchStart';
  matchId: string;
  resume: boolean;
  mode: 'online' | 'private' | 'bot';
  you: TeamName;
  seed: string;
  level: number;
  arena: ArenaInfo;
  deck: string[];
  opponent: { name: string; bot: boolean; difficulty?: string };
  state: 'WAITING_READY' | 'INTRO' | 'RUNNING' | 'ENDED' | 'CLOSED';
  durationSeconds: number;
  overtimeSeconds: number;
  /** Seconds between a play and its units appearing (server setting). */
  placementDelay?: number;
}

export interface MatchEnd {
  type: 'end';
  matchId: string;
  winner: TeamName | null;
  draw: boolean;
  youWon: boolean;
  reason: 'kingTower' | 'crowns' | 'towerHp' | 'draw' | 'surrender' | 'disconnect' | 'abandoned';
  crowns: { BLUE: number; RED: number };
  towerHp: { BLUE: number; RED: number };
  seconds: number;
  canRematch: boolean;
}

export interface Welcome {
  type: 'welcome';
  guestId: string;
  token: string;
  name: string;
  newIdentity: boolean;
  protocol: number;
  serverTime: number;
  activeMatch: string | null;
}

export type ServerMessage =
  | Welcome
  | MatchStart
  | Snapshot
  | MatchEnd
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'nameSet'; name: string }
  | { type: 'queued'; waiting: number }
  | { type: 'queueCancelled' }
  | { type: 'roomCreated'; code: string }
  | { type: 'roomCancelled' }
  | { type: 'intro'; seconds: number }
  | { type: 'battleStart' }
  | { type: 'ack'; seq: number }
  | { type: 'reject'; seq: number; reason: string }
  | { type: 'opponentStatus'; connected: boolean; graceSeconds?: number }
  | { type: 'rematchStatus'; opponentWants?: boolean; opponentLeft?: boolean }
  | { type: 'matchCancelled'; reason: string; matchId?: string; requeued?: boolean }
  | { type: 'replaced' }
  | { type: 'serverShutdown'; reason: string }
  | { type: 'error'; code: string; message: string };

export interface CardInfo {
  id: string;
  name: string;
  type: 'TROOP' | 'SPELL' | 'BUILDING';
  rarity: string;
  cost: number;
  count: number;
  spellAsDeploy: boolean;
  canDeployOnEnemySide: boolean;
  mirror: boolean;
  tags: string[];
  unit?: {
    name: string;
    hp: number;
    damage: number;
    hitSpeed: number;
    speed: number;
    range: number;
    radius: number;
    target: string;
    movement: string;
    deployTime: number;
    lifetime?: number;
  };
  spell?: { radius: number; damage: number; duration?: number };
}

/** Arena geometry (game units), mirrors crforge's Arena. */
export const ARENA = {
  W: 18000,
  H: 32000,
  TILE: 1000,
  RIVER_Y0: 15000,
  RIVER_Y1: 17000,
  LEFT_BRIDGE_X0: 2000,
  LEFT_BRIDGE_X1: 5000,
  RIGHT_BRIDGE_X0: 13000,
  RIGHT_BRIDGE_X1: 16000,
} as const;
