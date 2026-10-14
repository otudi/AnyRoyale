import * as THREE from 'three';
import type { CardInfo } from '../network/protocol';
import type { Renderer3D } from './Renderer3D';
import { UnitVisual } from './UnitFactory';
import { visualFor } from './visualCatalog';

/**
 * Finished card images (all original, generated at runtime): a rarity-coloured metallic frame
 * with bevel, gloss and corner gems, a radiant background, and either the unit's 3D model
 * (three-point lit, rendered with transparency onto the background) or a painted spell emblem.
 * Cached as data URLs; used by the hand, the Cards page and the match intro.
 */

const W = 240;
const H = 300;
const R = 24; // corner radius
const BORDER = 13;

interface Look {
  /** frame metal: highlight, mid, shadow, rim */
  metal: [string, string, string, string];
  /** background radial: centre, edge */
  bg: [string, string];
  gems: boolean;
}

const LOOKS: Record<string, Look> = {
  COMMON: { metal: ['#ffffff', '#b8c9e2', '#5a7196', '#dfe9f7'], bg: ['#6fb0ff', '#173a7e'], gems: false },
  RARE: { metal: ['#fff4cf', '#f5b84a', '#94520c', '#ffe08a'], bg: ['#ffb45e', '#6b2c0b'], gems: false },
  EPIC: { metal: ['#fbe8ff', '#c47df3', '#4f1a86', '#ecc8ff'], bg: ['#c891ff', '#331063'], gems: true },
  LEGENDARY: { metal: ['#f2fffd', '#7ff0e0', '#2b6d8f', '#ffe08a'], bg: ['#7fe8ff', '#0f3352'], gems: true },
  CHAMPION: { metal: ['#fff6d6', '#ffd451', '#8a5a00', '#fff0a8'], bg: ['#ffe27a', '#4a2a00'], gems: true },
};

function lookFor(card: CardInfo): Look {
  return LOOKS[card.rarity] ?? LOOKS.COMMON;
}

export class CardArt {
  private cache = new Map<string, string>();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 60);
  private target: THREE.WebGLRenderTarget;

  constructor(private readonly r: Renderer3D) {
    this.target = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    // Three-point lighting: warm key, cool rim from behind, soft fill.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3550, 1.5));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(2.5, 4, 5);
    const rim = new THREE.DirectionalLight(0xcfe6ff, 3.4);
    rim.position.set(-3.5, 3, -4.5);
    const rim2 = new THREE.DirectionalLight(0xffe6c0, 1.6);
    rim2.position.set(3.5, 2, -4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-2, 0.5, 4);
    this.scene.add(key, rim, rim2, fill);
  }

  get(card: CardInfo): string {
    const hit = this.cache.get(card.id);
    if (hit) return hit;
    let url: string;
    try {
      url = compose(card, card.type === 'SPELL' || !card.unit ? null : this.renderUnit(card));
    } catch (e) {
      console.warn('Card art failed for', card.id, e);
      url = compose(card, null);
    }
    this.cache.set(card.id, url);
    return url;
  }

  /** The unit model on a transparent background, as a canvas. */
  private renderUnit(card: CardInfo): HTMLCanvasElement {
    const unit = card.unit!;
    const visual = new UnitVisual(visualFor(unit.name, card.type === 'BUILDING' ? 'B' : 'T', unit.movement === 'AIR' ? 1 : 0, unit.radius), 'own');
    visual.update(0.016, 0, { frozen: false });
    this.scene.add(visual.root);
    visual.root.rotation.y = 0.55;
    const box = new THREE.Box3().setFromObject(visual.root);
    const height = Math.max(0.6, box.max.y - box.min.y);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const centre = box.getCenter(new THREE.Vector3());
    const half = THREE.MathUtils.degToRad(14);
    // fill most of the card; slightly low camera for a heroic look
    const dist = Math.max((height * 1.02) / (2 * Math.tan(half)), (width * 1.05) / (2 * Math.tan(half) * (W / H)));
    this.camera.position.set(centre.x, centre.y - height * 0.04, centre.z + dist);
    this.camera.lookAt(centre.x, centre.y + height * 0.04, centre.z);
    this.camera.updateProjectionMatrix();
    this.scene.background = null;
    const gl = this.r.renderer;
    const prevTarget = gl.getRenderTarget();
    const prevShadow = gl.shadowMap.enabled;
    const prevClear = gl.getClearColor(new THREE.Color());
    const prevAlpha = gl.getClearAlpha();
    gl.shadowMap.enabled = false;
    gl.setRenderTarget(this.target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(this.scene, this.camera);
    const pixels = new Uint8Array(W * H * 4);
    gl.readRenderTargetPixels(this.target, 0, 0, W, H, pixels);
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);
    gl.shadowMap.enabled = prevShadow;
    this.scene.remove(visual.root);
    visual.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      img.data.set(pixels.subarray(src, src + W * 4), y * W * 4);
    }
    // render target alpha is premultiplied-ish after tone mapping; un-premultiply soft edges
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a > 0 && a < 255) {
        const k = 255 / a;
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  dispose(): void {
    this.target.dispose();
  }
}

