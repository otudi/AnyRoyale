// Mapping between server game units (1000 per tile, origin at the blue player's back-left corner)
// and three.js world units (1 per tile, origin at the arena centre, blue side towards +Z).

import * as THREE from 'three';

export const TILE = 1000;

export function toWorldX(gx: number): number {
  return gx / TILE - 9;
}

export function toWorldZ(gy: number): number {
  return 16 - gy / TILE;
}

export function toWorld(gx: number, gy: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(gx / TILE - 9, y, 16 - gy / TILE);
}

export function fromWorld(x: number, z: number): { gx: number; gy: number } {
  return { gx: Math.round((x + 9) * TILE), gy: Math.round((16 - z) * TILE) };
}
