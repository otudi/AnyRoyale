// Visual themes for the arenas the server can pick (server/.../arenas/ArenaCatalog.java).
// Every theme uses the identical battle layout and the same bright green field (as in the reference
// game); only the surroundings, sky, light and decorations change.
// tests/browser verifies the ids here match the server's /api/arenas.

export interface PropRef {
  bundle: string;
  key: string;
  weight: number;
  scale: [number, number];
  /** Only place far from the arena edge (big props like mountains). */
  far?: boolean;
}

export interface ArenaTheme {
  id: string;
  grassA: number;
  grassB: number;
  border: number;
  outer: number;
  path: number;
  water: number;
  waterDeep: number;
  sky: number;
  skyHorizon: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  sunColor: number;
  sunIntensity: number;
  fence: 'wood' | 'stone' | 'iron' | 'wall';
  props: PropRef[];
  /** Procedural extras drawn in code (crystals, snow, ...). */
  extras?: ('crystals' | 'snow' | 'lava' | 'dust' | 'fireflies')[];
  bridge: number;
}

/** Procedural scenery around the field: tree style, foliage and stone colours. */
export interface Scenery {
  trees: 'round' | 'pine' | 'palm' | 'dead' | 'mixed';
  foliage: [number, number];
  trunk: number;
  /** Stone of walls, tower plazas, bridges and river banks. */
  stone: number;
  /** White caps on trees, rocks and walls. */
  snow?: boolean;
  /** Ground colours of the surroundings: near the walls, and far away. */
  ground: [number, number];
}

export const SCENERY: Record<string, Scenery> = {
  meadow: { trees: 'round', foliage: [0x3f8f34, 0x6cbf45], trunk: 0x6b4426, stone: 0xbab3a0, ground: [0x5aa83c, 0x3f8a32] },
  goblin: { trees: 'mixed', foliage: [0x5b8f2f, 0x8ab843], trunk: 0x6b4426, stone: 0xc9ad7c, ground: [0x8fa850, 0x9a8048] },
  bones: { trees: 'dead', foliage: [0x3a5236, 0x56704a], trunk: 0x4a3e34, stone: 0x8e8c84, ground: [0x55604a, 0x3e4038] },
  sands: { trees: 'palm', foliage: [0x4f9a3a, 0x7cc048], trunk: 0x9a7448, stone: 0xdcc292, ground: [0xd9b77a, 0xc89d5e] },
  arcane: { trees: 'pine', foliage: [0x5a4fb0, 0x8a72e0], trunk: 0x3e3458, stone: 0xa49cc0, ground: [0x5f5a96, 0x403c70] },
  frost: { trees: 'pine', foliage: [0x2f6a52, 0x4a8a68], trunk: 0x5a4030, stone: 0xc9d6e2, snow: true, ground: [0xe6f0f8, 0xc8daea] },
  jungle: { trees: 'round', foliage: [0x1f7a32, 0x3fae46], trunk: 0x5a3a20, stone: 0x9aa48a, ground: [0x3f8f34, 0x2a6a28] },
  highlands: { trees: 'pine', foliage: [0x356e3a, 0x55964a], trunk: 0x5e4430, stone: 0xb0aa9a, ground: [0x7a9a52, 0x8a8670] },
};

export function sceneryFor(id: string): Scenery {
  return SCENERY[id] ?? SCENERY.meadow;
}

const env = 'env_core.glb';
const spooky = 'props_spooky.glb';
const dungeon = 'props_dungeon.glb';