// --- composition ---------------------------------------------------------------------------------

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function compose(card: CardInfo, portrait: HTMLCanvasElement | null): string {
  const look = lookFor(card);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.save();
  roundRect(g, 0, 0, W, H, R);
  g.clip();

  // 1. radiant background (spells use their own colours)
  const [centre, edge] = card.type === 'SPELL' ? spellPalette(card.id) : look.bg;
  const bg = g.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.45, H * 0.75);
  bg.addColorStop(0, centre);
  bg.addColorStop(1, edge);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // light rays
  g.save();
  g.translate(W / 2, H * 0.42);
  g.globalCompositeOperation = 'overlay';
  for (let i = 0; i < 18; i++) {
    g.rotate((Math.PI * 2) / 18);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-14, -H);
    g.lineTo(14, -H);
    g.closePath();
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
    g.fill();
  }
  g.restore();
  // soft halo behind the subject
  const halo = g.createRadialGradient(W / 2, H * 0.45, 4, W / 2, H * 0.45, W * 0.55);
  halo.addColorStop(0, 'rgba(255,255,255,0.45)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);

  // 2. subject
  if (portrait) {
    // contact shadow
    const sh = g.createRadialGradient(W / 2, H * 0.86, 4, W / 2, H * 0.86, W * 0.4);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(W / 2, H * 0.86, W * 0.4, H * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    g.drawImage(portrait, 0, 0);
  } else {
    g.save();
    g.translate(W / 2, H * 0.47);
    drawSpell(g, card.id);
    g.restore();
  }

  // 3. bottom shade + top gloss
  const shade = g.createLinearGradient(0, H * 0.62, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const gloss = g.createLinearGradient(0, 0, W * 0.6, H * 0.45);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.06)');
  gloss.addColorStop(0.46, 'rgba(255,255,255,0)');
  g.fillStyle = gloss;
  g.fillRect(0, 0, W, H);
  if (card.rarity === 'LEGENDARY') sparkles(g);
  g.restore();

  // 4. metallic frame with bevel
  const [hi, mid, lo, rim] = look.metal;
  const metal = g.createLinearGradient(0, 0, W, H);
  if (card.rarity === 'LEGENDARY') {
    // iridescent crystal
    metal.addColorStop(0, '#f6fffd');
    metal.addColorStop(0.2, '#82f2e4');
    metal.addColorStop(0.45, '#b58cff');
    metal.addColorStop(0.7, '#ffd77a');
    metal.addColorStop(1, '#6fe0ff');
  } else {
    metal.addColorStop(0, hi);
    metal.addColorStop(0.3, mid);
    metal.addColorStop(0.55, lo);
    metal.addColorStop(0.75, mid);
    metal.addColorStop(1, rim);
  }
  g.lineWidth = BORDER;
  g.strokeStyle = metal;
  roundRect(g, BORDER / 2, BORDER / 2, W - BORDER, H - BORDER, R - BORDER / 2);
  g.stroke();
  // inner dark groove
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(10,14,30,0.6)';
  roundRect(g, BORDER + 1, BORDER + 1, W - 2 * BORDER - 2, H - 2 * BORDER - 2, R - BORDER);
  g.stroke();
  // outer highlight and outline
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  roundRect(g, 3, 3, W - 6, H - 6, R - 3);
  g.stroke();
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(8,10,24,0.85)';
  roundRect(g, 1.25, 1.25, W - 2.5, H - 2.5, R - 1);
  g.stroke();
  // top plaque
  plaque(g, metal);
  if (look.gems) {
    gem(g, BORDER + 6, BORDER + 6, card.rarity === 'LEGENDARY' ? '#9ff7ff' : '#e9a8ff');
    gem(g, W - BORDER - 6, BORDER + 6, card.rarity === 'LEGENDARY' ? '#ffe28a' : '#e9a8ff');
  }
  return c.toDataURL('image/png');
}

function plaque(g: CanvasRenderingContext2D, metal: CanvasGradient): void {
  // small crest at the bottom centre of the frame
  g.save();
  g.translate(W / 2, H - BORDER / 2);
  g.beginPath();
  g.moveTo(-26, -6);
  g.quadraticCurveTo(0, -18, 26, -6);
  g.lineTo(18, 6);
  g.quadraticCurveTo(0, 0, -18, 6);
  g.closePath();
  g.fillStyle = metal;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(8,10,24,0.85)';
  g.stroke();
  g.restore();
}

function gem(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(Math.PI / 4);
  const grad = g.createLinearGradient(-7, -7, 7, 7);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, '#2a1250');
  g.fillStyle = grad;
  g.fillRect(-7, -7, 14, 14);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(8,10,24,0.85)';
  g.strokeRect(-7, -7, 14, 14);
  g.restore();
}

