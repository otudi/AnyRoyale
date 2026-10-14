import * as THREE from 'three';
import { addOutlines, setOutlinesVisible } from './outline';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../assets/AssetLoader';
import { buildMount, buildProc, type ProcModel } from './procedural';
import type { CharSpec, PropSpec, VisualSpec } from './visualCatalog';

export const TEAM_COLORS = { own: 0x3d8bff, enemy: 0xff4646 } as const;

/** Units are drawn a little larger than their footprint so they read well on phones. */
export const UNIT_SCALE = 1.35;
export type Side = 'own' | 'enemy';

/** Files that must be loaded before battles (characters + shared animation library). */
export const CORE_MODEL_FILES = [
  'anims.glb',
  'char_knight.glb',
  'char_barbarian.glb',
  'char_mage.glb',
  'char_rogue.glb',
  'char_rogue_hooded.glb',
  'char_skel_warrior.glb',
  'char_skel_minion.glb',
  'char_skel_mage.glb',
  'char_skel_rogue.glb',
  'env_core.glb',
  'weapons.glb',
];

let clips: Map<string, THREE.AnimationClip> | null = null;

function clipLibrary(): Map<string, THREE.AnimationClip> {
  if (!clips) {
    clips = new Map();
    for (const c of assets.get('anims.glb')?.animations ?? []) clips.set(c.name, c);
  }
  return clips;
}

export function resetClipCache(): void {
  clips = null;
}

/** Native height of each character model, measured once. */
const nativeHeight = new Map<string, number>();
const templates = new Map<string, THREE.Object3D>();

function charFile(model: string): string {
  return `char_${model}.glb`;
}

/**
 * Builds (and caches) a dressed, team-coloured character template: gear visibility applied,
 * capes/hats recoloured to the team colour, body tinted, extra weapons attached to hand slots.
 * Units are created by cloning this template with SkeletonUtils (shares geometry, own skeleton).
 */
/** Native height used for every forged model (rest pose body + head, like the KayKit bodies). */
const FORGED_NATIVE = 2.4;

function forgedTemplate(spec: CharSpec, side: Side): THREE.Object3D | null {
  const file = spec.forged!;
  const key = `forged|${file}|${side}|${spec.ghost ? 1 : 0}`;
  const cached = templates.get(key);
  if (cached) return cached;
  const gltf = assets.get(file);
  if (!gltf) {
    void assets.load(file); // ready for the next unit / portrait
    return null;
  }
  const tpl = SkeletonUtils.clone(gltf.scene);
  const teamColor = new THREE.Color(TEAM_COLORS[side]);
  tpl.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const m = src.clone();
    m.roughness = Math.max(0.6, m.roughness);
    m.metalness = 0;
    // the forged "Team" mesh is painted white in the atlas: the team colour tints it
    if (mesh.name.startsWith('Team')) m.color = teamColor.clone();
    if (spec.ghost) {
      m.transparent = true;
      m.opacity = 0.55;
      m.emissive = new THREE.Color(0x6080ff);
      m.emissiveIntensity = 0.25;
    }
    mesh.material = m;
  });
  nativeHeight.set(file, FORGED_NATIVE);
  if (!spec.ghost) addOutlines(tpl);
  templates.set(key, tpl);
  return tpl;
}

