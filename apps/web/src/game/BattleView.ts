import * as THREE from 'three';
import { audio } from '../audio/AudioManager';
import type { SfxName } from '../audio/sfx';
import { F, type EntityTuple, type GameEvent, type Phase, type ProjectileTuple, type Snapshot, type TeamName } from '../network/protocol';
import { ArenaBuilder } from '../rendering/ArenaBuilder';
import { themeFor } from '../rendering/arenaThemes';
import { toWorld } from '../rendering/coords';
import { AreaVisual, Effects } from '../rendering/Effects';
import { BlobShadows, TeamRings } from '../rendering/BlobShadows';
import { HpBars } from '../rendering/HpBars';
import { PlayMarkers } from '../rendering/PlayMarkers';
import type { Renderer3D } from '../rendering/Renderer3D';
import { TowerVisual } from '../rendering/TowerVisual';
import { TEAM_COLORS, UnitVisual, type Side } from '../rendering/UnitFactory';
import { visualFor, type AreaSpec } from '../rendering/visualCatalog';
import { cards } from './cards';

interface SnapState {
  tick: number;
  entities: Map<number, EntityTuple>;
  projectiles: Map<number, ProjectileTuple>;
  events: GameEvent[];
  processed: boolean;
}

interface ProjState {
  obj: THREE.Object3D;
  origin: THREE.Vector3;
  arc: number;
  baseY: number;
  last: THREE.Vector3;
  key: string;
}

export interface TowerLabel {
  id: number;
  side: Side;
  kind: 'K' | 'P';
  hp: number;
  max: number;
  /** World position of the label anchor (tower top). */
  wx: number;
  wy: number;
  wz: number;
  alive: boolean;
  flags: number;
}

const DELAY_TICKS = 3;
const SFX_FOR_SPELL: Record<string, SfxName> = {
  fireball: 'fireLaunch',
  rocket: 'fireLaunch',
  arrows: 'arrow',
  zap: 'zap',
  freeze: 'freeze',
  poison: 'poison',
  rage: 'rage',
  lightning: 'lightning',
  log: 'roll',
  barblog: 'roll',
  heal: 'heal',
  tornado: 'magic',
  clone: 'spawnMagic',
  earthquake: 'heavyStep',
  graveyard: 'spawnMagic',
  goblinbarrel: 'fireLaunch',
  snowball: 'freeze',
  royaldelivery: 'deploy',
  darkmagic: 'magic',
  goblincurse: 'poison',
  vines: 'magic',
  mirror: 'spawnMagic',
};

/**
 * Renders an authoritative match from server snapshots.
 *
 * Snapshots arrive at 10 Hz; the view renders ~150 ms in the past and interpolates between the two
 * snapshots around the render time, so motion stays smooth despite network jitter. Events (hits,
 * deaths, explosions, card plays) are applied when the render time reaches their snapshot, so
 * effects line up with what is on screen. Nothing here decides game outcomes: positions, health,
 * deaths and elixir all come from the server.
 */
/** How long a troop's health bar stays up after it is hit. */
const HP_BAR_SECONDS = 3.5;

export class BattleView {
  readonly side: Record<0 | 1, Side>;
  private arena: ArenaBuilder;
  private fx: Effects;
  private bars = new HpBars();
  private markers: PlayMarkers;
  private blobs = new BlobShadows();
  private rings = new TeamRings();
  private snaps: SnapState[] = [];
  private renderTick = -1;
  private latestTick = -1;
  private units = new Map<number, UnitVisual>();
  private unitInfo = new Map<number, { name: string; lastFlags: number; lastPos: THREE.Vector3; speed: number; kind: string; lag: number; lastHp: number; acc: number; lastEmit: number; lastHit: number }>();
  /** Tick of the snapshot whose health values were last compared (damage numbers). */
  private hpTick = -1;
  private towerDmg = new Map<number, { acc: number; last: number }>();
  private towers = new Map<number, TowerVisual>();
  private towerData = new Map<number, TowerLabel>();
  private areas = new Map<number, AreaVisual>();
  private projectiles = new Map<number, ProjState>();
  private dying = new Set<UnitVisual>();
  private diedIds = new Set<number>();
  private recentSpells: { card: string; x: number; z: number; t: number }[] = [];
  private time = 0;
  /** Units created so far (cumulative), by side. */
  private spawned = { own: 0, enemy: 0 };
  private removeUpdater: () => void;
  private world = new THREE.Group();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  onPhase: (p: Phase) => void = () => {};
  onTowerDestroyed: (side: Side, kind: 'K' | 'P') => void = () => {};
  onOpponentPlay: (cardId: string) => void = () => {};
  /** Damage (positive) or healing (negative) shown as a floating number at screen x/y. */
  onDamage: (sx: number, sy: number, amount: number, victim: Side, big: boolean) => void = () => {};