function sparkles(g: CanvasRenderingContext2D): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = 20 + rnd() * (W - 40);
    const y = 20 + rnd() * (H * 0.6);
    const s = 2 + rnd() * 4;
    g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
    g.beginPath();
    g.moveTo(x, y - s * 2);
    g.lineTo(x + s * 0.5, y);
    g.lineTo(x, y + s * 2);
    g.lineTo(x - s * 0.5, y);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x - s * 2, y);
    g.lineTo(x, y + s * 0.5);
    g.lineTo(x + s * 2, y);
    g.lineTo(x, y - s * 0.5);
    g.closePath();
    g.fill();
  }
}

// --- spell emblems ---------------------------------------------------------------------------------

function spellPalette(id: string): [string, string] {
  const p: Record<string, [string, string]> = {
    fireball: ['#ffcf6a', '#8a1c0c'],
    arrows: ['#e9f1ff', '#3d5478'],
    zap: ['#bdf0ff', '#14407e'],
    freeze: ['#f0fbff', '#2f7ab8'],
    poison: ['#d8ff8a', '#2a5a18'],
    rage: ['#f0b8ff', '#4a1278'],
    rocket: ['#ffd9a0', '#7a2a14'],
    lightning: ['#fff8b8', '#2a3478'],
    log: ['#f2d8a0', '#5a3418'],
    barblog: ['#f2d8a0', '#5a3418'],
    tornado: ['#eef4fa', '#3e5068'],
    graveyard: ['#b8c8d8', '#18202e'],
    goblinbarrel: ['#d8f0a0', '#4a3418'],
    clone: ['#b8f8ff', '#16607a'],
    earthquake: ['#f0d0a0', '#4a2c14'],
    heal: ['#fff6c0', '#a07810'],
    mirror: ['#f8f8ff', '#5a5a8a'],
    snowball: ['#ffffff', '#5a88b8'],
    royaldelivery: ['#fff0b0', '#7a4a10'],
    darkmagic: ['#c8a0ff', '#120a30'],
    goblincurse: ['#c8ff98', '#18401c'],
    vines: ['#b8f098', '#1c4a1c'],
  };
  return p[id] ?? ['#d0d8e8', '#3a4a68'];
}

const INK = 'rgba(14,16,34,0.9)';

/** Coordinates are around the card centre; the emblem spans roughly ±85 px. */
function drawSpell(g: CanvasRenderingContext2D, id: string): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // glow behind every emblem
  const glow = g.createRadialGradient(0, 0, 5, 0, 0, 95);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, 95, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 6;
  const fn = EMBLEMS[id] ?? EMBLEMS.default;
  fn(g);
  g.shadowColor = 'transparent';
}

