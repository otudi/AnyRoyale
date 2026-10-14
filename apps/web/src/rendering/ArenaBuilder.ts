import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { sceneryFor, type ArenaTheme, type Scenery } from './arenaThemes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeStatic } from './mergeStatic';

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

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Cheap smooth value noise from summed sines (deterministic, no tables). */
function noise2(x: number, z: number): number {
  return (
    0.5 +
    0.25 * Math.sin(x * 0.31 + Math.sin(z * 0.17) * 2.1) * Math.cos(z * 0.27 + Math.sin(x * 0.13) * 1.7) +
    0.15 * Math.sin(x * 0.83 + z * 0.61) +
    0.1 * Math.cos(x * 1.71 - z * 1.33)
  );
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Arena layout in game tiles (x: 0..18, y: 0..32 from the blue back edge), from crforge's Arena.
const LANES = [3.5, 14.5];
const PRINCESS_Y = 6.5;
const KING_Y = 3;

/** Gives a non-indexed copy of {@code src} a per-vertex colour from {@code paint(x, y, z, ny)}. */
function colored(src: THREE.BufferGeometry, paint: (x: number, y: number, z: number, ny: number) => number): THREE.BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHex(paint(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i)));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 p = vec2(vUv.x * 18.0, vUv.y * 2.0);
  float edge = abs(vUv.y - 0.5) * 2.0;
  vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 1.0, edge));
  float t = uTime;
  vec2 q = p * vec2(1.25, 2.3);
  float c = sin(q.x * 2.1 + t * 1.3 + sin(q.y * 3.0 + t) * 1.2);
  c += sin(q.x * 1.3 - t * 0.9 + q.y * 2.7 + sin(q.x * 0.7 - t * 0.5) * 1.5);
  c += sin((q.x + q.y) * 1.7 + t * 1.7);
  c /= 3.0;
  col += smoothstep(0.5, 0.95, c) * 0.2;
  float streak = smoothstep(0.93, 1.0, sin(p.x * 0.9 - t * 1.6 + sin(p.y * 4.0 + p.x * 0.3) * 0.8) * 0.5 + 0.5);
  col += streak * (1.0 - edge) * 0.16;
  float foam = smoothstep(0.74, 1.0, edge + 0.07 * sin(p.x * 3.1 + t * 2.0) + 0.04 * sin(p.x * 7.3 - t * 3.0));
  col = mix(col, uFoam, foam * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Builds the static battlefield for one theme: a hand-painted grass field with stone tower plazas
 * and cobbled lanes, an animated river between stone banks, two stone arch bridges, a stone wall
 * around the field and rolling surroundings with trees, rocks and bushes. Geometry positions come
 * from the engine's arena constants, so what you see is exactly where the simulation puts towers,
 * river and bridges. Everything static is merged into a handful of draw calls.
 */
export class ArenaBuilder {
  readonly root = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private water: THREE.ShaderMaterial | null = null;
  private particles: THREE.Points[] = [];
  private extrasTime = 0;
  private readonly look: Scenery;
  /** Shared vertex-coloured material for every procedural scenery piece (one draw call). */
  private readonly nature: THREE.MeshLambertMaterial;
  private readonly px: number;
  /** Soft contact shadows under scenery [x, z, radius] (phones have no shadow map). */
  private shadows: [number, number, number][] = [];

  constructor(
    private readonly theme: ArenaTheme,
    private readonly quality: 'high' | 'low',
    /** +1 when this player's own side is at +z (blue), -1 otherwise: banners show team colours. */
    private readonly ownSide: 1 | -1 = 1,
  ) {
    this.root.name = 'arena';
    this.look = sceneryFor(theme.id);
    this.px = quality === 'high' ? 64 : 44;
    this.nature = this.track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.buildFloor();
    this.buildRiver();
    this.buildBridges();
    this.buildWalls();
    this.buildOuter();
    this.buildNature();
    this.scatterProps();
    this.buildExtras();
    this.buildShadows();
    // Everything above is static: bake it into a few meshes (one per material).
    mergeStatic(this.root);
    this.root.traverse((o) => {
      if (o.name === 'merged') this.track((o as THREE.Mesh).geometry);
    });
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private add(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, mat: THREE.Material = this.nature): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = this.quality === 'high';
    this.root.add(m);
    return m;
  }

  // ------------------------------------------------------------------ field

  private floorTexture(): THREE.CanvasTexture {
    const px = this.px;
    const t = this.theme;
    const canvas = document.createElement('canvas');
    canvas.width = 18 * px;
    canvas.height = 32 * px;
    const g = canvas.getContext('2d')!;
    const rand = seededRandom('floor-' + t.id);
    const X = (gx: number) => gx * px;
    const Y = (gy: number) => (32 - gy) * px;

    // 1. checkerboard turf (soft, like mown stripes)
    for (let ty = 0; ty < 32; ty++) {
      for (let tx = 0; tx < 18; tx++) {
        g.fillStyle = hex((tx + ty) % 2 === 0 ? t.grassA : t.grassB);
        g.fillRect(tx * px, ty * px, px, px);
      }
    }
    // 2. large soft light/dark patches break the grid up
    for (let i = 0; i < 46; i++) {
      const x = rand() * canvas.width;
      const y = rand() * canvas.height;
      const r = (1.5 + rand() * 3) * px;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const light = rand() < 0.5;
      grad.addColorStop(0, light ? 'rgba(255,255,200,0.10)' : 'rgba(20,70,10,0.10)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 3. thousands of grass blades
    const blades = this.quality === 'high' ? 14000 : 6000;
    g.lineCap = 'round';
    for (let i = 0; i < blades; i++) {
      const x = rand() * canvas.width;
      const y = rand() * canvas.height;
      const base = ((Math.floor(x / px) + Math.floor(y / px)) % 2 === 0 ? t.grassA : t.grassB) as number;
      const f = rand();
      g.strokeStyle = hex(shade(base, f < 0.5 ? 0.78 + f * 0.3 : 1.05 + (f - 0.5) * 0.3));
      g.lineWidth = (0.8 + rand() * 1.2) * (px / 64);
      const len = (3 + rand() * 6) * (px / 64);
      const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // 4. little flowers along the side edges
    for (let i = 0; i < 70; i++) {
      const gx = rand() < 0.5 ? 0.2 + rand() * 1.3 : 16.5 + rand() * 1.3;
      const gy = 1 + rand() * 30;
      if (Math.abs(gy - 16) < 1.6) continue;
      g.fillStyle = ['#ffffff', '#ffe36a', '#ff9ec4', '#bfe0ff'][Math.floor(rand() * 4)];
      const s = px * 0.05;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(X(gx) + Math.cos(k * 1.57) * s, Y(gy) + Math.sin(k * 1.57) * s, s, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 5. cobbled lanes: bridge -> princess tower -> king tower, mirrored for both sides
    const lanePaths: [number, number][][] = [];
    for (const lx of LANES) {
      for (const side of [0, 1]) {
        const m = (y: number) => (side ? 32 - y : y);
        const toward = lx < 9 ? 1 : -1;
        lanePaths.push([
          [lx, m(15.2)],
          [lx, m(PRINCESS_Y)],
        ]);
        lanePaths.push([
          [lx, m(PRINCESS_Y)],
          [lx + toward * 1.6, m(PRINCESS_Y - 2.2)],
          [9 - toward * 2.6, m(KING_Y + 0.6)],
        ]);
      }
    }
    const strokeLanes = (width: number, style: string) => {
      g.strokeStyle = style;
      g.lineWidth = width * px;
      g.lineJoin = 'round';
      for (const pts of lanePaths) {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.stroke();
      }
    };
    strokeLanes(2.5, 'rgba(40,60,20,0.18)');
    strokeLanes(2.05, hex(shade(t.path, 0.82)));
    // cobbles along each lane
    for (const pts of lanePaths) {
      for (let s = 0; s < pts.length - 1; s++) {
        const [x0, y0] = pts[s];
        const [x1, y1] = pts[s + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const nx = -(y1 - y0) / len;
        const ny = (x1 - x0) / len;
        for (let d = 0; d < len; d += 0.3) {
          for (let k = -2; k <= 2; k++) {
            const off = k * 0.36 + (rand() - 0.5) * 0.1;
            const cx = x0 + ((x1 - x0) * d) / len + nx * off;
            const cy = y0 + ((y1 - y0) * d) / len + ny * off;
            this.stone(g, X(cx), Y(cy), px * (0.14 + rand() * 0.04), px * (0.11 + rand() * 0.04), rand() * Math.PI, t.path, rand);
          }
        }
      }
    }

    // 6. stone plazas under the towers
    const plaza = (cx: number, cy: number, shape: 'round' | 'square', r: number) => {
      g.save();
      g.beginPath();
      if (shape === 'round') g.arc(X(cx), Y(cy), r * px, 0, Math.PI * 2);
      else g.roundRect(X(cx) - r * px, Y(cy) - r * px, r * 2 * px, r * 2 * px, px * 0.6);
      g.fillStyle = 'rgba(30,40,20,0.25)';
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = px * 0.4;
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = hex(shade(this.look.stone, 0.62));
      g.fill();
      g.clip();
      const cell = 0.5;
      for (let yy = cy - r; yy < cy + r; yy += cell) {
        const shift = Math.round((yy - cy) / cell) % 2 ? cell / 2 : 0;
        for (let xx = cx - r - shift; xx < cx + r; xx += cell) {
          const w = cell * (0.86 + rand() * 0.1);
          const h = cell * (0.84 + rand() * 0.1);
          const tint = shade(this.look.stone, 0.86 + rand() * 0.24);
          g.fillStyle = hex(tint);
          g.beginPath();
          g.roundRect(X(xx + (cell - w) / 2), Y(yy + cell - (cell - h) / 2), w * px, h * px, px * 0.07);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.16)';
          g.fillRect(X(xx + (cell - w) / 2) + 2, Y(yy + cell - (cell - h) / 2) + 2, w * px - 4, px * 0.05);
        }
      }
      g.restore();
      // a ring of edge stones
      g.save();
      g.beginPath();
      if (shape === 'round') g.arc(X(cx), Y(cy), r * px, 0, Math.PI * 2);
      else g.roundRect(X(cx) - r * px, Y(cy) - r * px, r * 2 * px, r * 2 * px, px * 0.6);
      g.lineWidth = px * 0.2;
      g.strokeStyle = hex(shade(this.look.stone, 0.72));
      g.stroke();
      g.lineWidth = px * 0.06;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.stroke();
      g.restore();
    };
    for (const side of [0, 1]) {
      const m = (y: number) => (side ? 32 - y : y);
      for (const lx of LANES) plaza(lx, m(PRINCESS_Y), 'round', 2.15);
      plaza(9, m(KING_Y), 'square', 2.7);
    }

    // 7. banned back corners: darker, rougher turf
    g.fillStyle = 'rgba(20,40,10,0.22)';
    for (const row of [0, 31]) {
      g.fillRect(0, row * px, 6 * px, px);
      g.fillRect(12 * px, row * px, 6 * px, px);
    }
    // 8. ambient occlusion: along the walls and the river banks
    const ao = (x0: number, y0: number, x1: number, y1: number, horizontal: boolean, from: number, to: number) => {
      const grad = horizontal ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, `rgba(10,30,0,${from})`);
      grad.addColorStop(1, `rgba(10,30,0,${to})`);
      g.fillStyle = grad;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || canvas.width, Math.abs(y1 - y0) || canvas.height);
    };
    ao(0, 0, px * 0.9, 0, true, 0.32, 0);
    ao(canvas.width, 0, canvas.width - px * 0.9, 0, true, 0.32, 0);
    ao(0, 0, 0, px * 0.9, false, 0.3, 0);
    ao(0, canvas.height, 0, canvas.height - px * 0.9, false, 0.3, 0);
    ao(0, Y(15), 0, Y(15) + px * 0.7, false, 0.35, 0);
    ao(0, Y(17), 0, Y(17) - px * 0.7, false, 0.35, 0);

    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  /** One rounded cobble with a soft shadow and a light top edge. */
  private stone(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, base: number, rand: () => number): void {
    g.beginPath();
    g.ellipse(x + 1.5, y + 2, rx, ry, rot, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fill();
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fillStyle = hex(shade(base, 0.82 + rand() * 0.3));
    g.fill();
    g.beginPath();
    g.ellipse(x - rx * 0.2, y - ry * 0.3, rx * 0.55, ry * 0.4, rot, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fill();
  }

  private buildFloor(): void {
    const tex = this.floorTexture();
    const mat = this.track(new THREE.MeshLambertMaterial({ map: tex }));
    // Two halves (blue: rows 0..14, red: rows 17..31); the river channel sits between them.
    for (const [z0, z1, v0, v1] of [
      [1, 16, 0, 15 / 32],
      [-16, -1, 17 / 32, 1],
    ] as const) {
      const geo = this.track(new THREE.PlaneGeometry(18, z1 - z0));
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (v1 - v0) + v0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = (z0 + z1) / 2;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  // ------------------------------------------------------------------ river

  private brickTexture(base: number, w: number, h: number, rows: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const rand = seededRandom('brick' + base);
    g.fillStyle = hex(shade(base, 0.5));
    g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh : 0;
      while (x < w) {
        const bw = rh * (1.4 + rand() * 1.2);
        g.fillStyle = hex(shade(base, 0.78 + rand() * 0.3));
        g.beginPath();
        g.roundRect(x + 2, r * rh + 2, bw - 4, rh - 4, 4);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.13)';
        g.fillRect(x + 4, r * rh + 3, bw - 8, 3);
        x += bw;
      }
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private buildRiver(): void {
    const t = this.theme;
    const stone = this.look.stone;
    // Stone channel walls and a dark bed
    const brick = this.brickTexture(stone, 512, 64, 2);
    brick.repeat.set(9, 1);
    const wallMat = this.track(new THREE.MeshLambertMaterial({ map: brick }));
    for (const z of [1, -1]) {
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(18, 0.66, 0.16)), wallMat);
      wall.position.set(0, -0.31, z);
      wall.receiveShadow = true;
      this.root.add(wall);
    }
    const bed = new THREE.Mesh(this.track(new THREE.PlaneGeometry(18, 2.2).rotateX(-Math.PI / 2)), this.track(new THREE.MeshLambertMaterial({ color: t.waterDeep })));
    bed.position.y = -0.62;
    this.root.add(bed);

    // Animated water (custom shader: caustics, current streaks and foam along the banks)
    this.water = this.track(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uShallow: { value: new THREE.Color(mix(t.water, 0xffffff, 0.12)) },
            uDeep: { value: new THREE.Color(t.waterDeep) },
            uFoam: { value: new THREE.Color(0xf4fbff) },
          },
        ]),
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        fog: true,
      }),
    );
    const water = new THREE.Mesh(this.track(new THREE.PlaneGeometry(18, 2, 1, 1).rotateX(-Math.PI / 2)), this.water);
    water.position.y = -0.2;
    water.userData.dynamic = true;
    this.root.add(water);

    // Rocks along both bank edges (away from the bridges), reeds near the side walls
    const rand = seededRandom('banks' + t.id);
    const rock = new THREE.IcosahedronGeometry(1, 0);
    for (const z of [1.02, -1.02]) {
      for (let x = -8.7; x < 8.8; x += 0.42 + rand() * 0.3) {
        if (Math.abs(Math.abs(x) - 5.5) < 1.9) continue;
        const s = 0.12 + rand() * 0.12;
        const geo = colored(rock, (_x, y, _z, ny) => this.stoneColor(rand, y > 0.3 && ny > 0.5));
        const m = this.add(geo, x, 0.02, z + (rand() - 0.5) * 0.12, rand() * 3);
        m.scale.set(s * (1 + rand() * 0.6), s * 0.75, s);
        m.castShadow = false;
      }
    }
    const reed = new THREE.ConeGeometry(0.035, 0.6, 4);
    for (let i = 0; i < 40; i++) {
      const x = (rand() < 0.5 ? -1 : 1) * (7.3 + rand() * 1.5);
      const z = (rand() < 0.5 ? -1 : 1) * (0.78 + rand() * 0.14);
      const col = mix(this.look.foliage[1], 0xd8e870, rand() * 0.3);
      const m = this.add(colored(reed, () => col), x, -0.05, z, 0);
      m.rotation.z = (rand() - 0.5) * 0.4;
      m.scale.y = 0.6 + rand() * 0.8;
      m.castShadow = false;
    }
  }

  // ------------------------------------------------------------------ bridges

  private buildBridges(): void {
    const stone = this.look.stone;
    const rand = seededRandom('bridge' + this.theme.id);
    // deck: cobbled top
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = hex(shade(stone, 0.55));
    g.fillRect(0, 0, 256, 256);
    for (let y = 10; y < 256; y += 22) {
      for (let x = (y / 22) % 2 ? 0 : 14; x < 266; x += 28) {
        this.stone(g, x, y, 13 + rand() * 2, 9 + rand() * 2, (rand() - 0.5) * 0.3, mix(stone, this.theme.path, 0.35), rand);
      }
    }
    const deckTex = this.track(new THREE.CanvasTexture(c));
    deckTex.colorSpace = THREE.SRGBColorSpace;
    const deckMat = this.track(new THREE.MeshLambertMaterial({ map: deckTex }));
    const brick = this.brickTexture(stone, 256, 128, 3);
    brick.repeat.set(0.5, 0.5);
    const archMat = this.track(new THREE.MeshLambertMaterial({ map: brick }));

    // arch body under the deck: a slab with a semicircular hole over the water, extruded along x
    const shape = new THREE.Shape();
    shape.moveTo(-1.5, -0.66);
    shape.lineTo(-0.95, -0.66);
    shape.absarc(0, -0.66, 0.95, Math.PI, 0, true);
    shape.lineTo(1.5, -0.66);
    shape.lineTo(1.5, -0.05);
    shape.lineTo(-1.5, -0.05);
    shape.closePath();
    const archGeo = this.track(new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false, curveSegments: 10 }));
    archGeo.rotateY(Math.PI / 2);
    archGeo.translate(-1.5, 0, 0);
    archGeo.scale(1, 1, 1);
    const block = new THREE.BoxGeometry(1, 1, 1);
    const capCone = new THREE.ConeGeometry(0.33, 0.32, 4);
    for (const cx of [-5.5, 5.5]) {
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(cx, 0, 0);
      arch.receiveShadow = true;
      this.root.add(arch);
      const deck = new THREE.Mesh(this.track(new THREE.BoxGeometry(3.1, 0.16, 3.0)), deckMat);
      deck.position.set(cx, 0.03, 0);
      deck.receiveShadow = true;
      this.root.add(deck);
      // parapets with posts
      for (const sx of [-1.62, 1.62]) {
        for (let z = -1.3; z <= 1.31; z += 0.65) {
          const m = this.add(colored(block, () => shade(stone, 0.86 + rand() * 0.2)), cx + sx, 0.24, z, 0);
          m.scale.set(0.26, 0.34, 0.6);
        }
        for (const z of [-1.55, 1.55]) {
          const post = this.add(colored(block, () => shade(stone, 0.8)), cx + sx, 0.36, z, 0);
          post.scale.set(0.42, 0.72, 0.42);
          const cap = this.add(colored(capCone, () => shade(stone, 1.08)), cx + sx, 0.88, z, Math.PI / 4);
          cap.castShadow = false;
        }
      }
    }
  }

  // ------------------------------------------------------------------ walls

  private stoneColor(rand: () => number, snowy = false): number {
    if (snowy && this.look.snow) return 0xf4f8fc;
    return shade(this.look.stone, 0.78 + rand() * 0.3);
  }

  private buildWalls(): void {
    const rand = seededRandom('walls' + this.theme.id);
    const block = new THREE.BoxGeometry(1, 1, 1);
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      let d = 0;
      while (d < len) {
        const bl = Math.min(len - d, 0.75 + rand() * 0.55);
        const mid = d + bl / 2;
        const h = 0.48 + rand() * 0.1;
        const m = this.add(colored(block, (_x, y, _z, ny) => this.stoneColor(rand, y > 0.4 && ny > 0.5)), x0 + dx * mid, h / 2 - 0.02, z0 + dz * mid, Math.atan2(dx, dz) + (rand() - 0.5) * 0.04);
        m.scale.set(0.62, h, bl - 0.05);
        // cap course
        if (rand() < 0.85) {
          const cap = this.add(colored(block, () => (this.look.snow ? 0xf2f7fb : shade(this.look.stone, 1.05 + rand() * 0.1))), x0 + dx * mid, h + 0.04, z0 + dz * mid, Math.atan2(dx, dz));
          cap.scale.set(0.72, 0.1, bl - 0.02);
          cap.castShadow = false;
        }
        d += bl;
      }
    };
    run(-9.42, -16.4, -9.42, 16.4);
    run(9.42, -16.4, 9.42, 16.4);
    run(-9.75, 16.42, 9.75, 16.42);
    run(-9.75, -16.42, 9.75, -16.42);
    // corner towers with team-coloured roofs, banners on the back walls
    const cyl = new THREE.CylinderGeometry(0.62, 0.7, 1.4, 8);
    const roof = new THREE.ConeGeometry(0.78, 0.8, 8);
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 1.9, 5);
    const flag = new THREE.BoxGeometry(0.04, 0.62, 0.48);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const own = sz === this.ownSide;
        const team = own ? 0x2f7fe8 : 0xe23b3b;
        this.add(colored(cyl, () => this.stoneColor(rand)), sx * 9.55, 0.68, sz * 16.45, rand());
        this.add(colored(roof, (_x, y) => (this.look.snow && y > 0.05 ? 0xf4f8fc : team)), sx * 9.55, 1.78, sz * 16.45, 0);
        for (const bx of [3.2, 6.4]) {
          this.add(colored(pole, () => 0x6b4a2a), sx * bx, 1.0, sz * 16.6, 0).castShadow = false;
          const f = this.add(colored(flag, (_x, y) => (y < -0.2 ? 0xffd34a : team)), sx * bx, 1.6, sz * 16.6 - sz * 0.0, Math.PI / 2);
          f.position.x += sx * -0.26;
          f.castShadow = false;
        }
      }
    }
  }

  // ------------------------------------------------------------------ surroundings

  /** How far (world units) a point lies outside the walled field. */
  private outside(x: number, z: number): number {
    const dx = Math.max(0, Math.abs(x) - 9.8);
    const dz = Math.max(0, Math.abs(z) - 16.8);
    return Math.hypot(dx, dz);
  }

  private height(x: number, z: number): number {
    const d = this.outside(x, z);
    const n = noise2(x, z);
    return smoothstep(1.2, 11, d) * (0.6 + n * 2.6) + Math.max(0, d - 26) * 0.35;
  }

  private buildOuter(): void {
    const look = this.look;
    // detail texture: speckles multiplied over the vertex colours
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, 256, 256);
    const rand = seededRandom('outer' + this.theme.id);
    for (let i = 0; i < 2600; i++) {
      const v = Math.round(200 + rand() * 55);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1 + rand();
      const x = rand() * 256;
      const y = rand() * 256;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
      g.stroke();
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const mat = this.track(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    const W = 110;
    const H = 150;
    const ax = 9.6;
    const az = 16.6;
    const pieces: [number, number, number, number][] = [
      [-W / 2, -ax, -H / 2, H / 2],
      [ax, W / 2, -H / 2, H / 2],
      [-ax, ax, az, H / 2],
      [-ax, ax, -H / 2, -az],
    ];
    const col = new THREE.Color();
    for (const [x0, x1, z0, z1] of pieces) {
      const sx = Math.max(2, Math.round((x1 - x0) / 1.6));
      const sz = Math.max(2, Math.round((z1 - z0) / 1.6));
      const geo = this.track(new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz));
      geo.rotateX(-Math.PI / 2);
      geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, this.height(x, z) - 0.03);
        uv.setXY(i, x / 6, z / 6);
        const d = this.outside(x, z);
        const n = noise2(x * 1.7 + 11, z * 1.7 - 7);
        const ao = 1 - 0.28 * (1 - smoothstep(0, 2.2, d)); // darker right against the walls
        col.setHex(shade(mix(look.ground[0], look.ground[1], smoothstep(0, 22, d)), (0.66 + n * 0.5) * ao));
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const ground = new THREE.Mesh(geo, mat);
      ground.receiveShadow = true;
      this.root.add(ground);
    }
    // Skirt under the arena so the river channel never shows the void.
    const skirt = new THREE.Mesh(this.track(new THREE.BoxGeometry(18.6, 0.6, 32.6)), this.track(new THREE.MeshLambertMaterial({ color: shade(look.stone, 0.5) })));
    skirt.position.y = -1.0;
    this.root.add(skirt);
  }

  /** Trees, rocks and bushes all around the field (procedural, vertex coloured, merged). */
  private buildNature(): void {
    const look = this.look;
    const rand = seededRandom('nature' + this.theme.id);
    const high = this.quality === 'high';
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const ico1 = high ? new THREE.IcosahedronGeometry(1, 1) : ico;
    const coneG = new THREE.ConeGeometry(1, 1, 7);
    const trunkG = new THREE.CylinderGeometry(0.5, 0.7, 1, 6);
    const leaf = (k: number) => mix(look.foliage[0], look.foliage[1], k);
    const snowCap = (y: number, ny: number, base: number) => (look.snow && ny > 0.35 && y > -0.1 ? 0xf4f8fc : base);

    const tree = (x: number, z: number, s: number) => {
      const y0 = this.height(x, z) - 0.05;
      const style = look.trees === 'mixed' ? (rand() < 0.5 ? 'round' : 'pine') : look.trees;
      const trunk = look.trunk;
      const k = rand();
      if (style === 'pine') {
        const t = this.add(colored(trunkG, () => trunk), x, y0 + 0.35 * s, z);
        t.scale.set(0.2 * s, 0.7 * s, 0.2 * s);
        for (let i = 0; i < 3; i++) {
          const w = (1.05 - i * 0.26) * s;
          const h = (1.1 - i * 0.18) * s;
          const base = leaf(Math.min(1, k * 0.6 + i * 0.2));
          const m = this.add(colored(coneG, (_x, y, _z, ny) => snowCap(y, ny, shade(base, 0.9 + (y + 0.5) * 0.25))), x, y0 + (0.95 + i * 0.62) * s, z, rand() * 3);
          m.scale.set(w, h, w);
        }
      } else if (style === 'palm') {
        let px = x;
        let pz = z;
        let py = y0;
        const lean = rand() * Math.PI * 2;
        for (let i = 0; i < 5; i++) {
          const seg = this.add(colored(trunkG, () => shade(trunk, 0.85 + (i % 2) * 0.2)), px, py + 0.3 * s, pz, 0);
          seg.scale.set(0.13 * s, 0.62 * s, 0.13 * s);
          seg.rotation.set(Math.cos(lean) * 0.12 * i, 0, Math.sin(lean) * 0.12 * i);
          px += Math.sin(lean) * 0.07 * i * s;
          pz -= Math.cos(lean) * 0.07 * i * s;
          py += 0.58 * s;
        }
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
          const fr = this.add(colored(ico, () => leaf(rand())), px + Math.cos(a) * 0.55 * s, py + 0.1 * s, pz + Math.sin(a) * 0.55 * s, -a);
          fr.scale.set(0.75 * s, 0.07 * s, 0.2 * s);
          fr.rotation.z = -0.35;
        }
      } else if (style === 'dead') {
        const t = this.add(colored(trunkG, () => trunk), x, y0 + 0.8 * s, z);
        t.scale.set(0.18 * s, 1.6 * s, 0.18 * s);
        for (let i = 0; i < 3; i++) {
          const a = rand() * Math.PI * 2;
          const b = this.add(colored(trunkG, () => shade(trunk, 1.1)), x + Math.cos(a) * 0.25 * s, y0 + (1.0 + i * 0.3) * s, z + Math.sin(a) * 0.25 * s, 0);
          b.scale.set(0.07 * s, 0.75 * s, 0.07 * s);
          b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        }
      } else {
        const t = this.add(colored(trunkG, () => trunk), x, y0 + 0.45 * s, z);
        t.scale.set(0.22 * s, 0.9 * s, 0.22 * s);
        const blobs = 3 + Math.floor(rand() * 2);
        for (let i = 0; i < blobs; i++) {
          const a = (i / blobs) * Math.PI * 2 + rand();
          const r = i === 0 ? 0 : 0.42 * s;
          const base = leaf(Math.min(1, k * 0.7 + rand() * 0.3));
          const m = this.add(colored(ico1, (_x, y, _z, ny) => snowCap(y, ny, shade(base, 0.82 + (y + 1) * 0.16))), x + Math.cos(a) * r, y0 + (1.25 + (i === 0 ? 0.35 : rand() * 0.2)) * s, z + Math.sin(a) * r, rand() * 3);
          const bs = (i === 0 ? 0.78 : 0.58 + rand() * 0.12) * s;
          m.scale.set(bs, bs * 0.88, bs);
        }
      }
    };

    const nearCamera = (x: number, z: number) => z * this.ownSide > 16.4 && Math.abs(x) < 12.5;
    // trees: dense near the walls, thinning out with distance
    const trees = high ? 150 : 85;
    let placed = 0;
    const spots: [number, number, number][] = [];
    for (let tries = 0; placed < trees && tries < trees * 30; tries++) {
      const x = (rand() - 0.5) * 70;
      const z = (rand() - 0.5) * 96;
      const d = this.outside(x, z);
      if (d < 1.3 || d > 30) continue;
      if (rand() > 1.15 - d / 30) continue; // denser close by
      if (nearCamera(x, z)) continue;
      const s = 0.9 + rand() * 0.8 + d * 0.02;
      if (spots.some(([sx, sz, ss]) => Math.hypot(sx - x, sz - z) < (ss + s) * 0.55)) continue;
      spots.push([x, z, s]);
      tree(x, z, s);
      this.shadows.push([x, z, s * (look.trees === 'palm' ? 1.0 : 0.95)]);
      placed++;
    }
    // rocks
    for (let i = 0; i < (high ? 46 : 26); i++) {
      const x = (rand() - 0.5) * 60;
      const z = (rand() - 0.5) * 80;
      const d = this.outside(x, z);
      if (d < 0.9 || nearCamera(x, z)) continue;
      const s = 0.3 + rand() * 0.6;
      const m = this.add(colored(ico, (_x, y, _z, ny) => this.stoneColor(rand, y > 0.2 && ny > 0.4)), x, this.height(x, z) + s * 0.25, z, rand() * 3);
      m.scale.set(s * (1 + rand() * 0.6), s * 0.7, s);
      this.shadows.push([x, z, s * 1.3]);
    }
    // bushes hugging the outside of the walls
    for (let i = 0; i < (high ? 70 : 36); i++) {
      const side = Math.floor(rand() * 4);
      const along = (rand() - 0.5) * 2;
      const x = side < 2 ? (side ? 1 : -1) * (10.25 + rand() * 0.8) : along * 10.5;
      const z = side < 2 ? along * 17 : (side === 2 ? 1 : -1) * (17.25 + rand() * 0.6);
      if (nearCamera(x, z) && rand() < 0.6) continue;
      const s = 0.3 + rand() * 0.35;
      const base = leaf(rand());
      const m = this.add(colored(ico, (_x, y, _z, ny) => snowCap(y, ny, shade(base, 0.85 + (y + 1) * 0.12))), x, this.height(x, z) + s * 0.45, z, rand() * 3);
      m.scale.set(s * 1.3, s, s * 1.2);
      m.castShadow = false;
    }
  }

  private buildShadows(): void {
    if (!this.shadows.length) return;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,20,0,0.7)');
    grad.addColorStop(0.55, 'rgba(0,20,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = this.track(new THREE.CanvasTexture(c));
    const quads = this.shadows.map(([x, z, r]) => {
      const q = new THREE.PlaneGeometry(r * 2.2, r * 2.2).rotateX(-Math.PI / 2);
      // offset away from the sun (which shines from -x, +z)
      q.translate(x + r * 0.25, this.height(x, z) + 0.05, z - r * 0.2);
      return q;
    });
    const geo = this.track(mergeGeometries(quads)!);
    for (const q of quads) q.dispose();
    const mat = this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  private scatterProps(): void {
    const t = this.theme;
    const rand = seededRandom('props-' + t.id);
    const totalWeight = t.props.reduce((a, p) => a + p.weight, 0);
    const count = this.quality === 'high' ? 22 : 12;
    const placed: THREE.Vector3[] = [];
    let attempts = 0;
    while (placed.length < count && attempts++ < count * 30) {
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
      const x = (rand() - 0.5) * 50;
      const z = (rand() - 0.5) * 66;
      const edge = this.outside(x, z);
      if (edge < (ref.far ? 9 : 2.2)) continue;
      if (z * this.ownSide > 16.4 && Math.abs(x) < 12.5) continue;
      const pos = new THREE.Vector3(x, this.height(x, z) - 0.05, z);
      if (placed.some((p) => p.distanceTo(pos) < (ref.far ? 6 : 2.4))) continue;
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
        new THREE.MeshLambertMaterial({
          color: this.theme.id === 'frost' ? 0xbfe8ff : 0xb48cff,
          emissive: this.theme.id === 'frost' ? 0x3aa0ff : 0x7a3cff,
          emissiveIntensity: 0.6,
          flatShading: true,
        }),
      );
      for (let i = 0; i < 18; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        const x = side * (11 + rand() * 9);
        const z = (rand() - 0.5) * 50;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, this.height(x, z) + 0.4, z);
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
    if (this.water) this.water.uniforms.uTime.value = this.extrasTime;
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
