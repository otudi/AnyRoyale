// Client-side mirror of crforge's placement rules (Arena.isValidPlacement / Match.validateAction).
// Used only for the drag overlay and snapping; the server re-validates every play.

import type { CardInfo, TeamName } from '../network/protocol';

export interface TowerState {
  /** Destroyed princess towers by owner team and lane (absolute game lanes: left = x < 9000). */
  princessDown: { BLUE: { left: boolean; right: boolean }; RED: { left: boolean; right: boolean } };
}

function bannedTile(tx: number, ty: number): boolean {
  return (ty === 0 || ty === 31) && (tx < 6 || tx > 11);
}

function towerTile(tx: number, ty: number, towers: TowerState): boolean {
  if (tx >= 7 && tx <= 10 && ((ty >= 1 && ty <= 4) || (ty >= 27 && ty <= 30))) return true;
  const blueRow = ty >= 5 && ty <= 7;
  const redRow = ty >= 24 && ty <= 26;
  const left = tx >= 2 && tx <= 4;
  const right = tx >= 13 && tx <= 15;
  if (!(left || right) || !(blueRow || redRow)) return false;
  const owner = blueRow ? towers.princessDown.BLUE : towers.princessDown.RED;
  return !(left ? owner.left : owner.right); // destroyed tower footprint is freed
}

function ownZone(ty: number, team: TeamName): boolean {
  return team === 'BLUE' ? ty < 15 : ty > 16;
}

function inPocket(tx: number, ty: number, team: TeamName, towers: TowerState): boolean {
  const enemy = team === 'BLUE' ? towers.princessDown.RED : towers.princessDown.BLUE;
  const rowsOk = team === 'BLUE' ? ty >= 17 && ty <= 20 : ty >= 11 && ty <= 14;
  if (!rowsOk) return false;
  if (enemy.left && tx >= 0 && tx <= 8) return true;
  if (enemy.right && tx >= 9 && tx <= 17) return true;
  return false;
}

/** Tile-level validity for troops (centre-point rule). */
export function tileValidForTroop(tx: number, ty: number, team: TeamName, towers: TowerState): boolean {
  if (tx < 0 || tx > 17 || ty < 0 || ty > 31) return false;
  if (bannedTile(tx, ty) || towerTile(tx, ty, towers)) return false;
  if (ty === 15 || ty === 16) return false;
  return ownZone(ty, team) || inPocket(tx, ty, team, towers);
}

export type PlacementKind = 'troop' | 'building' | 'spell' | 'anywhere' | 'ownSpell';

export function placementKind(card: CardInfo): PlacementKind {
  if (card.type === 'SPELL') {
    if (card.spellAsDeploy && !card.canDeployOnEnemySide) return 'ownSpell';
    return 'spell';
  }
  if (card.canDeployOnEnemySide) return 'anywhere';
  return card.type === 'BUILDING' ? 'building' : 'troop';
}

/** Snaps a point to the deployment grid (tile centres; even-sized buildings snap to corners). */
export function snap(gx: number, gy: number, card: CardInfo): { gx: number; gy: number } {
  let even = false;
  if (card.type === 'BUILDING' && card.unit) {
    const tiles = Math.ceil((card.unit.radius * 2) / 1000 - 0.001);
    even = tiles % 2 === 0;
  }
  const s = (v: number) => (even ? Math.round(v / 1000) * 1000 : Math.floor(v / 1000) * 1000 + 500);
  return { gx: clamp(s(gx), 500, 17500), gy: clamp(s(gy), 500, 31500) };
}

export function isValid(card: CardInfo, gx: number, gy: number, team: TeamName, towers: TowerState): boolean {
  const tx = Math.floor(gx / 1000);
  const ty = Math.floor(gy / 1000);
  switch (placementKind(card)) {
    case 'spell':
      return gx >= 0 && gx < 18000 && gy >= 0 && gy < 32000;
    case 'ownSpell':
    case 'troop':
      return tileValidForTroop(tx, ty, team, towers);
    case 'anywhere':
      return tx >= 0 && tx < 18 && ty >= 0 && ty < 32 && !bannedTile(tx, ty) && !towerTile(tx, ty, towers) && ty !== 15 && ty !== 16;
    case 'building': {
      const r = card.unit?.radius ?? 500;
      const x0 = Math.floor((gx - r + 1) / 1000);
      const x1 = Math.floor((gx + r - 1) / 1000);
      const y0 = Math.floor((gy - r + 1) / 1000);
      const y1 = Math.floor((gy + r - 1) / 1000);
      if (gx - r < 0 || gx + r > 18000 || gy - r < 0 || gy + r > 32000) return false;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const zone = ownZone(y, team) && !towerTile(x, y, towers) && !bannedTile(x, y);
          if (!zone && !inPocket(x, y, team, towers)) return false;
        }
      }
      return true;
    }
  }
}

/** 18x32 validity grid for the overlay (true = can deploy a troop there). */
export function troopGrid(team: TeamName, towers: TowerState, kind: PlacementKind): boolean[][] {
  const grid: boolean[][] = [];
  for (let ty = 0; ty < 32; ty++) {
    const row: boolean[] = [];
    for (let tx = 0; tx < 18; tx++) {
      if (kind === 'spell') row.push(true);
      else if (kind === 'anywhere') row.push(!bannedTile(tx, ty) && !towerTile(tx, ty, towers) && ty !== 15 && ty !== 16);
      else row.push(tileValidForTroop(tx, ty, team, towers));
    }
    grid.push(row);
  }
  return grid;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