function radial(g: CanvasRenderingContext2D, r: number, stops: [number, string][], x = 0, y = 0): CanvasGradient {
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  return grad;
}

function outline(g: CanvasRenderingContext2D, w = 5): void {
  g.lineWidth = w;
  g.strokeStyle = INK;
  g.stroke();
}

function boltPath(g: CanvasRenderingContext2D, s: number): void {
  g.beginPath();
  g.moveTo(-14 * s, -70 * s);
  g.lineTo(26 * s, -70 * s);
  g.lineTo(4 * s, -12 * s);
  g.lineTo(32 * s, -12 * s);
  g.lineTo(-20 * s, 74 * s);
  g.lineTo(-4 * s, 10 * s);
  g.lineTo(-32 * s, 10 * s);
  g.closePath();
}

function flame(g: CanvasRenderingContext2D, s: number, c1: string, c2: string): void {
  g.beginPath();
  g.moveTo(0, -80 * s);
  g.bezierCurveTo(40 * s, -40 * s, 62 * s, 0, 48 * s, 40 * s);
  g.bezierCurveTo(36 * s, 72 * s, -36 * s, 72 * s, -48 * s, 40 * s);
  g.bezierCurveTo(-62 * s, 0, -30 * s, -30 * s, 0, -80 * s);
  g.closePath();
  const grad = g.createLinearGradient(0, -80 * s, 0, 70 * s);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fill();
}

function arrow(g: CanvasRenderingContext2D, len: number): void {
  // shaft
  g.fillStyle = '#8a5a2c';
  g.fillRect(-4, -len / 2, 8, len);
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(-4, -len / 2, 8, len);
  // head
  g.beginPath();
  g.moveTo(0, len / 2 + 26);
  g.lineTo(-14, len / 2 - 2);
  g.lineTo(14, len / 2 - 2);
  g.closePath();
  const steel = g.createLinearGradient(-14, 0, 14, 0);
  steel.addColorStop(0, '#ffffff');
  steel.addColorStop(1, '#8a98b0');
  g.fillStyle = steel;
  g.fill();
  outline(g, 3);
  // fletching
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, -len / 2 + 22);
    g.lineTo(sx * 16, -len / 2 + 4);
    g.lineTo(sx * 16, -len / 2 - 14);
    g.lineTo(0, -len / 2);
    g.closePath();
    g.fillStyle = '#e8eef8';
    g.fill();
    outline(g, 3);
  }
}

