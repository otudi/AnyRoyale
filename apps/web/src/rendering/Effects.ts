import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { centeredClone } from './ArenaBuilder';
import { PROJECTILES, type AreaSpec, type ProjectileLook } from './visualCatalog';

// ------------------------------------------------------------------------------------------------
// Particles: one THREE.Points per blending mode, fixed-capacity ring buffer, one draw call each.
// ------------------------------------------------------------------------------------------------

const VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

interface Particle {
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  a0: number;
}

class ParticleField {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private parts: Particle[];
  private next = 0;

  constructor(private readonly capacity: number, additive: boolean) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.parts = Array.from({ length: capacity }, () => ({
      life: 0, max: 0, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, size0: 0, size1: 0, r: 1, g: 1, b: 1, a0: 1,
    }));
  }

  emit(x: number, y: number, z: number, o: Partial<Particle> & { color: number; spread?: number; up?: number; speed?: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const p = this.parts[i];
    const speed = o.speed ?? 1;
    const spread = o.spread ?? 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;
    p.vx = o.vx ?? Math.cos(a) * r * speed;
    p.vz = o.vz ?? Math.sin(a) * r * speed;
    p.vy = o.vy ?? (o.up ?? 1) * (0.5 + Math.random()) * speed;
    p.gravity = o.gravity ?? 2;
    p.drag = o.drag ?? 1.5;
    p.max = p.life = o.max ?? 0.8;
    p.size0 = o.size0 ?? 0.6;
    p.size1 = o.size1 ?? 0.1;
    const c = new THREE.Color(o.color);
    p.r = c.r;
    p.g = c.g;
    p.b = c.b;
    p.a0 = o.a0 ?? 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (p.life <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      p.life -= dt;
      const k = 1 - p.life / p.max;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp - p.gravity * dt;
      this.pos[i * 3] += p.vx * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + p.vy * dt);
      this.pos[i * 3 + 2] += p.vz * dt;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a0 * (1 - k);
      this.size[i] = p.size0 + (p.size1 - p.size0) * k;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.parts) p.life = 0;
  }
}

// ------------------------------------------------------------------------------------------------

interface Transient {
  obj: THREE.Object3D;
  life: number;
  max: number;
  update: (k: number, dt: number) => void;
  pool?: THREE.Object3D[];
}