  constructor(
    private readonly r: Renderer3D,
    readonly myTeam: TeamName,
    arenaId: string,
    placementDelay = 1.0,
  ) {
    this.markers = new PlayMarkers(placementDelay);
    const mine: 0 | 1 = myTeam === 'BLUE' ? 0 : 1;
    this.side = { 0: mine === 0 ? 'own' : 'enemy', 1: mine === 1 ? 'own' : 'enemy' };
    const theme = themeFor(arenaId);
    this.arena = new ArenaBuilder(theme, r.quality, myTeam === 'BLUE' ? 1 : -1, r.tier);
    this.fx = new Effects(r.quality);
    this.world.add(this.arena.root, this.fx.root, this.bars.root, this.markers.root, this.blobs.mesh, this.rings.mesh);
    r.scene.add(this.world);
    r.scene.background = skyTexture(theme.sky, theme.skyHorizon);
    // fog only far beyond the field: the top of the screen (enemy side) stays crisp
    r.scene.fog = new THREE.Fog(theme.fog, r.cameraDistance * 2.6, r.cameraDistance * 6);
    r.hemi.color.setHex(theme.hemiSky);
    r.hemi.groundColor.setHex(theme.hemiGround);
    r.hemi.intensity = 0.85;
    r.sun.color.setHex(theme.sunColor);
    r.sun.intensity = theme.sunIntensity;
    r.setPerspective(myTeam);
    this.removeUpdater = r.addUpdater((dt) => this.update(dt));
  }

  ingest(s: Snapshot): void {
    if (s.tick <= this.latestTick) return;
    const entities = new Map<number, EntityTuple>();
    for (const e of s.e) entities.set(e[0], e);
    const projectiles = new Map<number, ProjectileTuple>();
    for (const p of s.p) projectiles.set(p[0], p);
    this.snaps.push({ tick: s.tick, entities, projectiles, events: s.ev, processed: false });
    if (this.snaps.length > 30) this.snaps.splice(0, this.snaps.length - 30);
    this.latestTick = s.tick;
    if (this.renderTick < 0) this.renderTick = s.tick - DELAY_TICKS;
  }

  /** Clears interpolation history (used after reconnect so old frames are not replayed). */
  resync(): void {
    this.snaps = [];
    this.latestTick = -1;
    this.renderTick = -1;
  }