const EMBLEMS: Record<string, (g: CanvasRenderingContext2D) => void> = {
  fireball: (g) => {
    g.save();
    g.rotate(-0.6);
    // tail
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(0, 40 + i * 22, 34 - i * 9, 26 - i * 6, 0, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,${150 - i * 30},40,${0.85 - i * 0.22})`;
      g.fill();
    }
    g.restore();
    g.beginPath();
    g.arc(0, -8, 52, 0, Math.PI * 2);
    g.fillStyle = radial(g, 52, [
      [0, '#fffbe0'],
      [0.35, '#ffd24a'],
      [0.7, '#ff7a1a'],
      [1, '#c2300c'],
    ], 0, -8);
    g.fill();
    outline(g, 5);
  },
  arrows: (g) => {
    g.rotate(0.35);
    for (const [dx, dy] of [
      [-40, 14],
      [0, -10],
      [40, 14],
    ]) {
      g.save();
      g.translate(dx, dy);
      arrow(g, 110);
      g.restore();
    }
  },
  zap: (g) => {
    g.beginPath();
    g.arc(0, 0, 70, 0, Math.PI * 2);
    g.fillStyle = 'rgba(160,230,255,0.35)';
    g.fill();
    boltPath(g, 1);
    const grad = g.createLinearGradient(0, -70, 0, 74);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#7fd8ff');
    g.fillStyle = grad;
    g.fill();
    outline(g, 5);
  },
  lightning: (g) => {
    for (const [dx, s] of [
      [-42, 0.7],
      [42, 0.7],
      [0, 1.05],
    ] as const) {
      g.save();
      g.translate(dx, dx ? 18 : 0);
      boltPath(g, s);
      const grad = g.createLinearGradient(0, -70, 0, 74);
      grad.addColorStop(0, '#fffde8');
      grad.addColorStop(1, '#ffd84a');
      g.fillStyle = grad;
      g.fill();
      outline(g, 4);
      g.restore();
    }
  },
  freeze: (g) => {
    g.strokeStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i * Math.PI) / 3);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -78);
      g.moveTo(0, -48);
      g.lineTo(-18, -66);
      g.moveTo(0, -48);
      g.lineTo(18, -66);
      g.moveTo(0, -24);
      g.lineTo(-14, -36);
      g.moveTo(0, -24);
      g.lineTo(14, -36);
      g.lineWidth = 15;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 9;
      g.strokeStyle = '#e8fbff';
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, 16, 0, Math.PI * 2);
    g.fillStyle = radial(g, 16, [
      [0, '#ffffff'],
      [1, '#7fd0ff'],
    ]);
    g.fill();
    outline(g, 4);
  },
  snowball: (g) => {
    g.beginPath();
    g.arc(0, 0, 62, 0, Math.PI * 2);
    g.fillStyle = radial(g, 62, [
      [0, '#ffffff'],
      [0.7, '#e2f0ff'],
      [1, '#9cc0e8'],
    ]);
    g.fill();
    outline(g, 5);
    g.fillStyle = 'rgba(150,190,230,0.6)';
    for (const [x, y, r] of [
      [-20, 18, 8],
      [24, -6, 6],
      [8, 30, 5],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  },
  poison: (g) => {
    for (const [x, y, r] of [
      [-34, 16, 38],
      [30, 12, 42],
      [0, -22, 48],
      [0, 34, 34],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = radial(g, r, [
        [0, '#f0ff9a'],
        [0.6, '#8ad83a'],
        [1, '#3a7a18'],
      ], x, y);
      g.fill();
    }
    // skull mark
    g.fillStyle = INK;
    g.beginPath();
    g.arc(-14, -12, 9, 0, Math.PI * 2);
    g.arc(14, -12, 9, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-12, 14, 24, 6);
  },
  goblincurse: (g) => {
    EMBLEMS.poison(g);
    g.beginPath();
    g.ellipse(0, 52, 30, 8, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(80,255,120,0.6)';
    g.fill();
  },
  rage: (g) => {
    flame(g, 1, '#ffe0ff', '#9a2ad8');
    outline(g, 5);
    flame(g, 0.55, '#ffffff', '#e070ff');
  },
  rocket: (g) => {
    g.rotate(-0.7);
    // flame
    flame(g, 0.45, '#fff2a0', '#ff5a10');
    g.save();
    g.translate(0, -70);
    // body
    g.beginPath();
    g.moveTo(0, -60);
    g.bezierCurveTo(28, -40, 28, 10, 24, 40);
    g.lineTo(-24, 40);
    g.bezierCurveTo(-28, 10, -28, -40, 0, -60);
    g.closePath();
    const body = g.createLinearGradient(-26, 0, 26, 0);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.5, '#e04a3a');
    body.addColorStop(1, '#7a1a14');
    g.fillStyle = body;
    g.fill();
    outline(g, 4);
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * 22, 14);
      g.lineTo(sx * 42, 44);
      g.lineTo(sx * 22, 40);
      g.closePath();
      g.fillStyle = '#c8d0e0';
      g.fill();
      outline(g, 3);
    }
    g.restore();
  },
  log: (g) => {
    g.rotate(-0.25);
    g.beginPath();
    g.roundRect(-82, -30, 150, 60, 26);
    const wood = g.createLinearGradient(0, -30, 0, 30);
    wood.addColorStop(0, '#d89a58');
    wood.addColorStop(1, '#6a3a18');
    g.fillStyle = wood;
    g.fill();
    outline(g, 5);
    g.beginPath();
    g.ellipse(68, 0, 22, 30, 0, 0, Math.PI * 2);
    g.fillStyle = '#f2d29a';
    g.fill();
    outline(g, 4);
    g.strokeStyle = '#a06a34';
    g.lineWidth = 3;
    for (const r of [8, 15]) {
      g.beginPath();
      g.ellipse(68, 0, r * 0.75, r, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // spikes
    g.fillStyle = '#d8dde8';
    for (const x of [-50, -10, 30]) {
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.moveTo(x - 7, sy * 28);
        g.lineTo(x, sy * 46);
        g.lineTo(x + 7, sy * 28);
        g.closePath();
        g.fill();
        outline(g, 2.5);
      }
    }
  },
  barblog: (g) => EMBLEMS.goblinbarrel(g),
  tornado: (g) => {
    for (let i = 0; i < 6; i++) {
      const y = -66 + i * 24;
      const w = 80 - i * 12;
      g.beginPath();
      g.ellipse(i % 2 ? 6 : -6, y, w, 13, 0, 0, Math.PI * 2);
      g.lineWidth = 12;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 7;
      g.strokeStyle = i % 2 ? '#ffffff' : '#c8d8ea';
      g.stroke();
    }
  },
  graveyard: (g) => {
    g.beginPath();
    g.moveTo(-50, 70);
    g.lineTo(-50, -30);
    g.arc(0, -30, 50, Math.PI, 0);
    g.lineTo(50, 70);
    g.closePath();
    const stone = g.createLinearGradient(-50, 0, 50, 0);
    stone.addColorStop(0, '#d8e0ea');
    stone.addColorStop(1, '#68788c');
    g.fillStyle = stone;
    g.fill();
    outline(g, 5);
    // skull
    g.beginPath();
    g.arc(0, -10, 24, 0, Math.PI * 2);
    g.fillStyle = '#f6f4ea';
    g.fill();
    outline(g, 3);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(-9, -12, 6, 0, Math.PI * 2);
    g.arc(9, -12, 6, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-8, 6, 16, 5);
  },
  heal: (g) => {
    g.beginPath();
    g.arc(0, 0, 72, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,240,150,0.35)';
    g.fill();
    g.beginPath();
    g.roundRect(-20, -62, 40, 124, 10);
    g.roundRect(-62, -20, 124, 40, 10);
    const gold = g.createLinearGradient(0, -62, 0, 62);
    gold.addColorStop(0, '#ffffff');
    gold.addColorStop(0.5, '#ffe060');
    gold.addColorStop(1, '#e09a10');
    g.fillStyle = gold;
    g.fill();
    outline(g, 5);
  },
  clone: (g) => {
    for (const [dx, a] of [
      [-22, 0.55],
      [18, 1],
    ] as const) {
      g.save();
      g.translate(dx, 0);
      g.globalAlpha = a;
      g.beginPath();
      g.arc(0, -36, 24, 0, Math.PI * 2);
      g.moveTo(-40, 62);
      g.quadraticCurveTo(-40, -6, 0, -6);
      g.quadraticCurveTo(40, -6, 40, 62);
      g.closePath();
      g.fillStyle = radial(g, 70, [
        [0, '#ffffff'],
        [1, '#4ad8f0'],
      ]);
      g.fill();
      outline(g, 4);
      g.restore();
    }
  },
  mirror: (g) => {
    g.beginPath();
    g.ellipse(0, -10, 50, 66, 0, 0, Math.PI * 2);
    const frame = g.createLinearGradient(-50, -76, 50, 56);
    frame.addColorStop(0, '#fff4c0');
    frame.addColorStop(1, '#b07a10');
    g.fillStyle = frame;
    g.fill();
    outline(g, 5);
    g.beginPath();
    g.ellipse(0, -10, 38, 54, 0, 0, Math.PI * 2);
    const glass = g.createLinearGradient(-38, -64, 38, 44);
    glass.addColorStop(0, '#ffffff');
    glass.addColorStop(0.5, '#b8c8f0');
    glass.addColorStop(1, '#6878b8');
    g.fillStyle = glass;
    g.fill();
    g.fillStyle = '#b07a10';
    g.fillRect(-8, 54, 16, 26);
  },
  earthquake: (g) => {
    g.beginPath();
    g.roundRect(-80, -20, 160, 70, 14);
    const ground = g.createLinearGradient(0, -20, 0, 50);
    ground.addColorStop(0, '#c89060');
    ground.addColorStop(1, '#5a3418');
    g.fillStyle = ground;
    g.fill();
    outline(g, 5);
    g.beginPath();
    g.moveTo(-60, -20);
    g.lineTo(-30, 10);
    g.lineTo(-10, -6);
    g.lineTo(14, 30);
    g.lineTo(34, 4);
    g.lineTo(62, 46);
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.stroke();
    for (const [x, y, r] of [
      [-40, -42, 14],
      [20, -54, 10],
      [52, -34, 12],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = '#a07040';
      g.fill();
      outline(g, 3);
    }
  },
  goblinbarrel: (g) => {
    g.beginPath();
    g.ellipse(0, 0, 58, 72, 0, 0, Math.PI * 2);
    const wood = g.createLinearGradient(-58, 0, 58, 0);
    wood.addColorStop(0, '#6a3a18');
    wood.addColorStop(0.5, '#d89a58');
    wood.addColorStop(1, '#6a3a18');
    g.fillStyle = wood;
    g.fill();
    outline(g, 5);
    g.lineWidth = 9;
    for (const y of [-38, 38]) {
      g.beginPath();
      g.ellipse(0, y, 52, 12, 0, 0, Math.PI);
      g.strokeStyle = '#5a6070';
      g.stroke();
    }
    // goblin eyes peeking
    g.fillStyle = '#9fdc6a';
    g.beginPath();
    g.arc(0, -62, 22, Math.PI, 0);
    g.fill();
    outline(g, 3);
    g.fillStyle = '#fff6a0';
    g.beginPath();
    g.arc(-8, -68, 5, 0, Math.PI * 2);
    g.arc(8, -68, 5, 0, Math.PI * 2);
    g.fill();
  },
  royaldelivery: (g) => {
    g.beginPath();
    g.roundRect(-58, -48, 116, 104, 10);
    const wood = g.createLinearGradient(0, -48, 0, 56);
    wood.addColorStop(0, '#f0c070');
    wood.addColorStop(1, '#8a5420');
    g.fillStyle = wood;
    g.fill();
    outline(g, 5);
    g.lineWidth = 6;
    g.strokeStyle = '#6a3a14';
    g.beginPath();
    g.moveTo(-58, -48);
    g.lineTo(58, 56);
    g.moveTo(58, -48);
    g.lineTo(-58, 56);
    g.stroke();
    // crown seal
    g.beginPath();
    g.moveTo(-26, -6);
    g.lineTo(-26, -34);
    g.lineTo(-12, -20);
    g.lineTo(0, -40);
    g.lineTo(12, -20);
    g.lineTo(26, -34);
    g.lineTo(26, -6);
    g.closePath();
    g.fillStyle = '#ffd84a';
    g.fill();
    outline(g, 3);
  },
  darkmagic: (g) => {
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(0, 0, 72 - i * 16, i * 0.8, i * 0.8 + Math.PI * 1.4);
      g.lineWidth = 12;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 7;
      g.strokeStyle = ['#e0c0ff', '#b080ff', '#8040e0', '#ffffff'][i];
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, 14, 0, Math.PI * 2);
    g.fillStyle = '#1a0a3a';
    g.fill();
  },
  vines: (g) => {
    g.lineWidth = 14;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * 10, 74);
      g.bezierCurveTo(sx * 70, 20, sx * -60, -10, sx * 20, -70);
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 9;
      g.strokeStyle = '#5ab83a';
      g.stroke();
      g.lineWidth = 14;
    }
    for (const [x, y] of [
      [-40, 20],
      [34, -16],
      [-18, -40],
      [22, 44],
    ]) {
      g.beginPath();
      g.ellipse(x, y, 16, 9, 0.6, 0, Math.PI * 2);
      g.fillStyle = '#8ae05a';
      g.fill();
      outline(g, 3);
    }
  },
  default: (g) => {
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fillStyle = radial(g, 60, [
      [0, '#ffffff'],
      [1, '#8090b0'],
    ]);
    g.fill();
    outline(g, 5);
  },
};