/** Visual effects not tied to a single unit: explosions, spell areas, projectiles, bolts. */
export class Effects {
  readonly root = new THREE.Group();
  private additive: ParticleField;
  private smoke: ParticleField;
  private transients: Transient[] = [];
  private ringPool: THREE.Mesh[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private discGeo = new THREE.CircleGeometry(1, 40);
  private projMeshes = new Map<ProjectileLook, THREE.Object3D>();
  private projPool = new Map<ProjectileLook, THREE.Object3D[]>();

  constructor(quality: 'high' | 'low') {
    this.additive = new ParticleField(quality === 'high' ? 1600 : 700, true);
    this.smoke = new ParticleField(quality === 'high' ? 800 : 350, false);
    this.root.add(this.additive.points, this.smoke.points);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo.rotateX(-Math.PI / 2);
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.smoke.update(dt);
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.life -= dt;
      const k = 1 - Math.max(0, t.life) / t.max;
      t.update(k, dt);
      if (t.life <= 0) {
        t.obj.visible = false;
        t.obj.removeFromParent();
        t.pool?.push(t.obj);
        this.transients.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.additive.clear();
    this.smoke.clear();
    for (const t of this.transients) t.obj.removeFromParent();
    this.transients = [];
  }

  private ring(color: number): THREE.Mesh {
    const m = this.ringPool.pop() ?? new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    this.root.add(m);
    return m;
  }

  shockwave(x: number, z: number, radius: number, color = 0xffd080, duration = 0.45): void {
    const m = this.ring(color);
    m.position.set(x, 0.08, z);
    this.transients.push({
      obj: m,
      life: duration,
      max: duration,
      pool: this.ringPool as THREE.Object3D[],
      update: (k) => {
        m.scale.setScalar(0.2 + radius * easeOut(k));
        (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      },
    });
  }

  explosion(x: number, z: number, radius: number, color = 0xffa040, big = false): void {
    const n = Math.min(70, Math.round(14 + radius * 18));
    for (let i = 0; i < n; i++) {
      this.additive.emit(x, 0.3, z, { color: i % 3 === 0 ? 0xfff0a0 : color, spread: 1, speed: 2.5 + radius * 2, up: 1.6, gravity: 3, max: 0.5 + Math.random() * 0.3, size0: big ? 1.3 : 0.8, size1: 0.1 });
    }
    for (let i = 0; i < n / 2; i++) {
      this.smoke.emit(x, 0.3, z, { color: 0x5a524a, spread: 1, speed: 1.2 + radius, up: 0.8, gravity: -0.4, max: 1.2, size0: 0.8, size1: 1.8, a0: 0.55, drag: 2 });
    }
    this.shockwave(x, z, radius, 0xffc870);
    this.flash(x, z, radius * 1.2, color);
  }

  flash(x: number, z: number, radius: number, color: number): void {
    const m = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(x, 0.06, z);
    this.root.add(m);
    this.transients.push({
      obj: m,
      life: 0.3,
      max: 0.3,
      update: (k) => {
        m.scale.setScalar(radius * (0.5 + k * 0.6));
        (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
        if (k >= 1) (m.material as THREE.Material).dispose();
      },
    });
  }

  dust(x: number, z: number, amount = 10, color = 0xc8b090): void {
    for (let i = 0; i < amount; i++) {
      this.smoke.emit(x, 0.15, z, { color, spread: 1, speed: 1.5, up: 0.4, gravity: 0.2, max: 0.7, size0: 0.5, size1: 1.0, a0: 0.6, drag: 3 });
    }
  }

  sparks(x: number, y: number, z: number, color = 0xffe080, amount = 8): void {
    for (let i = 0; i < amount; i++) {
      this.additive.emit(x, y, z, { color, spread: 1, speed: 3, up: 1, gravity: 6, max: 0.35, size0: 0.35, size1: 0.05 });
    }
  }

  deploySplash(x: number, z: number, radius: number, color: number): void {
    this.shockwave(x, z, radius + 0.5, color, 0.5);
    this.dust(x, z, 12);
    for (let i = 0; i < 12; i++) {
      this.additive.emit(x, 0.2, z, { color, spread: 1, speed: 1.6, up: 2, gravity: 1, max: 0.6, size0: 0.4, size1: 0.05 });
    }
  }

  towerCollapse(x: number, z: number): void {
    this.explosion(x, z, 2.6, 0xffa040, true);
    for (let i = 0; i < 60; i++) {
      this.smoke.emit(x + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 2, z + (Math.random() - 0.5) * 2, {
        color: 0x7a7066, spread: 1, speed: 1.5, up: 1.2, gravity: -0.2, max: 2.2, size0: 1.2, size1: 2.6, a0: 0.6, drag: 1.5,
      });
    }
  }

  lightningBolt(x: number, z: number, color = 0xcfe8ff): void {
    const pts: THREE.Vector3[] = [];
    let cx = x;
    let cz = z;
    for (let y = 14; y >= 0; y -= 1.4) {
      pts.push(new THREE.Vector3(cx, y, cz));
      cx = x + (Math.random() - 0.5) * 0.9;
      cz = z + (Math.random() - 0.5) * 0.9;
    }
    pts.push(new THREE.Vector3(x, 0, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, linewidth: 2 }));
    this.root.add(line);
    this.transients.push({
      obj: line,
      life: 0.35,
      max: 0.35,
      update: (k) => {
        (line.material as THREE.LineBasicMaterial).opacity = 1 - k;
        if (k >= 1) {
          geo.dispose();
          (line.material as THREE.Material).dispose();
        }
      },
    });
    this.flash(x, z, 1.4, 0x9fd0ff);
    this.sparks(x, 0.3, z, 0xcfe8ff, 14);
  }

  /** Short electric arc between two points (zap attacks, Electro Wizard, chain lightning). */
  zapArc(a: THREE.Vector3, b: THREE.Vector3, color = 0x9fe0ff): void {
    const pts: THREE.Vector3[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const p = a.clone().lerp(b, i / steps);
      if (i > 0 && i < steps) {
        p.x += (Math.random() - 0.5) * 0.4;
        p.y += (Math.random() - 0.5) * 0.4;
        p.z += (Math.random() - 0.5) * 0.4;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.root.add(line);
    this.transients.push({
      obj: line,
      life: 0.18,
      max: 0.18,
      update: (k) => {
        (line.material as THREE.LineBasicMaterial).opacity = 1 - k;
        if (k >= 1) {
          geo.dispose();
          (line.material as THREE.Material).dispose();
        }
      },
    });
    this.sparks(b.x, b.y, b.z, color, 5);
  }

  /** Floating text (card name of the opponent's play, "+1 crown"...). Uses a canvas sprite. */
  label(text: string, x: number, z: number, color = '#ffffff', y = 2.4): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, 128, 32);
    g.fillStyle = color;
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(3.2, 0.8, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 20;
    this.root.add(sprite);
    this.transients.push({
      obj: sprite,
      life: 1.4,
      max: 1.4,
      update: (k) => {
        sprite.position.y = y + k * 0.8;
        (sprite.material as THREE.SpriteMaterial).opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        if (k >= 1) {
          tex.dispose();
          sprite.material.dispose();
        }
      },
    });
  }

  emitAura(x: number, y: number, z: number, color: number): void {
    this.additive.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, {
      color, vx: 0, vz: 0, vy: 0.8, gravity: 0, drag: 0, max: 0.6, size0: 0.35, size1: 0.05, a0: 0.8,
    });
  }

  // ----------------------------------------------------------------------------------------------
  // Projectiles
  // ----------------------------------------------------------------------------------------------

  private makeProjectile(look: ProjectileLook, color?: number): THREE.Object3D {
    const g = new THREE.Group();
    const std = (c: number, e = 0) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: e ? 1.2 : 0, roughness: 0.5 });
    const add = (m: THREE.Object3D) => {
      g.add(m);
      return m;
    };
    switch (look) {
      case 'arrow':
      case 'bolt':
      case 'spear':
      case 'dart': {
        const src = assets.node('weapons.glb', 'arrow');
        if (src && look === 'arrow') {
          const a = centeredClone(src);
          a.position.y = 0;
          const box = new THREE.Box3().setFromObject(a);
          const len = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
          a.scale.setScalar(0.9 / len);
          // the arrow model points along +Y; aim it along +Z
          a.rotation.x = Math.PI / 2;
          add(a);
          if (color) add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), std(color, color))).position.z = 0.4;
        } else {
          const len = look === 'bolt' ? 1.2 : look === 'spear' ? 0.9 : 0.5;
          const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), std(look === 'dart' ? 0x6a8a3a : 0x8a6a3a)));
          shaft.rotation.x = Math.PI / 2;
          const tip = add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), std(0xcccccc)));
          tip.rotation.x = Math.PI / 2;
          tip.position.z = len / 2;
        }
        break;
      }
      case 'bullet':
        add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), std(0xffe0a0, 0xffa040)));
        break;
      case 'fireball':
      case 'bigfireball':
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(look === 'bigfireball' ? 0.55 : 0.22, 1), std(color ?? 0xff8a20, color ?? 0xff5000)));
        g.userData.trail = color ?? 0xff7a20;
        break;
      case 'iceball':
      case 'snowball':
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(look === 'snowball' ? 0.4 : 0.2, 1), std(0xe0f6ff, 0x60b0ff)));
        g.userData.trail = 0xbfe8ff;
        break;
      case 'magic':
      case 'darkorb':
      case 'healorb':
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), std(color ?? (look === 'healorb' ? 0xffe066 : 0x8040c0), color ?? (look === 'healorb' ? 0xffc020 : 0x6020a0))));
        g.userData.trail = color ?? 0xb070ff;
        break;
      case 'zapbeam':
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), std(0xbfeaff, 0x40a0ff)));
        g.userData.trail = 0x9fe0ff;
        break;
      case 'cannonball':
      case 'stone':
        add(new THREE.Mesh(new THREE.SphereGeometry(look === 'stone' ? 0.12 : 0.22, 10, 8), std(0x2a2a2a)));
        break;
      case 'boulder': {
        const src = assets.node('env_core.glb', 'boulder');
        if (src) {
          const b = centeredClone(src);
          b.scale.setScalar(0.7);
          add(b);
        } else add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), std(0x8a8070)));
        break;
      }
      case 'bomb':
        add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), std(0x222222)));
        add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), std(0xffd040, 0xff8020))).position.y = 0.24;
        break;
      case 'axe': {
        const src = assets.node('weapons.glb', 'axe');
        if (src) {
          const a = centeredClone(src);
          a.scale.setScalar(0.6);
          add(a);
        } else add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), std(0x999999)));
        g.userData.spin = 18;
        break;
      }
      case 'rocket': {
        const body = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.8, 8), std(0xc84030)));
        body.rotation.x = Math.PI / 2;
        g.userData.trail = 0xffa040;
        break;
      }
      case 'barrel': {
        const src = assets.node('props_dungeon.glb', 'barrel');
        if (src) {
          const b = centeredClone(src);
          const box = new THREE.Box3().setFromObject(b);
          b.scale.setScalar(0.8 / Math.max(0.01, box.max.y - box.min.y));
          add(b);
        } else add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), std(0x8a5a30)));
        g.userData.spin = 8;
        break;
      }
      case 'log': {
        const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.6, 12), std(0x8a5a30)));
        l.rotation.z = Math.PI / 2;
        g.userData.roll = true;
        break;
      }
      case 'firework':
        add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), std(0xff6040, 0xff3020)));
        g.userData.trail = 0xffd040;
        break;
    }
    g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : null));
    return g;
  }

  acquireProjectile(key: string): { obj: THREE.Object3D; look: ProjectileLook; arc: number } {
    const def = PROJECTILES[key] ?? { look: 'bullet' as ProjectileLook, arc: 0.1 };
    const poolKey = (def.look + (def.color ?? '')) as ProjectileLook;
    const pool = this.projPool.get(poolKey) ?? [];
    this.projPool.set(poolKey, pool);
    let obj = pool.pop();
    if (!obj) {
      let tpl = this.projMeshes.get(poolKey);
      if (!tpl) {
        tpl = this.makeProjectile(def.look, def.color);
        this.projMeshes.set(poolKey, tpl);
      }
      obj = tpl.clone();
      obj.userData = { ...tpl.userData, poolKey };
    }
    obj.visible = true;
    this.root.add(obj);
    return { obj, look: def.look, arc: def.arc };
  }

  releaseProjectile(obj: THREE.Object3D): void {
    obj.visible = false;
    obj.removeFromParent();
    const key = obj.userData.poolKey as ProjectileLook;
    (this.projPool.get(key) ?? this.projPool.set(key, []).get(key)!).push(obj);
  }

  trail(obj: THREE.Object3D): void {
    const c = obj.userData.trail as number | undefined;
    if (c) {
      this.additive.emit(obj.position.x, obj.position.y, obj.position.z, {
        color: c, vx: 0, vy: 0.2, vz: 0, gravity: 0, drag: 0, max: 0.35, size0: 0.45, size1: 0.05, a0: 0.8,
      });
    }
  }

  // ----------------------------------------------------------------------------------------------
  // Area effects (spell zones)
  // ----------------------------------------------------------------------------------------------

  createArea(spec: AreaSpec, radiusTiles: number): AreaVisual {
    return new AreaVisual(spec, radiusTiles, this);
  }

  areaParticles(x: number, z: number, radius: number, spec: AreaSpec): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    switch (spec.style) {
      case 'dome':
        this.additive.emit(px, 0.2 + Math.random() * 1.5, pz, { color: 0xe8f8ff, vx: 0, vz: 0, vy: -0.3, gravity: 0, max: 0.8, size0: 0.35, size1: 0.1, a0: 0.9 });
        break;
      case 'pulse':
        this.additive.emit(px, 0.2, pz, { color: spec.color, vx: 0, vz: 0, vy: 0.9, gravity: 0, drag: 0, max: 0.9, size0: 0.45, size1: 0.1, a0: 0.7 });
        break;
      case 'swirl':
        this.smoke.emit(px, 0.3 + Math.random(), pz, {
          color: spec.color, vx: -Math.sin(a) * 3, vz: Math.cos(a) * 3, vy: 0.8, gravity: 0, drag: 0.5, max: 0.6, size0: 0.5, size1: 1.0, a0: 0.5,
        });
        break;
      case 'quake':
        this.smoke.emit(px, 0.1, pz, { color: 0x8a6a4a, vx: 0, vz: 0, vy: 1.2, gravity: 4, max: 0.5, size0: 0.4, size1: 0.6, a0: 0.8 });
        break;
      case 'grave':
        this.smoke.emit(px, 0.2, pz, { color: 0x404858, vx: 0, vz: 0, vy: 0.5, gravity: 0, max: 1.2, size0: 0.8, size1: 1.6, a0: 0.45 });
        break;
      case 'void':
        this.additive.emit(px, 0.4, pz, { color: spec.color, vx: (x - px) * 1.5, vz: (z - pz) * 1.5, vy: 0.2, gravity: 0, drag: 0, max: 0.6, size0: 0.4, size1: 0.05 });
        break;
      case 'vines':
        this.additive.emit(px, 0.15, pz, { color: spec.color, vx: 0, vz: 0, vy: 1.5, gravity: 2, max: 0.6, size0: 0.3, size1: 0.1 });
        break;
      default:
        this.additive.emit(px, 0.15, pz, { color: spec.color, vx: 0, vz: 0, vy: 0.6, gravity: 0, max: 0.6, size0: 0.3, size1: 0.05, a0: 0.8 });
    }
  }
}