function characterTemplate(spec: CharSpec, side: Side): THREE.Object3D | null {
  if (spec.forged) {
    const forged = forgedTemplate(spec, side);
    if (forged) return forged;
  }
  const key = `${spec.model}|${(spec.extras ?? []).join(',')}|${(spec.gear ?? []).join(',')}|${(spec.weapons ?? []).map((w) => w.key + w.hand).join(',')}|${spec.tint ?? 0}|${side}|${spec.ghost ? 1 : 0}`;
  const cached = templates.get(key);
  if (cached) return cached;
  const gltf = assets.get(charFile(spec.model));
  if (!gltf) return null;
  const tpl = SkeletonUtils.clone(gltf.scene);
  const teamColor = new THREE.Color(TEAM_COLORS[side]);
  const gear = new Set(spec.gear ?? []);
  const materialCache = new Map<THREE.Material, THREE.Material>();
  tpl.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false; // skinned bounds are unreliable when animated
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
    if (!skinned) {
      // Accessories (weapons, shields, hats, capes) are rigid meshes parented to bones.
      const name = mesh.name;
      const isCosmetic = /Cape|Cloak|Hat|Helmet|Hood/.test(name);
      mesh.visible = gear.has(name) || (isCosmetic && gear.size === 0 && /Cloak|Hood/.test(name));
    }
    const isTeamPart = /Cape|Cloak|Hat|Hood/.test(mesh.name);
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (isTeamPart) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: teamColor,
        roughness: 0.8,
        transparent: !!spec.ghost,
        opacity: spec.ghost ? 0.55 : 1,
      });
      return;
    }
    let m = materialCache.get(src);
    if (!m) {
      const clone = src.clone() as THREE.MeshStandardMaterial;
      if (spec.tint) clone.color = new THREE.Color(spec.tint);
      if (spec.ghost) {
        clone.transparent = true;
        clone.opacity = 0.55;
        clone.emissive = new THREE.Color(0x6080ff);
        clone.emissiveIntensity = 0.25;
      }
      clone.roughness = Math.max(0.55, clone.roughness);
      materialCache.set(src, clone);
      m = clone;
    }
    mesh.material = m;
  });
  // Attach extra weapon props from weapons.glb to hand slots.
  for (const w of spec.weapons ?? []) {
    const src = assets.node('weapons.glb', w.key);
    if (!src) continue;
    const slot = findBone(tpl, w.hand === 'r' ? 'handslotr' : 'handslotl');
    if (!slot) continue;
    const prop = src.clone();
    prop.scale.multiplyScalar(w.scale ?? 1);
    prop.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
    slot.add(prop);
  }
  if (!nativeHeight.has(spec.model)) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    nativeHeight.set(spec.model, Math.max(0.5, box.max.y - box.min.y));
  }
  attachExtras(tpl, spec);
  if (!spec.ghost) addOutlines(tpl);
  templates.set(key, tpl);
  return tpl;
}

const extraMats = new Map<number, THREE.MeshStandardMaterial>();
function extraMat(color: number, metal = 0): THREE.MeshStandardMaterial {
  let m = extraMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.75, metalness: metal, flatShading: true });
    extraMats.set(color, m);
  }
  return m;
}

/** Procedural accessories on bones (ears, spear, tiara) so units sharing a body look different. */
function attachExtras(tpl: THREE.Object3D, spec: CharSpec): void {
  const extras = spec.extras ?? [];
  if (!extras.length) return;
  const head = findBone(tpl, 'head');
  const hand = findBone(tpl, 'handslotr');
  if (head && extras.includes('goblinEars')) {
    const skin = extraMat(0x7cc04a);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.62, 5), skin);
      ear.position.set(sx * 0.5, 0.52, -0.02);
      ear.rotation.z = -sx * 1.25;
      ear.rotation.y = sx * 0.35;
      ear.castShadow = true;
      head.add(ear);
    }
  }
  if (head && extras.includes('tiara')) {
    const gold = extraMat(0xffd24a, 0.6);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 5, 18), gold);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.74;
    head.add(band);
    for (let i = -1; i <= 1; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, i === 0 ? 0.3 : 0.2, 4), gold);
      spike.position.set(i * 0.2, 0.86 + (i === 0 ? 0.05 : 0), 0.4);
      head.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), extraMat(0xff4a8a, 0.3));
    gem.position.set(0, 0.77, 0.47);
    head.add(gem);
  }
  if (hand && extras.includes('spear')) {
    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), extraMat(0x8a5a2c));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 4), extraMat(0xd8dde8, 0.7));
    tip.position.y = 0.95;
    spear.add(shaft, tip);
    spear.rotation.x = Math.PI / 2;
    spear.position.z = 0.1;
    hand.add(spear);
  }
}

