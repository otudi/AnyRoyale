import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import type { ArenaTheme } from './arenaThemes';

export function seededRandom(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clones a bundle node and wraps it so its footprint is centred on the origin and its base sits at
 * y = 0 (KayKit hex-kit pieces carry tile offsets in their local transforms).
 */
export function centeredClone(src: THREE.Object3D): THREE.Group {
  const inner = src.clone();
  inner.position.set(0, 0, 0);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Builds the static battlefield for one theme: checkerboard floor with the classic 18x32 layout,
 * river with two bridges, raised rim, banned back corners, surrounding terrain and decorations.
 * Geometry positions come from the engine's arena constants, so what you see is exactly where the
 * simulation puts towers, river and bridges.
 */
export class ArenaBuilder {
  readonly root = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private water: THREE.Mesh[] = [];
  private particles: THREE.Points[] = [];
  private extrasTime = 0;

  constructor(
    private readonly theme: ArenaTheme,
    private readonly quality: 'high' | 'low',
  ) {
    this.root.name = 'arena';
    this.buildFloor();
    this.buildRiver();
    this.buildBridges();
    this.buildRim();
    this.buildOuter();
    this.scatterProps();
    this.buildExtras();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private floorTexture(): THREE.CanvasTexture {
    const px = 48;
    const canvas = document.createElement('canvas');
    canvas.width = 18 * px;
    canvas.height = 32 * px;
    const g = canvas.getContext('2d')!;
    const rand = seededRandom('floor-' + this.theme.id);
    for (let ty = 0; ty < 32; ty++) {
      for (let tx = 0; tx < 18; tx++) {
        const even = (tx + ty) % 2 === 0;
        g.fillStyle = hex(even ? this.theme.grassA : this.theme.grassB);
        g.fillRect(tx * px, ty * px, px, px);
        // subtle blades / speckles
        for (let i = 0; i < 10; i++) {
          g.fillStyle = hex(shade(even ? this.theme.grassA : this.theme.grassB, 0.9 + rand() * 0.2));
          g.fillRect(tx * px + rand() * px, ty * px + rand() * px, 2 + rand() * 3, 2 + rand() * 3);
        }
      }
    }
    // Banned back corners (rows 0 and 31 outside columns 6..11) drawn as darker turf.
    g.fillStyle = hex(shade(this.theme.border, 0.85));
    for (const row of [0, 31]) {
      g.fillRect(0, row * px, 6 * px, px);
      g.fillRect(12 * px, row * px, 6 * px, px);
    }
    // Soft paths in front of the towers (decorative, like the reference arenas).
    g.fillStyle = hex(this.theme.path);
    g.globalAlpha = 0.35;
    const path = (x0: number, y0: number, w: number, h: number) =>
      g.fillRect(x0 * px, (32 - y0 - h) * px, w * px, h * px);
    path(2.2, 8, 2.6, 6.8);
    path(13.2, 8, 2.6, 6.8);
    path(2.2, 17.2, 2.6, 6.8);
    path(13.2, 17.2, 2.6, 6.8);
    g.globalAlpha = 1;
    // Edge vignette
    const grad = g.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.12)');
    grad.addColorStop(0.08, 'rgba(0,0,0,0)');
    grad.addColorStop(0.92, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grad;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildFloor(): void {
    const tex = this.floorTexture();
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    // Two halves (blue: rows 0..14, red: rows 17..31); the river channel sits between them.
    for (const [z0, z1, v0, v1] of [
      [1, 16, 0, 15 / 32],
      [-16, -1, 17 / 32, 1],
    ] as const) {
      const geo = this.track(new THREE.PlaneGeometry(18, z1 - z0));
      geo.rotateX(-Math.PI / 2);
      // remap UVs so each half shows its part of the 32-row texture
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setY(i, uv.getY(i) * (v1 - v0) + v0);
      }
      // (texture v grows with gameY: v = gameY / 32, and plane v grows towards -z = red side)
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = (z0 + z1) / 2;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildRiver(): void {
    const t = this.theme;
    // Channel walls and bed
    const bank = this.track(new THREE.MeshStandardMaterial({ color: shade(t.border, 0.8), roughness: 1 }));
    const bed = this.track(new THREE.MeshStandardMaterial({ color: t.waterDeep, roughness: 1 }));
    const bedGeo = this.track(new THREE.PlaneGeometry(18, 2.2));
    bedGeo.rotateX(-Math.PI / 2);
    const bedMesh = new THREE.Mesh(bedGeo, bed);
    bedMesh.position.y = -0.6;
    this.root.add(bedMesh);
    for (const z of [1, -1]) {
      const wallGeo = this.track(new THREE.BoxGeometry(18, 0.6, 0.12));
      const wall = new THREE.Mesh(wallGeo, bank);
      wall.position.set(0, -0.3, z);
      wall.receiveShadow = true;
      this.root.add(wall);
    }
    // Animated water surface
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = hex(t.water);
    g.fillRect(0, 0, 256, 64);
    const rand = seededRandom('water');
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.15 + rand() * 0.25})`;
      g.lineWidth = 1 + rand() * 2;
      const x = rand() * 256;
      const y = rand() * 64;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 8, y - 3, x + 16 + rand() * 20, y);
      g.stroke();
    }
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 1);
    const mat = this.track(
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
    );
    const geo = this.track(new THREE.PlaneGeometry(18, 2));
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.22;
    water.receiveShadow = true;
    this.root.add(water);
    this.water.push(water);
    // Lily pads for life
    const lilies = assets.node('env_core.glb', 'waterlily');
    if (lilies) {
      const rand2 = seededRandom('lily' + t.id);
      for (let i = 0; i < 5; i++) {
        const x = -8 + rand2() * 16;
        if (Math.abs(Math.abs(x) - 5.5) < 2.2) continue; // keep bridges clear
        const l = centeredClone(lilies);
        l.scale.setScalar(0.45);
        l.position.set(x, -0.2, (rand2() - 0.5) * 1.4);
        this.root.add(l);
      }
    }
  }

  private buildBridges(): void {
    const wood = this.track(new THREE.MeshStandardMaterial({ color: this.theme.bridge, roughness: 0.85, flatShading: true }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: shade(this.theme.bridge, 0.7), roughness: 0.9, flatShading: true }));
    const plankGeo = this.track(new THREE.BoxGeometry(3.1, 0.12, 0.34));
    const railGeo = this.track(new THREE.BoxGeometry(0.14, 0.14, 2.9));
    const postGeo = this.track(new THREE.BoxGeometry(0.2, 0.55, 0.2));
    for (const cx of [-5.5, 5.5]) {
      const bridge = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const p = new THREE.Mesh(plankGeo, i % 2 ? wood : dark);
        p.position.set(0, 0.0, -1.2 + i * 0.4);
        p.rotation.y = (i % 3 - 1) * 0.02;
        p.castShadow = this.quality === 'high';
        p.receiveShadow = true;
        bridge.add(p);
      }
      for (const sx of [-1.55, 1.55]) {
        const rail = new THREE.Mesh(railGeo, dark);
        rail.position.set(sx, 0.45, 0);
        bridge.add(rail);
        for (const z of [-1.35, 0, 1.35]) {
          const post = new THREE.Mesh(postGeo, dark);
          post.position.set(sx, 0.22, z);
          post.castShadow = this.quality === 'high';
          bridge.add(post);
        }
      }
      bridge.position.set(cx, 0, 0);
      this.root.add(bridge);
    }
  }

  private buildRim(): void {
    const t = this.theme;
    const rimMat = this.track(new THREE.MeshStandardMaterial({ color: t.border, roughness: 0.95, flatShading: true }));
    const sideGeo = this.track(new THREE.BoxGeometry(0.6, 0.35, 32.6));
    const endGeo = this.track(new THREE.BoxGeometry(19.2, 0.35, 0.6));
    for (const x of [-9.3, 9.3]) {
      const m = new THREE.Mesh(sideGeo, rimMat);
      m.position.set(x, 0.12, 0);
      m.receiveShadow = true;
      this.root.add(m);
    }
    for (const z of [-16.3, 16.3]) {
      const m = new THREE.Mesh(endGeo, rimMat);
      m.position.set(0, 0.12, z);
      m.receiveShadow = true;
      this.root.add(m);
    }
    // Fence segments along the long sides
    const fenceKey = t.fence === 'wood' ? 'fence_wood' : t.fence === 'stone' ? 'fence_stone' : t.fence === 'wall' ? 'wall' : null;
    const fenceSrc = fenceKey
      ? assets.node('env_core.glb', fenceKey)
      : assets.node('props_spooky.glb', 'fence_iron');
    if (fenceSrc) {
      const box = new THREE.Box3().setFromObject(fenceSrc);
      const len = Math.max(0.1, Math.max(box.max.x - box.min.x, box.max.z - box.min.z));
      const along = box.max.x - box.min.x >= box.max.z - box.min.z ? 'x' : 'z';
      const segs = this.quality === 'high' ? 10 : 6;
      const segLen = 32.4 / segs;
      for (const side of [-1, 1]) {
        for (let i = 0; i < segs; i++) {
          const f = centeredClone(fenceSrc);
          const s = segLen / len;
          f.scale.set(s, Math.min(s, 0.9), s);
          f.rotation.y = along === 'x' ? Math.PI / 2 : 0;
          f.position.set(side * 9.75, 0.28, -16.2 + segLen * (i + 0.5));
          this.root.add(f);
        }
      }
    }
  }

  private buildOuter(): void {
    const t = this.theme;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d')!;
    g.fillStyle = hex(t.outer);
    g.fillRect(0, 0, 256, 256);
    const rand = seededRandom('outer' + t.id);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = hex(shade(t.outer, 0.85 + rand() * 0.3));
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 6, 2 + rand() * 6);
    }
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 14);
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    // A frame of terrain around the 18x32 arena (a single plane would cover the river channel).
    const W = 90;
    const H = 120;
    const ax = 9.6;
    const az = 16.6;
    const pieces: [number, number, number, number][] = [
      [-W / 2, -ax, -H / 2, H / 2],
      [ax, W / 2, -H / 2, H / 2],
      [-ax, ax, az, H / 2],
      [-ax, ax, -H / 2, -az],
    ];
    for (const [x0, x1, z0, z1] of pieces) {
      const geo = this.track(new THREE.PlaneGeometry(x1 - x0, z1 - z0));
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / W + 0.5, (z0 + uv.getY(i) * (z1 - z0)) / H + 0.5);
      }
      const ground = new THREE.Mesh(geo, mat);
      ground.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
      ground.receiveShadow = true;
      this.root.add(ground);
    }
    // Skirt under the arena so the river channel never shows the void.
    const skirtMat = this.track(new THREE.MeshStandardMaterial({ color: shade(t.border, 0.7), roughness: 1 }));
    const skirt = new THREE.Mesh(this.track(new THREE.BoxGeometry(18.6, 0.6, 32.6)), skirtMat);
    skirt.position.y = -1.0;
    this.root.add(skirt);
  }

  private scatterProps(): void {
    const t = this.theme;
    const rand = seededRandom('props-' + t.id);
    const totalWeight = t.props.reduce((a, p) => a + p.weight, 0);
    const count = this.quality === 'high' ? 56 : 30;
    const placed: THREE.Vector3[] = [];
    let attempts = 0;
    while (placed.length < count && attempts++ < count * 20) {
      let r = rand() * totalWeight;
      let ref = t.props[0];
      for (const p of t.props) {
        r -= p.weight;
        if (r <= 0) {
          ref = p;
          break;
        }
      }
      const src = assets.node(ref.bundle, ref.key);
      if (!src) continue;
      // Ring around the arena; "far" props stay further out.
      const minEdge = ref.far ? 6 : 1.6;
      const x = (rand() - 0.5) * 44;
      const z = (rand() - 0.5) * 60;
      const outsideX = Math.abs(x) - 10.2;
      const outsideZ = Math.abs(z) - 17;
      const edge = Math.max(outsideX, outsideZ);
      if (edge < minEdge) continue;
      if (z > 18 && Math.abs(x) < 8) continue; // keep the area under the card tray readable
      const pos = new THREE.Vector3(x, 0, z);
      if (placed.some((p) => p.distanceTo(pos) < (ref.far ? 5 : 1.8))) continue;
      placed.push(pos);
      const obj = centeredClone(src);
      const s = ref.scale[0] + rand() * (ref.scale[1] - ref.scale[0]);
      obj.scale.setScalar(s);
      obj.rotation.y = rand() * Math.PI * 2;
      obj.position.copy(pos);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = this.quality === 'high' && edge < 6;
          m.receiveShadow = true;
        }
      });
      this.root.add(obj);
    }
  }

  private buildExtras(): void {
    const extras = this.theme.extras ?? [];
    const rand = seededRandom('extras-' + this.theme.id);
    if (extras.includes('crystals')) {
      const geo = this.track(new THREE.OctahedronGeometry(0.5, 0));
      const mat = this.track(
        new THREE.MeshStandardMaterial({
          color: this.theme.id === 'frost' ? 0xbfe8ff : 0xb48cff,
          emissive: this.theme.id === 'frost' ? 0x3aa0ff : 0x7a3cff,
          emissiveIntensity: 0.6,
          roughness: 0.2,
          flatShading: true,
        }),
      );
      for (let i = 0; i < 18; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(side * (11 + rand() * 9), 0.4, (rand() - 0.5) * 50);
        m.scale.set(0.6 + rand(), 1 + rand() * 2.2, 0.6 + rand());
        m.rotation.y = rand() * 3;
        this.root.add(m);
      }
    }
    const pointCount = this.quality === 'high' ? 260 : 90;
    const makePoints = (color: number, size: number, area: [number, number, number], additive: boolean) => {
      const geo = this.track(new THREE.BufferGeometry());
      const pos = new Float32Array(pointCount * 3);
      for (let i = 0; i < pointCount; i++) {
        pos[i * 3] = (rand() - 0.5) * area[0];
        pos[i * 3 + 1] = rand() * area[1];
        pos[i * 3 + 2] = (rand() - 0.5) * area[2];
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = this.track(
        new THREE.PointsMaterial({
          color,
          size,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
      );
      const pts = new THREE.Points(geo, mat);
      this.root.add(pts);
      this.particles.push(pts);
      return pts;
    };
    if (extras.includes('snow')) makePoints(0xffffff, 0.18, [44, 16, 60], false).userData.kind = 'snow';
    if (extras.includes('dust')) makePoints(0xfff1c8, 0.1, [40, 6, 56], false).userData.kind = 'dust';
    if (extras.includes('fireflies')) makePoints(0xfff59a, 0.14, [40, 3, 56], true).userData.kind = 'fireflies';
  }

  /** Per-frame animation of water and ambient particles. */
  update(dt: number): void {
    this.extrasTime += dt;
    for (const w of this.water) {
      const map = (w.material as THREE.MeshStandardMaterial).map!;
      map.offset.x = (map.offset.x + dt * 0.05) % 1;
      map.offset.y = Math.sin(this.extrasTime * 0.6) * 0.02;
    }
    for (const p of this.particles) {
      const kind = p.userData.kind as string;
      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      if (kind === 'snow') {
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) - dt * 1.2;
          if (y < 0) y += 16;
          pos.setY(i, y);
          pos.setX(i, pos.getX(i) + Math.sin(this.extrasTime + i) * dt * 0.3);
        }
        pos.needsUpdate = true;
      } else if (kind === 'fireflies' || kind === 'dust') {
        (p.material as THREE.PointsMaterial).opacity = 0.55 + Math.sin(this.extrasTime * 2) * 0.25;
        p.rotation.y += dt * 0.01;
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.removeFromParent();
  }
}
