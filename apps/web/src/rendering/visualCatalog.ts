// How each engine entity is drawn. Keys are crforge entity names exactly as the server sends them
// (see server/app/build/entity-inventory.json, produced by EntityInventoryTest). Unknown names
// fall back to a generic visual chosen from the entity kind and size, so nothing is ever invisible.
//
// The 3D characters are CC0 KayKit models (adventurers + skeletons). They are stand-ins chosen for
// a similar silhouette/role, not reproductions of the original game's art; docs/ASSETS.md lists
// every substitution.

export type CharModel =
  | 'knight'
  | 'barbarian'
  | 'mage'
  | 'rogue'
  | 'rogue_hooded'
  | 'skel_warrior'
  | 'skel_minion'
  | 'skel_mage'
  | 'skel_rogue';

export type ProcShape =
  | 'dragon'
  | 'minion'
  | 'megaminion'
  | 'bat'
  | 'balloon'
  | 'hound'
  | 'pup'
  | 'golem'
  | 'golemite'
  | 'icegolem'
  | 'elixirblob'
  | 'spirit'
  | 'hog'
  | 'ram'
  | 'phoenix'
  | 'egg'
  | 'bomb'
  | 'bottle'
  | 'barrel'
  | 'bush'
  | 'machine'
  | 'sparky'
  | 'zappy'
  | 'drillmound'
  | 'furnace'
  | 'batteringram'
  | 'flyingmachine'
  | 'skelballoon'
  | 'mergemount'
  | 'crate';

export type Mount = 'hog' | 'horse' | 'ram';

export interface CharSpec {
  kind: 'char';
  model: CharModel;
  height: number;
  gear?: string[];
  weapons?: { key: string; hand: 'r' | 'l'; scale?: number }[];
  tint?: number;
  attack: string;
  walk?: string;
  mount?: Mount;
  ghost?: boolean;
  crown?: boolean;
}

export interface ProcSpec {
  kind: 'proc';
  shape: ProcShape;
  height: number;
  color?: number;
  color2?: number;
  rider?: CharSpec;
}

export interface PropSpec {
  kind: 'prop';
  bundle: string;
  key: string;
  teamSuffix?: boolean;
  width: number;
  extra?: 'coil' | 'fire' | 'bomb' | 'elixir' | 'xbow' | 'cannon' | 'cage' | 'inferno';
}

export interface AreaSpec {
  kind: 'area';
  color: number;
  style: 'ring' | 'dome' | 'swirl' | 'quake' | 'pulse' | 'grave' | 'vines' | 'bolt' | 'void' | 'crate';
}

export type VisualSpec = CharSpec | ProcSpec | PropSpec | AreaSpec;

const char = (model: CharModel, height: number, attack: string, extra: Partial<CharSpec> = {}): CharSpec => ({
  kind: 'char',
  model,
  height,
  attack,
  ...extra,
});
const proc = (shape: ProcShape, height: number, extra: Partial<ProcSpec> = {}): ProcSpec => ({
  kind: 'proc',
  shape,
  height,
  ...extra,
});
const prop = (bundle: string, key: string, width: number, extra: Partial<PropSpec> = {}): PropSpec => ({
  kind: 'prop',
  bundle,
  key,
  width,
  ...extra,
});
const area = (color: number, style: AreaSpec['style']): AreaSpec => ({ kind: 'area', color, style });

const GREEN_SKIN = 0x9fdc6a;
const B = 'card_buildings.glb';