export const ARENA_THEMES: Record<string, ArenaTheme> = {
  meadow: {
    id: 'meadow',
    grassA: 0x8fd16a,
    grassB: 0x84c55f,
    border: 0x5d9e3f,
    outer: 0x5f9a42,
    path: 0xd8c08a,
    water: 0x3aa7e0,
    waterDeep: 0x1f6fb0,
    sky: 0x8fd3ff,
    skyHorizon: 0xd8f1ff,
    fog: 0xbfe6ff,
    hemiSky: 0xe8f6ff,
    hemiGround: 0x5a7a3a,
    sunColor: 0xfff2d8,
    sunIntensity: 2.5,
    fence: 'wood',
    bridge: 0x9b6a3c,
    props: [
      { bundle: env, key: 'tree_a', weight: 4, scale: [1.2, 1.7] },
      { bundle: env, key: 'trees_medium', weight: 3, scale: [1.2, 1.6] },
      { bundle: env, key: 'rock_a', weight: 2, scale: [0.9, 1.4] },
      { bundle: env, key: 'hills', weight: 2, scale: [2.4, 3.2], far: true },
      { bundle: env, key: 'flag_blue', weight: 1, scale: [1.2, 1.4] },
      { bundle: env, key: 'tent', weight: 1, scale: [1.3, 1.6] },
    ],
    extras: ['fireflies'],
  },
  goblin: {
    id: 'goblin',
    grassA: 0x94d06a,
    grassB: 0x89c45f,
    border: 0x7a6a3c,
    outer: 0x8a7444,
    path: 0xc9a46a,
    water: 0x4fb4c8,
    waterDeep: 0x2a7f94,
    sky: 0xffcf8a,
    skyHorizon: 0xffecc8,
    fog: 0xf3d9a8,
    hemiSky: 0xfff0d0,
    hemiGround: 0x6b5531,
    sunColor: 0xffe2b0,
    sunIntensity: 2.6,
    fence: 'wood',
    bridge: 0x8d5b31,
    props: [
      { bundle: env, key: 'tent', weight: 3, scale: [1.3, 1.7] },
      { bundle: env, key: 'crate', weight: 3, scale: [1.0, 1.4] },
      { bundle: env, key: 'barrel_small', weight: 3, scale: [1.0, 1.3] },
      { bundle: dungeon, key: 'barrel', weight: 2, scale: [0.9, 1.2] },
      { bundle: env, key: 'trees_small', weight: 2, scale: [1.2, 1.6] },
      { bundle: env, key: 'target', weight: 1, scale: [1.0, 1.2] },
      { bundle: env, key: 'mountain_bare', weight: 1, scale: [3, 4], far: true },
    ],
    extras: ['dust'],
  },
  bones: {
    id: 'bones',
    grassA: 0x8acb68,
    grassB: 0x7fbf5d,
    border: 0x55503f,
    outer: 0x4a463a,
    path: 0xa49478,
    water: 0x4c8a7a,
    waterDeep: 0x274a43,
    sky: 0x5a6a86,
    skyHorizon: 0x9aa6b8,
    fog: 0x6c7488,
    hemiSky: 0xbfc8dd,
    hemiGround: 0x3b3a30,
    sunColor: 0xd9e2ff,
    sunIntensity: 1.9,
    fence: 'iron',
    bridge: 0x6d5a45,
    props: [
      { bundle: spooky, key: 'gravestone', weight: 4, scale: [1.0, 1.4] },
      { bundle: spooky, key: 'grave', weight: 3, scale: [1.0, 1.3] },
      { bundle: spooky, key: 'tree_dead', weight: 3, scale: [1.3, 1.8] },
      { bundle: spooky, key: 'skull', weight: 2, scale: [1.2, 1.6] },
      { bundle: spooky, key: 'ribcage', weight: 2, scale: [1.2, 1.6] },
      { bundle: spooky, key: 'lantern', weight: 1, scale: [1.1, 1.3] },
      { bundle: spooky, key: 'crypt', weight: 1, scale: [1.4, 1.8], far: true },
    ],
    extras: ['fireflies'],
  },
  sands: {
    id: 'sands',
    grassA: 0x9bd26c,
    grassB: 0x90c661,
    border: 0xb9935a,
    outer: 0xcfa96a,
    path: 0xf0dcae,
    water: 0x3ec0d0,
    waterDeep: 0x1e8a9e,
    sky: 0x9fd6f5,
    skyHorizon: 0xfff1d0,
    fog: 0xf5e2b8,
    hemiSky: 0xfff6e0,
    hemiGround: 0x9a7a45,
    sunColor: 0xfff0c8,
    sunIntensity: 2.9,
    fence: 'stone',
    bridge: 0xa57a45,
    props: [
      { bundle: env, key: 'rock_c', weight: 3, scale: [1.0, 1.6] },
      { bundle: env, key: 'rock_e', weight: 3, scale: [1.0, 1.5] },
      { bundle: dungeon, key: 'column', weight: 3, scale: [0.9, 1.2] },
      { bundle: env, key: 'weaponrack', weight: 2, scale: [1.0, 1.3] },
      { bundle: env, key: 'mountain_bare', weight: 1, scale: [3, 4], far: true },
      { bundle: dungeon, key: 'banner_red', weight: 1, scale: [1.0, 1.2] },
    ],
    extras: ['dust'],
  },
  arcane: {
    id: 'arcane',
    grassA: 0x8bcf72,
    grassB: 0x80c367,
    border: 0x5b5a8c,
    outer: 0x4f4f7d,
    path: 0xb8a6d8,
    water: 0x7c6ff0,
    waterDeep: 0x3d2f9c,
    sky: 0x6a5acd,
    skyHorizon: 0xc8b8ff,
    fog: 0x8f80d8,
    hemiSky: 0xe0d8ff,
    hemiGround: 0x403a66,
    sunColor: 0xf0e0ff,
    sunIntensity: 2.1,
    fence: 'stone',
    bridge: 0x6e5a9a,
    props: [
      { bundle: env, key: 'tree_b', weight: 3, scale: [1.2, 1.6] },
      { bundle: env, key: 'rock_a', weight: 2, scale: [1.0, 1.4] },
      { bundle: dungeon, key: 'column', weight: 2, scale: [1.0, 1.3] },
      { bundle: env, key: 'mountain', weight: 1, scale: [3, 4], far: true },
    ],
    extras: ['crystals', 'fireflies'],
  },
  frost: {
    id: 'frost',
    grassA: 0x92d27a,
    grassB: 0x87c66f,
    border: 0xaecbe0,
    outer: 0xc9dceb,
    path: 0xb7cfe0,
    water: 0x9fd8f2,
    waterDeep: 0x5da7cf,
    sky: 0xa8d8f0,
    skyHorizon: 0xf2fbff,
    fog: 0xe0f2fb,
    hemiSky: 0xf2fbff,
    hemiGround: 0x8aa8c0,
    sunColor: 0xeaf6ff,
    sunIntensity: 2.3,
    fence: 'stone',
    bridge: 0x8a6b4c,
    props: [
      { bundle: env, key: 'trees_medium', weight: 3, scale: [1.2, 1.6] },
      { bundle: env, key: 'rock_c', weight: 3, scale: [1.0, 1.5] },
      { bundle: env, key: 'mountain_bare', weight: 2, scale: [3, 4.5], far: true },
      { bundle: spooky, key: 'lantern', weight: 1, scale: [1.1, 1.3] },
    ],
    extras: ['snow', 'crystals'],
  },
  jungle: {
    id: 'jungle',
    grassA: 0x86cc63,
    grassB: 0x7bc058,
    border: 0x3f7a33,
    outer: 0x2f6a2b,
    path: 0xa98a55,
    water: 0x3ab59a,
    waterDeep: 0x1b7a64,
    sky: 0x9fdcae,
    skyHorizon: 0xe2f7d8,
    fog: 0xb6e2b8,
    hemiSky: 0xe8ffe0,
    hemiGround: 0x2e4f22,
    sunColor: 0xfff6d0,
    sunIntensity: 2.2,
    fence: 'wood',
    bridge: 0x7a5530,
    props: [
      { bundle: env, key: 'trees_medium', weight: 5, scale: [1.4, 2.0] },
      { bundle: env, key: 'tree_b', weight: 4, scale: [1.4, 2.0] },
      { bundle: env, key: 'rock_a', weight: 2, scale: [1.0, 1.4] },
      { bundle: dungeon, key: 'column', weight: 2, scale: [1.0, 1.3] },
      { bundle: env, key: 'waterplant', weight: 2, scale: [1.2, 1.6] },
      { bundle: env, key: 'mountain', weight: 1, scale: [3, 4], far: true },
    ],
    extras: ['fireflies'],
  },
  highlands: {
    id: 'highlands',
    grassA: 0x95d06b,
    grassB: 0x8ac460,
    border: 0x7d7a6a,
    outer: 0x8e8a76,
    path: 0xc2b291,
    water: 0x4aa0d8,
    waterDeep: 0x2a6aa0,
    sky: 0x9cc8ec,
    skyHorizon: 0xe6f2fb,
    fog: 0xc8dcea,
    hemiSky: 0xeef6ff,
    hemiGround: 0x5e5a48,
    sunColor: 0xfff4dc,
    sunIntensity: 2.5,
    fence: 'wall',
    bridge: 0x8d6a46,
    props: [
      { bundle: env, key: 'rock_e', weight: 4, scale: [1.2, 1.8] },
      { bundle: env, key: 'rock_c', weight: 3, scale: [1.2, 1.8] },
      { bundle: env, key: 'mountain', weight: 2, scale: [3, 4.5], far: true },
      { bundle: env, key: 'mountain_bare', weight: 2, scale: [3, 4.5], far: true },
      { bundle: env, key: 'tree_a', weight: 2, scale: [1.2, 1.6] },
      { bundle: env, key: 'flag_red', weight: 1, scale: [1.2, 1.4] },
    ],
  },
};

export function themeFor(id: string): ArenaTheme {
  return ARENA_THEMES[id] ?? ARENA_THEMES.meadow;
}

/** Bundles a theme needs (core bundle is always loaded). */
export function themeBundles(id: string): string[] {
  const t = themeFor(id);
  return [...new Set(t.props.map((p) => p.bundle))];
}
