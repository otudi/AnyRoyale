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
/** River extent outside the field (world units from the centre): spring behind, waterfall in front. */
const RIVER_FAR = 30;
const RIVER_NEAR = 13.6;
/** Height of the ledge in the foreground the river falls over. */
const CLIFF_DROP = 2.6;
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
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uFlow;
uniform float uHalfWidth;
uniform float uDetail;
varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
void main() {
  // world space: x runs along the river (flowing towards +uFlow), z across it
  vec2 p = vec2(vW.x * uFlow, vW.z);
  float edge = clamp(abs(vW.z) / uHalfWidth, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 1.0, edge));
  float t = uTime;
  vec2 q = p * vec2(1.25, 2.3);
  float c = sin(q.x * 2.1 + t * 1.3 + sin(q.y * 3.0 + t) * 1.2);
  c += sin(q.x * 1.3 - t * 0.9 + q.y * 2.7 + sin(q.x * 0.7 - t * 0.5) * 1.5);
  c += sin((q.x + q.y) * 1.7 + t * 1.7);
  c /= 3.0;
  col += smoothstep(0.5, 0.95, c) * 0.2 * uDetail;
  float streak = smoothstep(0.93, 1.0, sin(p.x * 0.9 - t * 1.6 + sin(p.y * 4.0 + p.x * 0.3) * 0.8) * 0.5 + 0.5);
  col += streak * (1.0 - edge) * 0.16;
  float foam = smoothstep(0.74, 1.0, edge + 0.07 * sin(p.x * 3.1 + t * 2.0) + 0.04 * sin(p.x * 7.3 - t * 3.0));
  col = mix(col, uFoam, foam * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const FALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uFoam;
varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = vW.z * 3.1 + sin(vW.z * 1.7) * 0.6;
  float s1 = smoothstep(0.55, 1.0, sin(vW.y * 2.6 + uTime * 6.0 + sin(a) * 2.0) * 0.5 + 0.5);
  float s2 = smoothstep(0.7, 1.0, sin(vW.y * 4.3 + uTime * 8.5 + a * 1.3) * 0.5 + 0.5);
  vec3 col = mix(uShallow, uFoam, clamp(s1 * 0.55 + s2 * 0.45, 0.0, 1.0));
  gl_FragColor = vec4(col, 0.92);
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
  private pond: THREE.ShaderMaterial | null = null;
  private falls: THREE.ShaderMaterial[] = [];
  private particles: THREE.Points[] = [];
  private extrasTime = 0;
  private readonly look: Scenery;
  /** Shared vertex-coloured material for every procedural scenery piece (one draw call). */
  private readonly nature: THREE.MeshLambertMaterial;
  private readonly px: number;
  /** Soft contact shadows under scenery [x, z, radius] (phones have no shadow map). */
  private shadows: [number, number, number][] = [];
  /** Stadium crowd (instanced) and its idle bounce. */
  private crowd: { meshes: THREE.InstancedMesh[]; base: Float32Array; phase: Float32Array } | null = null;
  private fires: THREE.Object3D[] = [];
  private banners: THREE.Mesh[] = [];

  constructor(
    private readonly theme: ArenaTheme,
    private readonly quality: 'high' | 'low',
    /** +1 when this player's own side is at +z (blue), -1 otherwise: banners show team colours. */
    private readonly ownSide: 1 | -1 = 1,
    /** The player's quality setting (crowd size, water detail). */
    private readonly tier: 'low' | 'medium' | 'high' = 'high',
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
    this.buildStadium();
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

    // 1. plain turf with very faint mowing stripes across the field (no checkerboard: the lanes
    //    and the troops are what the eye should follow)
    g.fillStyle = hex(t.grassA);
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let ty = 0; ty < 32; ty += 2) {
      g.fillStyle = 'rgba(255,255,230,0.035)';
      g.fillRect(0, ty * px, canvas.width, px);
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
      const base = t.grassA;
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

  /** +1 when the camera (and the player's near touchline) is on the +x side of the arena. */
  private get camSign(): number {
    return this.ownSide;
  }

  private waterMaterial(halfWidth: number, detail: number): THREE.ShaderMaterial {
    const t = this.theme;
    return this.track(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uShallow: { value: new THREE.Color(mix(t.water, 0xffffff, 0.12)) },
            uDeep: { value: new THREE.Color(t.waterDeep) },
            uFoam: { value: new THREE.Color(0xf4fbff) },
            uFlow: { value: this.camSign },
            uHalfWidth: { value: halfWidth },
            uDetail: { value: detail },
          },
        ]),
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        fog: true,
      }),
    );
  }

  /**
   * The river runs across the whole scene: it springs from rocks in the background (far side),
   * crosses the field under both bridges, leaves past the near touchline in a channel and drops
   * over a small waterfall into a pond in the foreground. The water always flows the same way.
   */
  private buildRiver(): void {
    const t = this.theme;
    const stone = this.look.stone;
    const c = this.camSign;
    const detail = this.tier === 'high' ? 1 : this.tier === 'medium' ? 0.7 : 0.35;
    // Stone channel walls inside the field and a dark bed along the whole river
    const brick = this.brickTexture(stone, 512, 64, 2);
    brick.repeat.set(9, 1);
    const wallMat = this.track(new THREE.MeshLambertMaterial({ map: brick }));
    for (const z of [1, -1]) {
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(18, 0.66, 0.16)), wallMat);
      wall.position.set(0, -0.31, z);
      wall.receiveShadow = true;
      this.root.add(wall);
    }
    const far = -c * RIVER_FAR;
    const near = c * RIVER_NEAR;
    const len = RIVER_FAR + RIVER_NEAR;
    const mid = (far + near) / 2;
    const bed = new THREE.Mesh(this.track(new THREE.PlaneGeometry(len, 2.3).rotateX(-Math.PI / 2)), this.track(new THREE.MeshLambertMaterial({ color: t.waterDeep })));
    bed.position.set(mid, -0.64, 0);
    this.root.add(bed);

    // Animated water: one surface from the spring to the lip of the waterfall
    this.water = this.waterMaterial(1.0, detail);
    const water = new THREE.Mesh(this.track(new THREE.PlaneGeometry(len, 2, 1, 1).rotateX(-Math.PI / 2)), this.water);
    water.position.set(mid, -0.2, 0);
    water.userData.dynamic = true;
    this.root.add(water);

    // waterfall over the ledge, then a pond below
    const fallMat = this.track(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uTime: { value: 0 }, uShallow: { value: new THREE.Color(mix(t.water, 0xffffff, 0.25)) }, uFoam: { value: new THREE.Color(0xffffff) } },
        ]),
        vertexShader: WATER_VERT,
        fragmentShader: FALL_FRAG,
        fog: true,
        transparent: true,
      }),
    );
    this.falls.push(fallMat);
    const fallH = 0.2 + CLIFF_DROP - 0.3;
    const fall = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2, fallH)), fallMat);
    fall.position.set(near + c * 0.05, -0.2 - fallH / 2, 0);
    fall.rotation.y = c > 0 ? Math.PI / 2 : -Math.PI / 2;
    fall.userData.dynamic = true;
    this.root.add(fall);
    this.pond = this.waterMaterial(3.2, detail);
    const pond = new THREE.Mesh(this.track(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)), this.pond);
    pond.scale.set(4.2, 1, 3.2);
    pond.position.set(near + c * 3.6, -CLIFF_DROP + 0.12, 0);
    pond.userData.dynamic = true;
    this.root.add(pond);
    // a second little spring fall at the source, between big rocks
    const spring = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2, 1.9)), fallMat);
    spring.position.set(far - c * 0.05, 0.75, 0);
    spring.rotation.y = c > 0 ? Math.PI / 2 : -Math.PI / 2;
    spring.userData.dynamic = true;
    this.root.add(spring);

    const rand = seededRandom('banks' + t.id);
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const rockAt = (x: number, z: number, sz: number, y = 0.02) => {
      const m = this.add(colored(rock, (_x, yy, _z, ny) => this.stoneColor(rand, yy > 0.3 && ny > 0.5)), x, y, z, rand() * 3);
      m.scale.set(sz * (1 + rand() * 0.6), sz * 0.75, sz);
      m.castShadow = sz > 0.6 && this.quality === 'high';
      this.shadows.push([x, z, sz * 0.9]);
      return m;
    };
    // small rocks along the banks inside the field (away from the bridges)
    for (const z of [1.02, -1.02]) {
      for (let x = -8.7; x < 8.8; x += 0.5 + rand() * 0.35) {
        if (Math.abs(Math.abs(x) - 5.5) < 1.9) continue;
        rockAt(x, z + (rand() - 0.5) * 0.12, 0.1 + rand() * 0.1).castShadow = false;
      }
    }
    // rocky banks outside the field, bigger towards the spring; big boulders frame the source
    for (const side of [1, -1]) {
      for (let k = 10.5; k < RIVER_FAR; k += 0.9 + rand() * 0.6) {
        const sz = 0.3 + (k / RIVER_FAR) * 0.9 + rand() * 0.3;
        rockAt(-c * k, side * (1.35 + sz * 0.5 + rand() * 0.3), sz, -0.1);
      }
      for (let k = 10.2; k < RIVER_NEAR; k += 0.8 + rand() * 0.5) {
        rockAt(c * k, side * (1.3 + rand() * 0.3), 0.25 + rand() * 0.25, -0.15);
      }
      rockAt(far - c * 1.2, side * 1.8, 2.2, 0.4);
      rockAt(far - c * 2.4, side * 0.9, 2.0, 1.2);
      rockAt(near + c * 0.2, side * 1.6, 0.8, -0.3);
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI;
        rockAt(near + c * (3.6 + Math.cos(a) * 4.4), side * Math.sin(a) * 3.4, 0.35 + rand() * 0.4, -CLIFF_DROP + 0.1);
      }
    }
    // reeds where the river meets the field
    const reed = new THREE.ConeGeometry(0.035, 0.6, 4);
    for (let i = 0; i < 30; i++) {
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

  /**
   * The field's edge: a low stone curb (ankle high, it never hides a troop) and a few scattered
   * bushes and rocks outside it. No wall: the scene stays open around the battle.
   */
  private buildWalls(): void {
    const rand = seededRandom('curb' + this.theme.id);
    const block = new THREE.BoxGeometry(1, 1, 1);
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      let d = 0;
      while (d < len) {
        const bl = Math.min(len - d, 0.6 + rand() * 0.5);
        const mid = d + bl / 2;
        const m = this.add(colored(block, (_x, y) => this.stoneColor(rand, false) + (y > 0.3 ? 0 : 0)), x0 + dx * mid, 0.06, z0 + dz * mid, Math.atan2(dx, dz) + (rand() - 0.5) * 0.05);
        m.scale.set(0.34, 0.16 + rand() * 0.04, bl - 0.04);
        m.castShadow = false;
        d += bl;
      }
    };
    // long sides: leave the river mouth open
    for (const sx of [-1, 1]) {
      run(sx * 9.25, -16.25, sx * 9.25, -1.2);
      run(sx * 9.25, 1.2, sx * 9.25, 16.25);
    }
    run(-9.25, 16.25, 9.25, 16.25);
    run(-9.25, -16.25, 9.25, -16.25);
    // a few bushes and stones just outside the curb (never in the near foreground)
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const leaf = (k: number) => mix(this.look.foliage[0], this.look.foliage[1], k);
    for (let i = 0; i < (this.quality === 'high' ? 26 : 14); i++) {
      const sideX = rand() < 0.5;
      const x = sideX ? -this.camSign * (9.9 + rand() * 1.4) : (rand() - 0.5) * 18;
      const z = sideX ? (rand() - 0.5) * 32 : (rand() < 0.5 ? -1 : 1) * (16.9 + rand() * 1.3);
      if (Math.abs(z) < 2.2) continue; // river
      if (rand() < 0.6) {
        const sz = 0.25 + rand() * 0.25;
        const base = leaf(rand());
        const m = this.add(colored(ico, (_x, y, _z, ny) => (this.look.snow && ny > 0.4 && y > 0 ? 0xf4f8fc : shade(base, 0.85 + (y + 1) * 0.12))), x, sz * 0.4, z, rand() * 3);
        m.scale.set(sz * 1.3, sz, sz * 1.2);
        m.castShadow = false;
      } else {
        const sz = 0.18 + rand() * 0.2;
        const m = this.add(colored(rock, (_x, y, _z, ny) => this.stoneColor(rand, y > 0.2 && ny > 0.4)), x, sz * 0.2, z, rand() * 3);
        m.scale.set(sz * 1.3, sz * 0.7, sz);
        m.castShadow = false;
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
    // flat inside the stadium zone, rolling hills beyond
    let h = smoothstep(7.5, 16, d) * (0.6 + n * 2.6) + Math.max(0, d - 26) * 0.35;
    const along = x * this.camSign; // towards the camera / player
    // foreground: a ledge drops to a lower meadow (the river falls over it)
    const drop = smoothstep(RIVER_NEAR - 0.1, RIVER_NEAR + 0.7, along);
    h = h * (1 - drop) + (-CLIFF_DROP + n * 0.4) * drop;
    // the river's channel outside the field, from the spring to the ledge
    if (Math.abs(x) > 8.9 && along > -RIVER_FAR - 1 && along < RIVER_NEAR + 0.2) {
      const cut = 1 - smoothstep(1.15, 2.1, Math.abs(z));
      h = h * (1 - cut) + -0.66 * cut;
    }
    return h;
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
    const ax = 9.0; // meets the field floor (the curb hides the seam)
    const az = 16.0;
    const pieces: [number, number, number, number][] = [
      [-W / 2, -ax, -H / 2, H / 2],
      [ax, W / 2, -H / 2, H / 2],
      [-ax, ax, az, H / 2],
      [-ax, ax, -H / 2, -az],
    ];
    const col = new THREE.Color();
    for (const [x0, x1, z0, z1] of pieces) {
      const sx = Math.max(2, Math.round((x1 - x0) / (this.quality === 'high' ? 1.0 : 1.6)));
      const sz = Math.max(2, Math.round((z1 - z0) / (this.quality === 'high' ? 1.0 : 1.6)));
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

  // ------------------------------------------------------------------ stadium

  /**
   * A single stand far behind the arena (on the side opposite the camera), split by the river:
   * a few tiers of calm, sparse spectators in muted team colours, a few banners and braziers, and a
   * ring of mountains on the horizon. Nothing in the foreground or at the sides: the battle stays
   * the focus and nothing ever covers the lanes.
   */
  private buildStadium(): void {
    const rand = seededRandom('stand' + this.theme.id);
    const block = new THREE.BoxGeometry(1, 1, 1);
    const stone = (k = 1) => shade(this.look.stone, k);
    const own = 0x5a86c8; // muted team colours: the spectators are scenery, not units
    const enemy = 0xc06a6a;
    const teamAt = (z: number) => (z * this.ownSide >= 0 ? own : enemy);
    const far = -this.camSign;
    const TIERS = 3;
    const STEP_D = 1.2;
    const STEP_H = 0.55;
    const INNER = 16.5; // distance of the first tier from the arena centre line
    const seats: [number, number, number][] = [];
    const runs: [number, number][] = [
      [-21, -3.4],
      [3.4, 21],
    ];
    for (const [from, to] of runs) {
      const len = to - from;
      const mid = (from + to) / 2;
      for (let t = 0; t < TIERS; t++) {
        const top = STEP_H * (t + 1);
        const c = INNER + STEP_D * (t + 0.5);
        const m = this.add(colored(block, (_x, y) => (y > 0.45 ? stone(0.98 + t * 0.03) : stone(0.8))), far * c, (top - 1) / 2, mid);
        m.scale.set(STEP_D, top + 1, len);
        m.castShadow = false;
        for (let p = from + 0.5; p < to - 0.4; p += 1.0 + rand() * 0.5) {
          if (rand() < 0.35) continue; // gaps: a calm, not packed, crowd
          seats.push([far * (c + (rand() - 0.5) * 0.3), top, p]);
        }
      }
      const wallC = INNER + STEP_D * TIERS + 0.35;
      const wallH = STEP_H * TIERS + 1.0;
      const wall = this.add(colored(block, (_x, y) => (y > 0.4 ? stone(1.0) : stone(0.84))), far * wallC, (wallH - 1) / 2, mid);
      wall.scale.set(0.7, wallH + 1, len + 0.6);
      wall.castShadow = false;
      for (let p = from; p <= to; p += 1.3) {
        const m = this.add(colored(block, () => stone(1.08)), far * wallC, wallH + 0.22, p);
        m.scale.set(0.7, 0.44, 0.65);
        m.castShadow = false;
      }
      // banners and braziers along the top
      for (let p = from + 2; p < to - 1; p += 6) {
        this.banner(far * wallC, wallH, p, teamAt(p) === own ? 'own' : 'enemy');
        this.brazier(far * wallC, wallH, p + 3);
      }
    }
    if (this.quality !== 'low') this.buildCrowd(seats, teamAt, rand);
    this.buildMountains(rand);
  }

  private crestMats: Record<'own' | 'enemy', THREE.MeshLambertMaterial> | null = null;
  private flameMat: THREE.SpriteMaterial | null = null;

  private banner(x: number, wallTop: number, z: number, team: 'own' | 'enemy'): void {
    if (!this.crestMats) {
      this.crestMats = { own: this.crest(0x2f6fc8), enemy: this.crest(0xc83a3a) };
    }
    const pole = this.add(colored(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), () => 0x5a3a20), x, wallTop + 1.6, z, 0);
    pole.scale.y = 3.2;
    pole.castShadow = false;
    const b = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.1, 2.1)), this.crestMats[team]);
    b.position.set(x + this.camSign * 0.1, wallTop + 1.9, z);
    b.rotation.y = this.camSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    b.userData.dynamic = true;
    b.userData.phase = z;
    this.root.add(b);
    this.banners.push(b);
  }

  private brazier(x: number, wallTop: number, z: number): void {
    this.add(colored(new THREE.CylinderGeometry(0.34, 0.2, 0.38, 8), () => 0x3a3236), x, wallTop + 0.6, z, 0).castShadow = false;
    if (!this.flameMat) this.flameMat = this.track(new THREE.SpriteMaterial({ map: this.flameTexture(), depthWrite: false, transparent: true }));
    const f = new THREE.Sprite(this.flameMat);
    f.position.set(x, wallTop + 1.15, z);
    f.scale.set(0.9, 1.3, 1);
    f.userData.dynamic = true;
    f.userData.phase = z;
    this.root.add(f);
    this.fires.push(f);
  }

  private crest(color: number): THREE.MeshLambertMaterial {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = hex(color);
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#ffd24a';
    g.fillRect(0, 14, 128, 6);
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(0, 256);
    g.lineTo(64, 214);
    g.lineTo(128, 256);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(36, 70);
    g.lineTo(92, 70);
    g.lineTo(92, 118);
    g.quadraticCurveTo(92, 156, 64, 172);
    g.quadraticCurveTo(36, 156, 36, 118);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd24a';
    g.beginPath();
    g.moveTo(48, 64);
    g.lineTo(48, 46);
    g.lineTo(56, 56);
    g.lineTo(64, 40);
    g.lineTo(72, 56);
    g.lineTo(80, 46);
    g.lineTo(80, 64);
    g.closePath();
    g.fill();
    const t = this.track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return this.track(new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }));
  }

  /** Spectators: two instanced meshes (bodies tinted per fan, heads), gently bobbing. */
  private buildCrowd(seats: [number, number, number][], teamAt: (z: number) => number, rand: () => number): void {
    const body = new THREE.CylinderGeometry(0.15, 0.2, 0.42, 6);
    body.translate(0, 0.21, 0);
    const head = new THREE.IcosahedronGeometry(0.13, 0);
    head.translate(0, 0.56, 0);
    const count = Math.min(seats.length, this.tier === 'high' ? 260 : 130);
    const bodies = new THREE.InstancedMesh(this.track(body), this.track(new THREE.MeshLambertMaterial({ color: 0xffffff })), count);
    const heads = new THREE.InstancedMesh(this.track(colored(head, (_x, y) => (y > 0.62 ? 0x4a3020 : 0xe8c4a0))), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), count);
    const base = new Float32Array(count * 4);
    const phase = new Float32Array(count);
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const face = this.camSign > 0 ? Math.PI / 2 : -Math.PI / 2; // looking at the field
    const pick = seats.slice().sort(() => rand() - 0.5).slice(0, count);
    pick.forEach(([x, y, z], i) => {
      tmp.position.set(x, y, z);
      tmp.rotation.set(0, face + (rand() - 0.5) * 0.5, 0);
      tmp.updateMatrix();
      bodies.setMatrixAt(i, tmp.matrix);
      heads.setMatrixAt(i, tmp.matrix);
      base.set([x, y, z, tmp.rotation.y], i * 4);
      phase[i] = rand() * Math.PI * 2;
      const r = rand();
      col.setHex(r < 0.6 ? teamAt(z) : r < 0.8 ? 0xd8d4c8 : 0x8a7a68);
      bodies.setColorAt(i, col);
    });
    for (const m of [bodies, heads]) {
      m.userData.dynamic = true;
      m.castShadow = false;
      m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
    this.crowd = { meshes: [bodies, heads], base, phase };
  }

  private flameTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 96;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 66, 2, 32, 58, 34);
    grad.addColorStop(0, 'rgba(255,250,200,1)');
    grad.addColorStop(0.35, 'rgba(255,190,60,0.95)');
    grad.addColorStop(0.7, 'rgba(255,90,20,0.55)');
    grad.addColorStop(1, 'rgba(255,40,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(32, 2);
    g.bezierCurveTo(52, 40, 62, 60, 50, 84);
    g.quadraticCurveTo(32, 98, 14, 84);
    g.bezierCurveTo(2, 60, 12, 40, 32, 2);
    g.fill();
    const t = this.track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** A ring of low-poly mountains far behind the stadium (fades into the fog). */
  private buildMountains(rand: () => number): void {
    const cone = new THREE.ConeGeometry(1, 1, 7);
    const rock = this.look.snow ? 0x8a9aae : shade(mix(this.look.stone, this.look.ground[1], 0.5), 0.75);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
      const r = 72 + rand() * 22;
      const h = 14 + rand() * 18;
      const w = 12 + rand() * 10;
      const snowLine = 0.5 - (this.look.snow ? 0.25 : 0);
      const m = this.add(colored(cone, (_x, y) => (y > snowLine - 0.5 + 0.18 ? 0xf2f6fa : shade(rock, 0.85 + (y + 0.5) * 0.3))), Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r * 1.2, rand() * 3);
      m.scale.set(w, h, w * (0.8 + rand() * 0.4));
      m.castShadow = false;
      m.receiveShadow = false;
    }
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

    // keep the foreground open, the river channel clear and the far stand unobstructed
    const nearCamera = (x: number, z: number) => {
      const along = x * this.camSign;
      return along > 8.5 || Math.abs(z) < 3 || (along < -14 && along > -23 && Math.abs(z) < 23);
    };
    // trees: dense near the walls, thinning out with distance
    const trees = high ? 150 : 85;
    let placed = 0;
    const spots: [number, number, number][] = [];
    for (let tries = 0; placed < trees && tries < trees * 30; tries++) {
      const x = (rand() - 0.5) * 70;
      const z = (rand() - 0.5) * 96;
      const d = this.outside(x, z);
      if (d < 4 || d > 32) continue;
      if (nearCamera(x, z)) continue;
      if (rand() > 1.25 - d / 32) continue; // denser close by
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
      if (d < 5 || nearCamera(x, z)) continue;
      const s = 0.3 + rand() * 0.6;
      const m = this.add(colored(ico, (_x, y, _z, ny) => this.stoneColor(rand, y > 0.2 && ny > 0.4)), x, this.height(x, z) + s * 0.25, z, rand() * 3);
      m.scale.set(s * (1 + rand() * 0.6), s * 0.7, s);
      this.shadows.push([x, z, s * 1.3]);
    }
    // bushes hugging the outside of the walls
    for (let i = 0; i < (high ? 22 : 12); i++) {
      const side = Math.floor(rand() * 4);
      const along = (rand() - 0.5) * 2;
      const x = side < 2 ? (side ? 1 : -1) * (10.25 + rand() * 0.8) : along * 10.5;
      const z = side < 2 ? along * 17 : (side === 2 ? 1 : -1) * (17.25 + rand() * 0.6);
      if (nearCamera(x, z)) continue;
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
      if (edge < (ref.far ? 12 : 8.5)) continue;
      if (x * this.camSign > 8.5 || Math.abs(z) < 3 || (x * this.camSign < -14 && x * this.camSign > -23)) continue;
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
    const t = this.extrasTime;
    if (this.water) this.water.uniforms.uTime.value = t;
    if (this.pond) this.pond.uniforms.uTime.value = t;
    for (const f of this.falls) f.uniforms.uTime.value = t;
    for (const f of this.fires) {
      const k = 1 + Math.sin(t * 13 + f.userData.phase) * 0.08 + Math.sin(t * 7.3 + f.userData.phase * 2) * 0.06;
      f.scale.set(0.9 * k, 1.3 * (2 - k), 1);
    }
    for (const b of this.banners) b.rotation.z = Math.sin(t * 1.6 + b.userData.phase) * 0.035;
    if (this.crowd && Math.floor(t * 30) % 2 === 0) {
      // the fans bob and turn a little: the stands feel alive
      const { meshes, base, phase } = this.crowd;
      const mesh = meshes[0];
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const p = new THREE.Vector3();
      const sc = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < mesh.count; i++) {
        const ph = phase[i];
        const jump = Math.max(0, Math.sin(t * 2.2 + ph)) * 0.05;
        p.set(base[i * 4], base[i * 4 + 1] + jump, base[i * 4 + 2]);
        q.setFromEuler(e.set(0, base[i * 4 + 3] + Math.sin(t * 0.7 + ph) * 0.25, 0));
        m.compose(p, q, sc);
        for (const im of meshes) im.setMatrixAt(i, m);
      }
      for (const im of meshes) im.instanceMatrix.needsUpdate = true;
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