/** Ground circle + style-specific animation for a lingering spell area. */
export class AreaVisual {
  readonly root = new THREE.Group();
  private disc: THREE.Mesh;
  private ring: THREE.Mesh;
  private time = 0;
  private emitAcc = 0;
  private dome: THREE.Mesh | null = null;

  constructor(
    private readonly spec: AreaSpec,
    private radius: number,
    private readonly fx: Effects,
  ) {
    const discGeo = new THREE.CircleGeometry(1, 48);
    discGeo.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.22, depthWrite: false }));
    const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.8, depthWrite: false }));
    this.disc.position.y = 0.05;
    this.ring.position.y = 0.06;
    this.root.add(this.disc, this.ring);
    if (spec.style === 'dome') {
      const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      this.dome = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xcff0ff, emissive: 0x3a90d0, emissiveIntensity: 0.4, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.1 }));
      this.root.add(this.dome);
    }
    this.setRadius(radius);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.disc.scale.setScalar(r);
    this.ring.scale.setScalar(r);
    if (this.dome) this.dome.scale.set(r, r * 0.45, r);
  }

  update(dt: number, lifeFraction: number): void {
    this.time += dt;
    const fade = lifeFraction > 0 ? Math.min(1, lifeFraction * 4) : 1;
    (this.disc.material as THREE.MeshBasicMaterial).opacity = 0.22 * fade + (this.spec.style === 'pulse' ? Math.sin(this.time * 6) * 0.05 : 0);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * fade;
    if (this.spec.style === 'swirl') this.root.rotation.y += dt * 6;
    if (this.spec.style === 'quake') this.root.position.y = Math.sin(this.time * 40) * 0.03;
    this.emitAcc += dt * (8 + this.radius * 6);
    while (this.emitAcc > 1) {
      this.emitAcc -= 1;
      this.fx.areaParticles(this.root.position.x, this.root.position.z, this.radius, this.spec);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    if (this.dome) {
      this.dome.geometry.dispose();
      (this.dome.material as THREE.Material).dispose();
    }
  }
}

function easeOut(x: number): number {
  return 1 - (1 - x) * (1 - x);
}