export const VISUALS: Record<string, VisualSpec> = {
  // --- Humans (adventurers pack) -----------------------------------------------------------------
  Knight: char('knight', 1.45, '1H_Melee_Attack_Slice_Horizontal', { gear: ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'] }),
  Prince: char('knight', 1.5, '2H_Melee_Attack_Stab', { gear: ['2H_Sword', 'Knight_Helmet', 'Knight_Cape'], mount: 'horse', tint: 0xfff0c0 }),
  DarkPrince: char('knight', 1.5, '2H_Melee_Attack_Chop', { gear: ['2H_Sword', 'Spike_Shield', 'Knight_Helmet', 'Knight_Cape'], mount: 'horse', tint: 0x6a6a7a }),
  Recruit: char('knight', 1.3, '1H_Melee_Attack_Stab', { gear: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet'] }),
  DeliveryRecruit: char('knight', 1.3, '1H_Melee_Attack_Stab', { gear: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet'] }),
  MiniPekka: char('knight', 1.35, '2H_Melee_Attack_Chop', { gear: ['2H_Sword', 'Knight_Helmet'], tint: 0x7b8fb5 }),
  Pekka: char('knight', 2.2, '2H_Melee_Attack_Chop', { gear: ['2H_Sword', 'Knight_Helmet'], tint: 0x6a4f9a }),
  MegaKnight: char('knight', 2.4, '2H_Melee_Attack_Chop', { gear: ['2H_Sword', 'Spike_Shield', 'Knight_Helmet'], tint: 0x55606e }),
  BattleHealer: char('knight', 1.5, '1H_Melee_Attack_Chop', { gear: ['1H_Sword', 'Badge_Shield', 'Knight_Cape'], tint: 0xffe6a0 }),
  Barbarian: char('barbarian', 1.4, '1H_Melee_Attack_Chop', { gear: ['1H_Axe', 'Barbarian_Hat'] }),
  AngryBarbarian: char('barbarian', 1.45, 'Dualwield_Melee_Attack_Slice', { gear: ['1H_Axe', '1H_Axe_Offhand', 'Barbarian_Hat', 'Barbarian_Cape'], tint: 0xffc0a0 }),
  RageBarbarian: char('barbarian', 1.45, '2H_Melee_Attack_Slice', { gear: ['2H_Axe'], tint: 0xe0b080 }),
  Berserker: char('barbarian', 1.35, 'Dualwield_Melee_Attack_Slice', { gear: ['1H_Axe', '1H_Axe_Offhand', 'Barbarian_Cape'] }),
  Valkyrie: char('barbarian', 1.45, '2H_Melee_Attack_Spin', { gear: ['2H_Axe', 'Barbarian_Cape'], tint: 0xffd090 }),
  AxeMan: char('barbarian', 1.6, 'Throw', { gear: ['2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape'], tint: 0x8a8a9a }),
  Fisherman: char('barbarian', 1.45, '1H_Melee_Attack_Chop', { gear: ['1H_Axe', 'Barbarian_Hat'], tint: 0xa0c8e0 }),
  RascalBoy: char('barbarian', 1.55, 'Unarmed_Melee_Attack_Punch_A', { gear: ['Barbarian_Hat'] }),
  Miner: char('barbarian', 1.35, '1H_Melee_Attack_Chop', { gear: ['1H_Axe', 'Barbarian_Hat'], tint: 0xc8a070 }),
  GoblinBrawler: char('barbarian', 1.25, 'Unarmed_Melee_Attack_Punch_A', { tint: GREEN_SKIN }),
  Giant: char('barbarian', 2.6, 'Unarmed_Melee_Attack_Punch_A', { tint: 0xffd8b0 }),
  RoyalGiant: char('barbarian', 2.5, 'Throw', { gear: ['Barbarian_Cape'], tint: 0xfff0c8 }),
  ElectroGiant: char('barbarian', 2.6, 'Unarmed_Melee_Attack_Punch_A', { gear: ['Barbarian_Cape'], tint: 0x9fd8ff }),
  GoblinGiant: char('barbarian', 2.5, 'Unarmed_Melee_Attack_Punch_A', { tint: GREEN_SKIN }),
  GiantBuffer: char('barbarian', 2.4, 'Unarmed_Melee_Attack_Punch_A', { gear: ['Barbarian_Cape'], tint: 0xc8a8ff }),
  Bowler: char('barbarian', 1.9, 'Throw', { tint: 0x8fb0e0 }),
  HogRider: char('barbarian', 1.4, '1H_Melee_Attack_Chop', { gear: ['1H_Axe', 'Barbarian_Hat'], mount: 'hog' }),
  Hunter: char('barbarian', 1.6, '2H_Ranged_Shoot', { gear: ['Barbarian_Hat'], weapons: [{ key: 'skel_crossbow', hand: 'r' }] }),
  Archer: char('rogue', 1.3, '2H_Ranged_Shoot', { gear: ['2H_Crossbow', 'Rogue_Cape'] }),
  Musketeer: char('rogue_hooded', 1.4, '2H_Ranged_Shoot', { gear: ['2H_Crossbow', 'Rogue_Cape'], tint: 0xd8c8ff }),
  Princess: char('rogue', 1.3, '1H_Ranged_Shoot', { gear: ['1H_Crossbow', 'Rogue_Cape'], tint: 0xffc8e8 }),
  EliteArcher: char('rogue_hooded', 1.4, '2H_Ranged_Shoot', { gear: ['2H_Crossbow', 'Rogue_Cape'], tint: 0xa8d8ff }),
  Firecracker: char('rogue', 1.3, '2H_Ranged_Shoot', { gear: ['2H_Crossbow'], tint: 0xffb0a0 }),
  RascalGirl: char('rogue', 1.2, 'Throw', { gear: ['Throwable'] }),
  Assassin: char('rogue_hooded', 1.35, 'Dualwield_Melee_Attack_Slice', { gear: ['Knife', 'Knife_Offhand', 'Rogue_Cape'], tint: 0xb0b0c8 }),
  RamRider: char('rogue', 1.25, 'Throw', { gear: ['Throwable', 'Rogue_Cape'] }),
  Goblin: char('rogue_hooded', 1.0, '1H_Melee_Attack_Stab', { gear: ['Knife'], tint: GREEN_SKIN }),
  Goblin_Stab: char('rogue_hooded', 1.0, '1H_Melee_Attack_Stab', { gear: ['Knife'], tint: GREEN_SKIN }),
  BushGoblin: char('rogue_hooded', 1.0, '1H_Melee_Attack_Stab', { gear: ['Knife'], tint: GREEN_SKIN }),
  SpearGoblin: char('rogue_hooded', 1.0, 'Throw', { gear: ['Throwable'], tint: GREEN_SKIN }),
  SpearGoblinGiant: char('rogue_hooded', 0.9, 'Throw', { gear: ['Throwable'], tint: GREEN_SKIN }),
  BlowdartGoblin: char('rogue_hooded', 1.05, '1H_Ranged_Shoot', { gear: ['1H_Crossbow'], tint: GREEN_SKIN }),
  GoblinDemolisher: char('barbarian', 1.4, 'Throw', { gear: ['Barbarian_Hat'], tint: GREEN_SKIN, weapons: [{ key: 'smokebomb', hand: 'r', scale: 1.4 }] }),
  GoblinDemolisher_kamikaze_form: char('barbarian', 1.4, 'Unarmed_Melee_Attack_Punch_A', { tint: GREEN_SKIN, weapons: [{ key: 'smokebomb', hand: 'r', scale: 2 }] }),
  Wizard: char('mage', 1.45, 'Spellcast_Shoot', { gear: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], tint: 0xffd0a0 }),
  IceWizard: char('mage', 1.45, 'Spellcast_Shoot', { gear: ['1H_Wand', 'Mage_Hat', 'Mage_Cape'], tint: 0xc8ecff }),
  ElectroWizard: char('mage', 1.45, 'Spellcast_Shoot', { gear: ['1H_Wand', 'Spellbook_open', 'Mage_Hat'], tint: 0xa0d0ff }),
  Witch: char('mage', 1.45, 'Spellcast_Summon', { gear: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], tint: 0xd8b0ff }),
  DarkWitch: char('mage', 1.5, 'Spellcast_Summon', { gear: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], tint: 0x7a6a9a }),
  WitchMother: char('mage', 1.45, 'Spellcast_Shoot', { gear: ['2H_Staff', 'Mage_Hat'], tint: 0xc0a0e0 }),

  // --- Skeletons (skeletons pack) ----------------------------------------------------------------
  Skeleton: char('skel_minion', 0.95, '1H_Melee_Attack_Chop', { walk: 'Walking_D_Skeletons', weapons: [{ key: 'skel_blade', hand: 'r' }] }),
  SkeletonWarrior: char('skel_warrior', 1.2, '1H_Melee_Attack_Stab', { walk: 'Walking_D_Skeletons', weapons: [{ key: 'skel_blade', hand: 'r' }, { key: 'skel_shield', hand: 'l' }] }),
  GiantSkeleton: char('skel_warrior', 2.6, '2H_Melee_Attack_Chop', { walk: 'Walking_D_Skeletons', weapons: [{ key: 'skel_axe', hand: 'r' }] }),
  Bomber: char('skel_mage', 1.1, 'Throw', { walk: 'Walking_D_Skeletons', weapons: [{ key: 'smokebomb', hand: 'r', scale: 1.3 }] }),
  Wallbreaker: char('skel_minion', 1.0, 'Throw', { walk: 'Running_A', weapons: [{ key: 'smokebomb', hand: 'r', scale: 1.8 }] }),
  Ghost: char('skel_rogue', 1.35, '1H_Melee_Attack_Slice_Horizontal', { ghost: true, weapons: [{ key: 'skel_blade', hand: 'r' }] }),

  // --- Procedural creatures and machines ----------------------------------------------------------
  Minion: proc('minion', 0.9, { color: 0x4a7bd0 }),
  MegaMinion: proc('megaminion', 1.15, { color: 0x3f5f9f, color2: 0xb0b8c8 }),
  Bat: proc('bat', 0.6, { color: 0x4a3a6a }),
  BabyDragon: proc('dragon', 1.2, { color: 0x6cc04a, color2: 0xf0d070 }),
  InfernoDragon: proc('dragon', 1.25, { color: 0xd8582a, color2: 0xffc040 }),
  ElectroDragon: proc('dragon', 1.4, { color: 0x3a8ae0, color2: 0xa0e8ff }),
  SkeletonDragon: proc('dragon', 1.1, { color: 0xe8e2d0, color2: 0x7ad070 }),
  LavaHound: proc('hound', 1.8, { color: 0x7a4030, color2: 0xff7a20 }),
  LavaPups: proc('pup', 0.7, { color: 0x8a4a30, color2: 0xff8a30 }),
  Balloon: proc('balloon', 2.0, { color: 0xc8443a, color2: 0x8a5a30 }),
  SkeletonBalloon: proc('skelballoon', 1.6, { color: 0x9a7a50 }),
  DartBarrell: proc('flyingmachine', 1.2, { color: 0x9a6a3a, color2: 0xc0c0c0 }),
  Phoenix: proc('phoenix', 1.3, { color: 0xff6a20, color2: 0xffd040 }),
  PhoenixEgg: proc('egg', 0.7, { color: 0xffa040 }),
  MergeMaiden_Mounted: proc('mergemount', 1.4, { color: 0x8ad0ff, color2: 0xffffff }),
  Golem: proc('golem', 2.6, { color: 0x8a8070 }),
  Golemite: proc('golemite', 1.2, { color: 0x8a8070 }),
  IceGolemite: proc('icegolem', 1.4, { color: 0xbfe6ff }),
  ElixirGolem1: proc('elixirblob', 1.6, { color: 0xd040c8 }),
  ElixirGolem2: proc('elixirblob', 1.1, { color: 0xd040c8 }),
  ElixirGolem4: proc('elixirblob', 0.75, { color: 0xd040c8 }),
  FireSpirits: proc('spirit', 0.7, { color: 0xff6a20 }),
  IceSpirits: proc('spirit', 0.7, { color: 0x9fe0ff }),
  ElectroSpirit: proc('spirit', 0.7, { color: 0x6ab8ff }),
  HealSpirit: proc('spirit', 0.7, { color: 0xffe066 }),
  Ram: proc('ram', 1.2, { color: 0xe8e0d0 }),
  RoyalHog: proc('hog', 1.1, { color: 0xd88a6a, rider: char('rogue', 0.9, '1H_Melee_Attack_Chop', { gear: ['Knife'] }) }),
  BattleRam: proc('batteringram', 1.2, { color: 0x8a5a30 }),
  ZapMachine: proc('sparky', 1.6, { color: 0x8a6a40, color2: 0x8ad8ff }),
  MiniZapMachine: proc('zappy', 1.0, { color: 0x7a7a7a, color2: 0x8ad8ff }),
  GoblinMachine: proc('machine', 1.6, { color: 0x6a8a4a, color2: 0xc0a060 }),
  Furnace_rework: proc('furnace', 1.5, { color: 0x6a5a4a, color2: 0xff7a20 }),
  GoblinDrillDig: proc('drillmound', 0.6, { color: 0x8a6a4a }),
  SuspiciousBush: proc('bush', 1.0, { color: 0x4f9a3a }),
  BalloonBomb: proc('bomb', 0.7, { color: 0x333333 }),
  GiantSkeletonBomb: proc('bomb', 1.1, { color: 0x333333 }),
  BombTowerBomb: proc('bomb', 0.8, { color: 0x333333 }),
  RageBarbarianBottle: proc('bottle', 0.6, { color: 0xb050e0 }),
  RageBottle: proc('bottle', 0.6, { color: 0xb050e0 }),
  SkeletonContainerNew: proc('barrel', 0.8, { color: 0x8a5a30 }),

  // --- Buildings (medieval pack, team-coloured variants) ------------------------------------------
  Cannon: prop(B, 'towerbase', 1.7, { teamSuffix: true, extra: 'cannon' }),
  Mortar: prop(B, 'catapult', 2.4, { teamSuffix: true }),
  Xbow: prop(B, 'towerbase', 2.6, { teamSuffix: true, extra: 'xbow' }),
  Tesla: prop(B, 'towerbase', 1.8, { teamSuffix: true, extra: 'coil' }),
  InfernoTower: prop(B, 'towerb', 2.1, { teamSuffix: true, extra: 'inferno' }),
  BombTower: prop(B, 'towerbase', 2.1, { teamSuffix: true, extra: 'bomb' }),
  Tombstone: prop('props_spooky.glb', 'gravestone', 1.7),
  GoblinHut_Rework: prop(B, 'hut', 2.6, { teamSuffix: true }),
  BarbarianHut: prop(B, 'barracks', 2.8, { teamSuffix: true }),
  ElixirCollector: prop(B, 'well', 2.6, { teamSuffix: true, extra: 'elixir' }),
  GoblinCage: prop(B, 'towerbase', 2.3, { teamSuffix: true, extra: 'cage' }),
  GoblinDrill: prop(B, 'mine', 1.9, { teamSuffix: true }),

  // --- Area effects (spells) -----------------------------------------------------------------------
  Freeze: area(0x9fe4ff, 'dome'),
  FreezeIceGolemite: area(0x9fe4ff, 'ring'),
  Poison: area(0x8adf3a, 'pulse'),
  Rage: area(0xc050ff, 'pulse'),
  BarbarianRage: area(0xc050ff, 'pulse'),
  Earthquake: area(0xa07040, 'quake'),
  Tornado: area(0xc8d0e0, 'swirl'),
  Clone: area(0x5ae0ff, 'ring'),
  Lightning: area(0xbfe0ff, 'bolt'),
  Graveyard_rework: area(0x5a6a7a, 'grave'),
  GoblinCurse: area(0x7ae050, 'pulse'),
  Vines_AeO: area(0x5ab040, 'vines'),
  DarkMagicAOE: area(0x8a40ff, 'void'),
  RoyalDeliveryArea: area(0xffd060, 'crate'),
  BattleHealerSpawnHeal: area(0xffe066, 'ring'),
  Zap: area(0x8ad8ff, 'bolt'),
  Heal: area(0xffe066, 'ring'),
};

/** Generic fallback for names not in the table. */
export function visualFor(name: string, kind: string, movement: number, radius: number): VisualSpec {
  const v = VISUALS[name];
  if (v) return v;
  if (kind === 'A') return area(0xffffff, 'ring');
  if (kind === 'B') return prop(B, 'towerbase', Math.max(1.2, (radius / 1000) * 2.4), { teamSuffix: true });
  if (movement === 1) return proc('minion', 0.9 + radius / 1000, { color: 0x7a7aa0 });
  return char('knight', radius >= 700 ? 2.0 : 1.4, '1H_Melee_Attack_Chop', { gear: ['1H_Sword'] });
}

/** Projectile looks, keyed by the projectile's visual key (source entity name or spell card id). */
export type ProjectileLook =
  | 'volley'
  | 'arrow'
  | 'bolt'
  | 'bullet'
  | 'fireball'
  | 'bigfireball'
  | 'iceball'
  | 'magic'
  | 'zapbeam'
  | 'cannonball'
  | 'boulder'
  | 'bomb'
  | 'axe'
  | 'spear'
  | 'dart'
  | 'rocket'
  | 'barrel'
  | 'log'
  | 'snowball'
  | 'firework'
  | 'healorb'
  | 'stone'
  | 'darkorb';

export const PROJECTILES: Record<string, { look: ProjectileLook; arc: number; color?: number }> = {
  Archer: { look: 'arrow', arc: 0.12 },
  'Princess Tower': { look: 'arrow', arc: 0.06 },
  Princess: { look: 'arrow', arc: 0.15, color: 0xff7a20 },
  EliteArcher: { look: 'arrow', arc: 0, color: 0x6ad0ff },
  Hunter: { look: 'bullet', arc: 0 },
  Musketeer: { look: 'bullet', arc: 0 },
  Firecracker: { look: 'firework', arc: 0.25 },
  SpearGoblin: { look: 'spear', arc: 0.15 },
  SpearGoblinGiant: { look: 'spear', arc: 0.15 },
  BlowdartGoblin: { look: 'dart', arc: 0.05 },
  DartBarrell: { look: 'dart', arc: 0.05 },
  Wizard: { look: 'fireball', arc: 0.1 },
  BabyDragon: { look: 'fireball', arc: 0.05 },
  FireSpirits: { look: 'fireball', arc: 0.6 },
  Furnace_rework: { look: 'fireball', arc: 0.5 },
  IceWizard: { look: 'iceball', arc: 0.05 },
  IceSpirits: { look: 'iceball', arc: 0.6 },
  HealSpirit: { look: 'healorb', arc: 0.6 },
  ElectroWizard: { look: 'zapbeam', arc: 0 },
  ElectroSpirit: { look: 'zapbeam', arc: 0 },
  ElectroDragon: { look: 'zapbeam', arc: 0 },
  ZapMachine: { look: 'zapbeam', arc: 0 },
  MiniZapMachine: { look: 'zapbeam', arc: 0 },
  Witch: { look: 'magic', arc: 0.05, color: 0xd070ff },
  DarkWitch: { look: 'magic', arc: 0.05, color: 0x8040c0 },
  WitchMother: { look: 'magic', arc: 0.05, color: 0xd070ff },
  MergeMaiden_Mounted: { look: 'magic', arc: 0.05, color: 0x8ad0ff },
  Minion: { look: 'darkorb', arc: 0.02 },
  SkeletonDragon: { look: 'fireball', arc: 0.05, color: 0x7ad070 },
  LavaHound: { look: 'fireball', arc: 0.05 },
  RoyalGiant: { look: 'cannonball', arc: 0.05 },
  'Crown Tower': { look: 'cannonball', arc: 0.05 },
  Cannon: { look: 'cannonball', arc: 0.05 },
  Mortar: { look: 'boulder', arc: 0.5 },
  Xbow: { look: 'bolt', arc: 0 },
  BombTower: { look: 'bomb', arc: 0.45 },
  Bomber: { look: 'bomb', arc: 0.45 },
  GoblinDemolisher: { look: 'bomb', arc: 0.45 },
  Bowler: { look: 'boulder', arc: 0 },
  AxeMan: { look: 'axe', arc: 0 },
  RascalGirl: { look: 'stone', arc: 0.2 },
  GoblinMachine: { look: 'rocket', arc: 0.3 },
  // spells (keyed by card id)
  fireball: { look: 'bigfireball', arc: 0.35 },
  arrows: { look: 'volley', arc: 0.35 },
  rocket: { look: 'rocket', arc: 0.4 },
  goblinbarrel: { look: 'barrel', arc: 0.5 },
  log: { look: 'log', arc: 0 },
  barblog: { look: 'log', arc: 0 },
  snowball: { look: 'snowball', arc: 0.35 },
  royaldelivery: { look: 'barrel', arc: 0.3 },
  spell: { look: 'fireball', arc: 0.3 },
};