  private update(dt: number): void {
    this.time += dt;
    this.arena.update(dt);
    this.fx.update(dt);
    this.markers.update(dt, this.r.camera.quaternion);
    if (this.snaps.length === 0) return;
    // Advance render time at real-time rate, steering towards (latest - delay).
    this.renderTick += dt * 20;
    const target = this.latestTick - DELAY_TICKS;
    const diff = target - this.renderTick;
    if (Math.abs(diff) > 10) this.renderTick = target;
    else this.renderTick += diff * Math.min(1, dt * 2.5);
    if (this.renderTick > this.latestTick) this.renderTick = this.latestTick;

    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i].tick >= this.renderTick) {
        b = this.snaps[i];
        a = i > 0 ? this.snaps[i - 1] : b;
        break;
      }
    }
    // Apply events of every snapshot we have reached.
    for (const s of this.snaps) {
      if (!s.processed && s.tick <= this.renderTick + 1.5) {
        s.processed = true;
        for (const ev of s.events) this.applyEvent(ev);
      }
    }
    const span = b.tick - a.tick;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (this.renderTick - a.tick) / span)) : 1;
    this.syncEntities(a, b, alpha, dt);
    this.syncProjectiles(a, b, alpha, dt);
    // Drop old snapshots
    while (this.snaps.length > 2 && this.snaps[1].tick < this.renderTick - 2) this.snaps.shift();
    this.recentSpells = this.recentSpells.filter((s) => this.time - s.t < 4);
  }

  private syncEntities(a: SnapState, b: SnapState, alpha: number, dt: number): void {
    const cam = this.r.camera;
    this.bars.begin(cam);
    this.blobs.begin();
    this.rings.begin();
    const freshHp = b.tick !== this.hpTick;
    this.hpTick = b.tick;
    for (const [id, eb] of b.entities) {
      const ea = a.entities.get(id) ?? eb;
      const x = ea[5] + (eb[5] - ea[5]) * alpha;
      const y = ea[6] + (eb[6] - ea[6]) * alpha;
      const pos = toWorld(x, y, 0, this.tmp);
      const kind = eb[3];
      const flags = eb[10];
      const side = this.side[eb[2]];
      if (kind === 'K' || kind === 'P') {
        this.syncTower(id, eb, pos, side, flags, dt);
        continue;
      }
      if (kind === 'A') {
        this.syncArea(id, eb, pos, dt);
        continue;
      }
      let v = this.units.get(id);
      if (!v) {
        v = new UnitVisual(visualFor(eb[1], kind, eb[4], eb[12]), side);
        this.units.set(id, v);
        this.spawned[side]++;
        this.world.add(v.root);
        v.root.position.copy(pos);
        v.root.rotation.y = side === 'own' ? (this.myTeam === 'BLUE' ? Math.PI : 0) : this.myTeam === 'BLUE' ? 0 : Math.PI;
        this.unitInfo.set(id, { name: eb[1], lastFlags: flags, lastPos: pos.clone(), speed: 0, kind, lag: eb[8] > 0 ? eb[7] / eb[8] : 1, lastHp: eb[7] + eb[9], acc: 0, lastEmit: 0, lastHit: -99 });
        this.markers.unitAppeared(side, pos.x, pos.z);
        if (flags & F.DEPLOYING || kind === 'B') {
          v.spawn();
          this.fx.deploySplash(pos.x, pos.z, Math.max(0.6, eb[12] / 1000), TEAM_COLORS[side]);
          this.fx.deployBeam(pos.x, pos.z, Math.max(0.55, (eb[12] / 1000) * 1.2), TEAM_COLORS[side]);
        }
      }
      const info = this.unitInfo.get(id)!;
      const moved = this.tmp2.copy(pos).sub(info.lastPos);
      moved.y = 0;
      const instSpeed = dt > 0 ? moved.length() / dt : 0;
      info.speed += (instSpeed - info.speed) * Math.min(1, dt * 6);
      info.lastPos.copy(pos);
      // flying height and special states
      const flying = eb[4] === 1;
      let yOff = flying ? 2.0 : 0;
      if (flags & F.ATTACHED) yOff += v.flying ? 0 : 1.1;
      if (flags & F.JUMPING) yOff += 0.8;
      if (flags & F.TUNNELING) {
        v.root.visible = true;
        v.body.visible = false;
        if (Math.random() < dt * 20) this.fx.dust(pos.x, pos.z, 1, 0x8a6a4a);
      } else {
        v.body.visible = true;
      }
      if (flags & F.HIDDEN_BUILDING) yOff -= v.height * 0.85;
      v.root.position.set(pos.x, yOff, pos.z);
      if (!(flags & F.TUNNELING)) {
        const foot = Math.max(0.8, (eb[12] / 1000) * (kind === 'B' ? 2.4 : 2.2)) * (flying ? 0.75 : 1);
        this.blobs.add(pos.x, pos.z, foot);
        if (kind !== 'B') this.rings.add(pos.x, pos.z, foot * 0.95, TEAM_COLORS[side]);
      }
      // facing
      const targetId = eb[11];
      const targetPos = targetId ? this.positionOf(targetId, b) : null;
      let desired: number | null = null;
      if (targetPos && (flags & F.ATTACKING || instSpeed < 0.3)) {
        desired = Math.atan2(targetPos.x - pos.x, targetPos.z - pos.z);
      } else if (instSpeed > 0.2) {
        desired = Math.atan2(moved.x, moved.z);
      }
      if (desired !== null && kind !== 'B') {
        v.root.rotation.y = lerpAngle(v.root.rotation.y, desired, Math.min(1, dt * 10));
      }
      if (kind === 'B' && targetPos) v.aim(targetPos);
      // attack start
      if (flags & F.ATTACKING && !(info.lastFlags & F.ATTACKING)) {
        v.startAttack(cards.hitSpeed(eb[1]) * 0.9);
      }
      info.lastFlags = flags;
      // status
      v.setStatus(!!(flags & F.FROZEN), !!(flags & F.STUNNED), !!(flags & F.RAGED), !!(flags & (F.POISONED | F.CURSED)), !!(flags & F.SLOWED));
      if (flags & F.INVISIBLE) v.setOpacity(0.4);
      if (flags & F.RAGED && Math.random() < dt * 8) this.fx.emitAura(pos.x, 0.3, pos.z, 0xc050ff);
      v.update(dt, flags & F.DEPLOYING ? 0 : info.speed, { frozen: !!(flags & (F.FROZEN | F.STUNNED)) });
      // health bar
      const hp = eb[7];
      const max = eb[8];
      const shield = eb[9];
      // Damage numbers: compare health (+shield) once per new snapshot, sum hits over 0.2 s.
      if (freshHp) {
        const now = hp + shield;
        const diff = info.lastHp - now;
        info.lastHp = now;
        // buildings lose a little health every tick by design: ignore that decay
        const threshold = kind === 'B' ? Math.max(8, max * 0.02) : 0;
        if (diff > threshold || diff < -2) {
          info.acc += diff;
          if (diff > 0) {
            v.hitFlash();
            info.lastHit = this.time;
          }
        }
      }
      if (info.acc !== 0 && this.time - info.lastEmit >= 0.2) {
        this.tmp2.set(pos.x, yOff + v.height + 0.9, pos.z);
        const sp = this.r.project(this.tmp2);
        this.onDamage(sp.x, sp.y, info.acc, side, info.acc >= 400);
        info.acc = 0;
        info.lastEmit = this.time;
      }
      // Troops show their health for a few seconds after being hit; buildings always do.
      const ratio = max > 0 ? hp / max : 0;
      if (ratio > info.lag) info.lag = ratio;
      else info.lag = Math.max(ratio, info.lag - dt * 0.6);
      const showBar = kind === 'B' || this.time - info.lastHit < HP_BAR_SECONDS;
      if (showBar && !(flags & F.TUNNELING) && !(flags & F.HIDDEN_BUILDING) && max > 10) {
        const w = kind === 'B' ? 1.9 : Math.max(1.05, Math.min(2.2, 0.9 + (eb[12] / 1000) * 0.9 + (max > 2500 ? 0.4 : 0)));
        this.tmp2.set(pos.x, yOff + v.height + 0.5, pos.z);
        this.bars.add(this.tmp2, w, ratio, TEAM_COLORS[side], shield > 0 ? 1 : 0, info.lag, 0.24);
      }
    }
    // Removals
    for (const [id, v] of this.units) {
      if (b.entities.has(id)) continue;
      this.units.delete(id);
      const info = this.unitInfo.get(id);
      this.unitInfo.delete(id);
      if (this.diedIds.has(id) && info?.kind !== 'B') {
        v.die();
        this.dying.add(v);
      } else {
        if (this.diedIds.has(id)) this.fx.explosion(v.root.position.x, v.root.position.z, 1.2, 0xa08060);
        v.dispose();
      }
    }
    for (const v of this.dying) {
      if (!v.update(dt, 0, { frozen: false })) {
        v.dispose();
        this.dying.delete(v);
      }
    }
    for (const [id, area] of this.areas) {
      if (!b.entities.has(id)) {
        area.dispose();
        this.areas.delete(id);
      }
    }
    for (const [id, tw] of this.towers) {
      if (!b.entities.has(id) && !tw.destroyed) {
        tw.destroy();
        const d = this.towerData.get(id);
        if (d) {
          d.hp = 0;
          d.alive = false;
        }
      }
      tw.update(dt, false);
    }
    this.bars.end();
    this.blobs.end(!this.r.realShadows);
    this.rings.end();
  }

  private syncTower(id: number, e: EntityTuple, pos: THREE.Vector3, side: Side, flags: number, dt: number): void {
    let tw = this.towers.get(id);
    const kind = e[3] as 'K' | 'P';
    if (tw?.destroyed) {
      // The 'die' event can be applied while the interpolation snapshot still holds the tower:
      // never resurrect it with its last (non-zero) hit points.
      const d = this.towerData.get(id);
      if (d) {
        d.hp = 0;
        d.alive = false;
      }
      return;
    }
    if (!tw) {
      tw = new TowerVisual(kind, side);
      tw.root.position.copy(pos);
      // towers face the river
      tw.root.rotation.y = e[6] < 16000 ? Math.PI : 0;
      this.world.add(tw.root);
      this.towers.set(id, tw);
      tw.setActive(!(flags & F.INACTIVE_TOWER));
    }
    if (tw.setActive(!(flags & F.INACTIVE_TOWER))) {
      audio.play('kingWake');
      this.fx.sparks(pos.x, tw.height + 1, pos.z, 0xffd040, 20);
    }
    const prev = this.towerData.get(id);
    if (prev && e[7] !== prev.hp) {
      const d = this.towerDmg.get(id) ?? { acc: 0, last: 0 };
      d.acc += prev.hp - e[7];
      this.towerDmg.set(id, d);
    }
    const td = this.towerDmg.get(id);
    if (td && td.acc !== 0 && this.time - td.last >= 0.2) {
      // start just above the tower's health bar (which is anchored at height + 0.9)
      this.tmp2.set(pos.x, tw.height + 0.9, pos.z);
      const sp = this.r.project(this.tmp2);
      this.onDamage(sp.x, sp.y - 26, td.acc, side, true);
      td.acc = 0;
      td.last = this.time;
    }
    if (flags & F.ATTACKING && !(prev && prev.flags & F.ATTACKING)) {
      tw.top.startAttack(kind === 'K' ? 1.0 : 0.8);
    }
    const targetId = e[11];
    if (targetId) {
      const tp = this.unitsWorldPos(targetId);
      if (tp) tw.face(tp);
    }
    this.towerData.set(id, {
      id,
      side,
      kind,
      hp: e[7],
      max: e[8],
      wx: pos.x,
      wy: tw.height + 0.9,
      wz: pos.z,
      alive: true,
      flags,
    });
    void dt;
  }

  private syncArea(id: number, e: EntityTuple, pos: THREE.Vector3, dt: number): void {
    let area = this.areas.get(id);
    const spec = visualFor(e[1], 'A', 0, e[12]) as AreaSpec;
    if (!area) {
      area = this.fx.createArea(spec, Math.max(0.5, e[12] / 1000));
      this.world.add(area.root);
      this.areas.set(id, area);
      if (spec.style === 'bolt') {
        for (let i = 0; i < 3; i++) setTimeout(() => this.fx.lightningBolt(pos.x + (Math.random() - 0.5) * 2, pos.z + (Math.random() - 0.5) * 2), i * 220);
      }
    }
    area.root.position.set(pos.x, 0, pos.z);
    area.setRadius(Math.max(0.5, e[12] / 1000));
    area.update(dt, e[13]);
  }

  private syncProjectiles(a: SnapState, b: SnapState, alpha: number, dt: number): void {
    for (const [id, pb] of b.projectiles) {
      const pa = a.projectiles.get(id) ?? pb;
      const x = pa[2] + (pb[2] - pa[2]) * alpha;
      const y = pa[3] + (pb[3] - pa[3]) * alpha;
      const pos = toWorld(x, y, 0, this.tmp);
      let st = this.projectiles.get(id);
      if (!st) {
        const key = pb[8];
        const { obj, arc } = this.fx.acquireProjectile(key);
        const srcTower = this.towers.get(pb[6]);
        const baseY = srcTower ? srcTower.height + 0.4 : this.units.get(pb[6])?.flying ? 2.4 : 0.9;
        const spellFromSky = pb[6] === 0;
        st = { obj, origin: pos.clone(), arc, baseY: spellFromSky ? 1.5 : baseY, last: pos.clone(), key };
        this.projectiles.set(id, st);
        obj.position.set(pos.x, st.baseY, pos.z);
      }
      const target = toWorld(pb[4], pb[5], 0, this.tmp2);
      const total = Math.max(0.01, st.origin.distanceTo(target) + 0.0001);
      const travelled = Math.min(total, st.origin.distanceTo(pos));
      const p = travelled / total;
      const h = st.baseY * (1 - p) + 0.4 * p + st.arc * total * 4 * p * (1 - p);
      const prev = st.obj.position.clone();
      st.obj.position.set(pos.x, h, pos.z);
      const dir = st.obj.position.clone().sub(prev);
      if (st.obj.userData.volley) {
        this.fx.layoutVolley(st.obj, p, Math.max(1, Math.max(pb[7], cards.get(st.key)?.spell?.radius ?? 0) / 1000), dir);
      } else if (dir.lengthSq() > 1e-6) {
        if (st.obj.userData.roll) {
          st.obj.rotation.y = Math.atan2(dir.x, dir.z);
          st.obj.children[0].rotation.x += dir.length() * 1.5;
        } else {
          st.obj.lookAt(st.obj.position.clone().add(dir));
        }
      }
      if (st.obj.userData.spin) st.obj.rotateX((st.obj.userData.spin as number) * dt);
      this.fx.trail(st.obj);
      st.last.copy(pos);
    }
    for (const [id, st] of this.projectiles) {
      if (b.projectiles.has(id)) continue;
      this.projectiles.delete(id);
      if (st.key === 'ElectroWizard' || st.key === 'ZapMachine' || st.key === 'MiniZapMachine' || st.key === 'ElectroDragon' || st.key === 'ElectroSpirit') {
        this.fx.impact(st.obj.position.x, st.obj.position.y, st.obj.position.z, 0x9fe0ff, 1.0);
      } else {
        this.fx.impact(st.obj.position.x, st.obj.position.y, st.obj.position.z, 0xffe0a0, 0.8);
      }
      this.fx.releaseProjectile(st.obj);
    }
  }

  private positionOf(id: number, s: SnapState): THREE.Vector3 | null {
    const e = s.entities.get(id);
    if (!e) return null;
    const p = toWorld(e[5], e[6]);
    const v = this.units.get(id);
    if (v) p.y = v.root.position.y + v.height * 0.5;
    return p;
  }

  private unitsWorldPos(id: number): THREE.Vector3 | null {
    const v = this.units.get(id);
    if (v) return v.root.position.clone();
    const tw = this.towers.get(id);
    return tw ? tw.root.position.clone() : null;
  }

  private pan(x: number): number {
    return (x / 9) * (this.myTeam === 'BLUE' ? 1 : -1) * 0.6;
  }

  private applyEvent(ev: GameEvent): void {
    switch (ev[0]) {
      case 'play': {
        const [, team, cardId, gx, gy] = ev;
        const p = toWorld(gx, gy);
        const card = cards.get(cardId);
        const side = this.side[team];
        if (card) this.markers.add(card, p.x, p.z, side, false);
        if (card?.type === 'SPELL') {
          audio.play(SFX_FOR_SPELL[cardId] ?? 'magic', { pan: this.pan(p.x) });
          this.recentSpells.push({ card: cardId, x: p.x, z: p.z, t: this.time });
        } else {
          audio.play(card && card.cost >= 6 ? 'deployHeavy' : 'deploy', { pan: this.pan(p.x) });
        }
        if (side === 'enemy' && card) {
          this.onOpponentPlay(cardId);
        }
        break;
      }
      case 'aoe': {
        const [, gx, gy, radius] = ev;
        const p = toWorld(gx, gy);
        const r = Math.max(0.6, radius / 1000);
        const spell = this.recentSpells.find((s) => Math.hypot(s.x - p.x, s.z - p.z) < r + 2.5);
        const card = spell?.card;
        if (card === 'zap' || card === 'lightning') {
          this.fx.shockwave(p.x, p.z, r, 0x9fe0ff);
          for (let i = 0; i < 4; i++) this.fx.zapArc(new THREE.Vector3(p.x, 3, p.z), new THREE.Vector3(p.x + (Math.random() - 0.5) * r * 2, 0.2, p.z + (Math.random() - 0.5) * r * 2));
        } else if (card === 'snowball' || card === 'freeze') {
          this.fx.explosion(p.x, p.z, r, 0xdff4ff);
          audio.play('freeze', { pan: this.pan(p.x), volume: 0.7 });
        } else if (card === 'arrows') {
          this.fx.volleyImpact(p.x, p.z, r);
          audio.play('arrowHit', { pan: this.pan(p.x) });
        } else if (card === 'log' || card === 'barblog' || card === 'earthquake') {
          this.fx.dust(p.x, p.z, 18);
          this.fx.shockwave(p.x, p.z, r, 0xd8c8a0);
          audio.play('arrowHit', { pan: this.pan(p.x) });
        } else if (card === 'poison' || card === 'goblincurse') {
          this.fx.shockwave(p.x, p.z, r, 0x8adf3a);
        } else {
          const big = r >= 2.5 || card === 'rocket' || card === 'fireball';
          this.fx.explosion(p.x, p.z, r, 0xffa040, big);
          audio.play(big ? 'bigExplosion' : 'explosion', { pan: this.pan(p.x), volume: big ? 1 : 0.7 });
          if (big) this.r.kick(0.25);
        }
        break;
      }
      case 'hit': {
        const [, attackerId, targetId] = ev;
        const info = this.unitInfo.get(attackerId);
        const tower = this.towers.get(attackerId);
        const targetPos = this.unitsWorldPos(targetId);
        if (tower) {
          audio.play(tower.kind === 'K' ? 'cannon' : 'arrow', { pan: this.pan(tower.root.position.x), volume: 0.45 });
          break;
        }
        if (!info) break;
        const name = info.name;
        if (cards.isMelee(name)) {
          if (targetPos) {
            const y = this.towers.has(targetId) ? 1.6 : 0.9;
            this.fx.impact(targetPos.x, y, targetPos.z, 0xfff2c0, 1.1);
            this.fx.slash(targetPos.x, y, targetPos.z, 1.3);
            if (this.towers.has(targetId)) audio.play('towerHit', { pan: this.pan(targetPos.x), volume: 0.6 });
          }
          audio.play(meleeSound(name), { pan: this.pan(info.lastPos.x), volume: 0.6 });
        } else {
          audio.play(rangedSound(name), { pan: this.pan(info.lastPos.x), volume: 0.5 });
          const src = this.units.get(attackerId);
          if (src && targetPos && /Electro|Zap|ElectroSpirit/.test(name)) {
            this.fx.zapArc(src.root.position.clone().setY(src.root.position.y + src.height * 0.7), targetPos.clone().setY(targetPos.y + 0.8));
          }
          if (name === 'InfernoDragon' || name === 'InfernoTower') audio.play('inferno', { volume: 0.3 });
        }
        break;
      }
      case 'die': {
        const [, id, name, gx, gy, team, towerKind] = ev;
        this.diedIds.add(id);
        const p = toWorld(gx, gy);
        if (towerKind) {
          const side = this.side[team];
          this.fx.towerCollapse(p.x, p.z);
          audio.play('towerDestroyed');
          audio.play('crown', { volume: 0.8 });
          this.r.kick(0.5);
          const tw = this.towers.get(id);
          tw?.destroy();
          const d = this.towerData.get(id);
          if (d) {
            d.hp = 0;
            d.alive = false;
          }
          this.onTowerDestroyed(side, towerKind);
        } else {
          const skel = /Skeleton|Ghost|Bomber|Wallbreaker/.test(name);
          const isBuilding = this.unitInfo.get(id)?.kind === 'B';
          audio.play(isBuilding ? 'buildingDeath' : skel ? 'skeletonDeath' : 'death', { pan: this.pan(p.x), volume: 0.5 });
          this.fx.dust(p.x, p.z, isBuilding ? 30 : 8);
          if (!isBuilding) {
            const v = this.units.get(id);
            this.fx.deathPoof(p.x, v ? v.root.position.y : 0, p.z, v ? Math.min(1.6, 0.7 + v.height * 0.25) : 1);
          }
        }
        break;
      }
      case 'phase':
        this.onPhase(ev[1]);
        break;
    }
  }

  /**
   * Builds every deck unit once (both team colours) and compiles their shaders while the intro is
   * on screen, so the first time a card is played the frame does not stall on model cloning and
   * shader compilation (a visible hitch on phones).
   */
  prewarm(deck: string[]): void {
    const tmp: UnitVisual[] = [];
    for (const id of deck) {
      const card = cards.get(id);
      const u = card?.unit;
      if (!card || !u) continue;
      const kind = card.type === 'BUILDING' ? 'B' : 'T';
      const movement = card.tags.includes('flying') ? 1 : kind === 'B' ? 2 : 0;
      for (const side of ['own', 'enemy'] as Side[]) {
        try {
          const v = new UnitVisual(visualFor(u.name, kind, movement, u.radius), side);
          v.root.position.set(0, -40, 0);
          this.world.add(v.root);
          tmp.push(v);
        } catch {
          // a model that fails here fails visibly later too; never block the battle
        }
      }
    }
    try {
      this.r.renderer.compile(this.r.scene, this.r.camera);
    } catch {
      // compile is an optimisation only
    }
    // keep them one rendered frame (uploads textures/buffers), then drop them
    window.setTimeout(() => {
      for (const v of tmp) v.dispose();
    }, 250);
  }

  /** Tower labels in screen space for the HUD. */
  /** Shows this player's own play immediately, before the server echoes it. */
  markLocalPlay(cardId: string, gx: number, gy: number): void {
    const card = cards.get(cardId);
    if (!card) return;
    const p = toWorld(gx, gy);
    this.markers.add(card, p.x, p.z, 'own', true);
  }

  cancelLocalPlay(cardId: string): void {
    this.markers.cancelLocal(cardId);
  }

  towerLabels(): (TowerLabel & { sx: number; sy: number })[] {
    const out: (TowerLabel & { sx: number; sy: number })[] = [];
    for (const d of this.towerData.values()) {
      const s = this.r.project(new THREE.Vector3(d.wx, d.wy, d.wz));
      out.push({ ...d, sx: s.x, sy: s.y });
    }
    return out;
  }

  /** Whether a tower (by lane/side) is still standing; used for pocket deployment zones. */
  princessAlive(side: Side, leftGameLane: boolean): boolean {
    for (const d of this.towerData.values()) {
      if (d.side !== side || d.kind !== 'P') continue;
      const isLeft = d.wx < 0;
      if (isLeft === leftGameLane) return d.alive;
    }
    return true;
  }

  stats(): { units: number; projectiles: number; areas: number; spawnedOwn: number; spawnedEnemy: number } {
    return { units: this.units.size, projectiles: this.projectiles.size, areas: this.areas.size, spawnedOwn: this.spawned.own, spawnedEnemy: this.spawned.enemy };
  }

  dispose(): void {
    this.removeUpdater();
    for (const v of this.units.values()) v.dispose();
    for (const v of this.dying) v.dispose();
    for (const t of this.towers.values()) t.dispose();
    for (const a of this.areas.values()) a.dispose();
    for (const p of this.projectiles.values()) this.fx.releaseProjectile(p.obj);
    this.units.clear();
    this.towers.clear();
    this.areas.clear();
    this.projectiles.clear();
    this.fx.clear();
    this.markers.dispose();
    this.blobs.dispose();
    this.arena.dispose();
    this.world.removeFromParent();
    const bg = this.r.scene.background as THREE.Texture | null;
    bg?.dispose?.();
    this.r.scene.background = null;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function meleeSound(name: string): SfxName {
  if (/Barbarian|Valkyrie|AxeMan|Lumber|RageBarbarian|Berserker|Miner/.test(name)) return 'axe';
  if (/Giant|Golem|Rascal|Brawler|Ram|Hog/.test(name)) return 'punch';
  if (/Minion|Bat|Dragon|Hound|Pup/.test(name)) return 'bite';
  return 'sword';
}

function rangedSound(name: string): SfxName {
  if (/Wizard|Witch|Spirit|Merge|Dragon|Hound|Minion/.test(name)) return name.includes('Electro') ? 'zapShot' : 'magic';
  if (/Zap|Electro/.test(name)) return 'zapShot';
  if (/Cannon|RoyalGiant|Mortar|Bowler|Machine/.test(name)) return 'cannon';
  return 'arrow';
}

function skyTexture(top: number, bottom: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