function findBone(root: THREE.Object3D, sanitized: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === sanitized) found = o;
  });
  return found;
}

const propTemplates = new Map<string, THREE.Object3D>();

function propTemplate(spec: PropSpec, side: Side): THREE.Object3D | null {
  const key = spec.teamSuffix ? `${spec.key}_${side === 'own' ? 'blue' : 'red'}` : spec.key;
  const cacheKey = `${spec.bundle}|${key}|${spec.width}`;
  const cached = propTemplates.get(cacheKey);
  if (cached) return cached;
  const src = assets.node(spec.bundle, key);
  if (!src) return null;
  const tpl = new THREE.Group();
  const inner = src.clone();
  inner.position.set(0, 0, 0);
  const box = new THREE.Box3().setFromObject(inner);
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 0.01);
  const s = spec.width / width;
  inner.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(inner);
  inner.position.y -= box2.min.y;
  inner.position.x -= (box2.min.x + box2.max.x) / 2;
  inner.position.z -= (box2.min.z + box2.max.z) / 2;
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  tpl.add(inner);
  addOutlines(tpl);
  tpl.userData.height = box2.max.y - box2.min.y;
  propTemplates.set(cacheKey, tpl);
  return tpl;
}

/** A unit/building on screen. Positions are set by the battle view; this class animates it. */
export class UnitVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private proc: ProcModel | null = null;
  private mount: ProcModel | null = null;
  private attackPhase = 0;
  private attackDuration = 0.8;
  private moving = 0;
  private time = Math.random() * 10;
  private frozen = false;
  private flashT = 0;
  private materials: THREE.MeshStandardMaterial[] = [];
  private baseEmissive = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private effectsMaterials = false;
  height = 1.4;
  flying = false;
  dying = false;
  private deathTime = 0;
  private spawnTime = 0;
  private extraAnimator: ((dt: number, t: number) => void) | null = null;

  constructor(
    readonly spec: VisualSpec,
    readonly side: Side,
  ) {
    this.root.add(this.body);
    if (spec.kind === 'char') this.buildChar(spec);
    else if (spec.kind === 'proc') this.buildProcedural(spec);
    else if (spec.kind === 'prop') this.buildProp(spec);
    this.collectMaterials();
  }

  private buildChar(spec: CharSpec, parent: THREE.Object3D = this.body, scaleOverride?: number): void {
    const tpl = characterTemplate(spec, this.side);
    if (!tpl) {
      // Model failed to load: procedural stand-in so the unit is still visible and playable.
      this.proc = buildProc('golemite', spec.height, 0xb0b0b0);
      parent.add(this.proc.root);
      this.height = spec.height;
      return;
    }
    const model = SkeletonUtils.clone(tpl);
    const native = (spec.forged && assets.get(spec.forged) ? nativeHeight.get(spec.forged) : nativeHeight.get(spec.model)) ?? 2;
    const s = scaleOverride ?? (spec.height * UNIT_SCALE) / native;
    model.scale.setScalar(s);
    parent.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    const lib = clipLibrary();
    const want = ['Idle', spec.walk ?? 'Walking_A', 'Running_A', spec.attack, 'Death_A', 'Death_C_Skeletons', 'Hit_A', 'Spawn_Ground', 'Spawn_Ground_Skeletons', 'Cheer'];
    for (const name of want) {
      const clip = lib.get(name);
      if (clip && !this.actions.has(name)) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.height = spec.height * UNIT_SCALE;
    if (spec.mount) {
      this.mount = buildMount(spec.mount);
      addOutlines(this.mount.root);
      this.body.add(this.mount.root);
      model.position.y = this.mount.top * 0.62;
      model.position.z = -0.05;
      this.mount.root.scale.setScalar(UNIT_SCALE);
      model.position.y = this.mount.top * 0.62 * UNIT_SCALE;
      this.height = spec.height * UNIT_SCALE * 0.75 + this.mount.top * 0.6 * UNIT_SCALE;
      this.playLoop('Idle');
    } else {
      this.playLoop('Idle');
    }
  }

  private buildProcedural(spec: Extract<VisualSpec, { kind: 'proc' }>): void {
    this.proc = buildProc(spec.shape, spec.height * UNIT_SCALE, spec.color, spec.color2);
    addOutlines(this.proc.root);
    this.body.add(this.proc.root);
    this.height = this.proc.top;
    this.flying = this.proc.flying;
    if (spec.rider) {
      const rider = new THREE.Group();
      rider.position.y = spec.height * UNIT_SCALE * 0.55;
      this.body.add(rider);
      this.buildChar(spec.rider, rider);
      this.height = (spec.height + spec.rider.height * 0.6) * UNIT_SCALE;
    }
  }

  private buildProp(spec: PropSpec): void {
    const tpl = propTemplate(spec, this.side);
    if (tpl) {
      const model = tpl.clone();
      this.body.add(model);
      this.height = (tpl.userData.height as number) ?? 1.5;
    } else {
      const fallback = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.8, 1, spec.width * 0.8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      fallback.position.y = 0.5;
      this.body.add(fallback);
      this.height = 1;
    }
    this.addPropExtra(spec);
  }

  private addPropExtra(spec: PropSpec): void {
    const h = this.height;
    const color = TEAM_COLORS[this.side];
    switch (spec.extra) {
      case 'coil': {
        const coil = new THREE.Group();
        coil.position.y = h;
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 14), new THREE.MeshStandardMaterial({ color: 0xb08a50, metalness: 0.8, roughness: 0.3 }));
          ring.rotation.x = Math.PI / 2;
          ring.position.y = i * 0.16;
          coil.add(ring);
        }
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x3aa0ff, emissiveIntensity: 1 }));
        orb.position.y = 0.55;
        coil.add(orb);
        this.body.add(coil);
        this.extraAnimator = (_dt, t) => orb.scale.setScalar(1 + Math.sin(t * 9) * 0.15);
        this.height = h + 0.8;
        break;
      }
      case 'inferno': {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 7), new THREE.MeshStandardMaterial({ color: 0xff8a20, emissive: 0xff4a00, emissiveIntensity: 1.2 }));
        flame.position.y = h + 0.3;
        this.body.add(flame);
        this.extraAnimator = (_dt, t) => {
          flame.scale.set(1 + Math.sin(t * 13) * 0.1, 1 + Math.sin(t * 17) * 0.2, 1);
        };
        this.height = h + 0.7;
        break;
      }
      case 'bomb': {
        const bomb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.4, roughness: 0.5 }));
        bomb.position.y = h + 0.25;
        this.body.add(bomb);
        this.height = h + 0.6;
        break;
      }
      case 'cannon': {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.4 }));
        barrel.rotation.x = Math.PI / 2.4;
        barrel.position.set(0, h + 0.2, 0.25);
        const pivot = new THREE.Group();
        pivot.add(barrel);
        pivot.userData.aim = true;
        this.body.add(pivot);
        this.height = h + 0.5;
        break;
      }
      case 'xbow': {
        const pivot = new THREE.Group();
        pivot.position.y = h + 0.1;
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x6a4a2a }));
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a6a3a }));
        bow.rotation.x = -Math.PI / 2;
        bow.position.z = 0.5;
        pivot.add(stock, bow);
        pivot.userData.aim = true;
        this.body.add(pivot);
        this.height = h + 0.5;
        break;
      }
      case 'elixir': {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe040e0, emissive: 0x9020a0, emissiveIntensity: 0.8, roughness: 0.2 }));
        drop.scale.y = 1.3;
        drop.position.y = h + 0.4;
        this.body.add(drop);
        this.extraAnimator = (_dt, t) => (drop.position.y = h + 0.4 + Math.sin(t * 2) * 0.08);
        this.height = h + 0.9;
        break;
      }
      case 'cage': {
        const cage = new THREE.Group();
        for (let i = 0; i < 8; i++) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7 }));
          const a = (i / 8) * Math.PI * 2;
          bar.position.set(Math.cos(a) * 0.45, h + 0.45, Math.sin(a) * 0.45);
          cage.add(bar);
        }
        const goblin = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0x9fdc6a }));
        goblin.position.y = h + 0.3;
        cage.add(goblin);
        this.body.add(cage);
        this.height = h + 1.0;
        break;
      }
      default:
        break;
    }
    void color;
  }

  private collectMaterials(): void {
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !this.materials.includes(m)) this.materials.push(m);
    });
  }

  /** Status tints (freeze, rage, poison...) need per-unit materials; clone them on first use. */
  private ensureOwnMaterials(): void {
    if (this.effectsMaterials) return;
    this.effectsMaterials = true;
    const map = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (!src.isMeshStandardMaterial) return;
      let m = map.get(src);
      if (!m) {
        m = src.clone();
        map.set(src, m);
        this.baseEmissive.set(m, m.emissive.clone());
      }
      mesh.material = m;
    });
    this.materials = [...map.values()];
  }

  setStatus(frozen: boolean, stunned: boolean, raged: boolean, poisoned: boolean, slowed: boolean): void {
    const any = frozen || raged || poisoned || slowed || stunned;
    if (!any && !this.effectsMaterials) {
      this.frozen = false;
      return;
    }
    this.ensureOwnMaterials();
    this.frozen = frozen || stunned;
    const tint = frozen ? 0x5ab8ff : raged ? 0xb040ff : poisoned ? 0x60c020 : slowed ? 0x4080c0 : stunned ? 0xffe060 : 0;
    for (const m of this.materials) {
      const base = this.baseEmissive.get(m) ?? new THREE.Color(0);
      if (tint) {
        m.emissive.setHex(tint);
        m.emissiveIntensity = frozen ? 0.55 : 0.35;
      } else {
        m.emissive.copy(base);
        m.emissiveIntensity = 1;
      }
    }
  }

  /** Brief white flash when the unit takes damage. */
  hitFlash(): void {
    this.ensureOwnMaterials();
    this.flashT = 0.14;
  }

  setOpacity(alpha: number): void {
    this.ensureOwnMaterials();
    setOutlinesVisible(this.root, alpha >= 0.999);
    for (const m of this.materials) {
      m.transparent = alpha < 1;
      m.opacity = alpha;
      m.depthWrite = alpha >= 1;
    }
  }

  private playLoop(name: string, timeScale = 1, fade = 0.18): void {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === a) return;
    a.reset();
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
  }

  private playOnce(name: string, duration: number): void {
    const a = this.actions.get(name);
    if (!a) return;
    const clipLen = a.getClip().duration;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = clipLen / Math.max(0.25, duration);
    a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, 0.08, false);
    this.current = a;
  }

  /** Called when the server says this unit started an attack wind-up. */
  startAttack(duration: number): void {
    this.attackDuration = Math.max(0.3, Math.min(duration, 2.5));
    this.attackPhase = 0.0001;
    if (this.mixer && this.spec.kind === 'char') this.playOnce(this.spec.attack, this.attackDuration);
    else if (this.spec.kind === 'proc' && this.spec.rider && this.mixer) this.playOnce(this.spec.rider.attack, this.attackDuration);
  }

  spawn(): void {
    this.spawnTime = 0.0001;
    if (this.actions.has('Spawn_Ground_Skeletons') && this.spec.kind === 'char' && this.spec.model.startsWith('skel')) {
      this.playOnce('Spawn_Ground_Skeletons', 0.9);
    }
  }

  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.deathTime = 0;
    if (this.mixer) {
      const skel = this.spec.kind === 'char' && this.spec.model.startsWith('skel');
      this.playOnce(skel && this.actions.has('Death_C_Skeletons') ? 'Death_C_Skeletons' : 'Death_A', 0.9);
    }
  }

  /** Returns false when the death animation finished and the visual can be removed. */
  update(dt: number, moveSpeed: number, flags: { frozen: boolean }): boolean {
    this.time += dt;
    if (this.flashT > 0) {
      // setStatus() restores the normal emissive on the next frame once the flash is over
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.14);
      for (const m of this.materials) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.65 * k;
      }
    }
    const frozen = flags.frozen || this.frozen;
    if (this.spawnTime > 0) {
      this.spawnTime += dt;
      const k = Math.min(1, this.spawnTime / 0.3);
      this.body.scale.setScalar(0.3 + 0.7 * easeOutBack(k));
      if (k >= 1) this.spawnTime = 0;
    }
    if (this.dying) {
      this.deathTime += dt;
      this.mixer?.update(dt);
      if (!this.mixer) {
        const k = Math.min(1, this.deathTime / 0.45);
        this.body.scale.setScalar(Math.max(0.01, 1 - k));
        this.body.rotation.z = k * 0.6;
      } else if (this.deathTime > 1.0) {
        this.body.position.y = -(this.deathTime - 1.0) * 1.2;
      }
      return this.deathTime < (this.mixer ? 1.6 : 0.5);
    }
    // movement → walk/run
    this.moving += (Math.min(1, moveSpeed / 1.2) - this.moving) * Math.min(1, dt * 8);
    if (this.attackPhase > 0) {
      this.attackPhase += dt / this.attackDuration;
      if (this.attackPhase >= 1) {
        this.attackPhase = 0;
        this.current = null;
      }
    }
    if (this.mixer && this.attackPhase === 0 && !this.dying) {
      if (moveSpeed > 0.15) {
        const run = moveSpeed > 1.6 && this.actions.has('Running_A');
        const walkName = this.spec.kind === 'char' ? this.spec.walk ?? 'Walking_A' : 'Walking_A';
        this.playLoop(run ? 'Running_A' : walkName, Math.max(0.6, Math.min(1.8, moveSpeed / (run ? 2.6 : 1.3))));
      } else {
        this.playLoop('Idle');
      }
    }
    if (this.mixer && !frozen) this.mixer.update(dt);
    const procState = { t: this.time, moving: this.moving, attack: this.attackPhase, frozen };
    this.proc?.animate(procState);
    this.mount?.animate(procState);
    this.extraAnimator?.(dt, this.time);
    return true;
  }

  /** Aims turret-style props (cannon, x-bow) at a world point. */
  aim(target: THREE.Vector3 | null): void {
    if (!target) return;
    this.body.traverse((o) => {
      if (o.userData.aim) {
        const local = this.root.worldToLocal(target.clone());
        o.rotation.y = Math.atan2(local.x, local.z);
      }
    });
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    if (this.effectsMaterials) for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Rotating-arena towers use the same character models on top (archer / king). */
export function towerTopCharacter(kind: 'archer' | 'king', side: Side): UnitVisual {
  const spec: CharSpec =
    kind === 'archer'
      ? { kind: 'char', model: 'rogue', height: 1.15, attack: '2H_Ranged_Shoot', gear: ['2H_Crossbow', 'Rogue_Cape'] }
      : { kind: 'char', model: 'knight', height: 1.35, attack: 'Throw', gear: ['Knight_Cape'], crown: true, tint: 0xfff2c0 };
  const v = new UnitVisual(spec, side);
  if (kind === 'king') {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.13, 0.12, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }),
    );
    crown.position.y = 1.42;
    v.body.add(crown);
  }
  return v;
}
