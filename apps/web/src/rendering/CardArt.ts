import * as THREE from 'three';
import type { CardInfo } from '../network/protocol';
import type { Renderer3D } from './Renderer3D';
import { UnitVisual } from './UnitFactory';
import { visualFor } from './visualCatalog';

/**
 * Card portraits. Troop and building cards are rendered from the same 3D model the arena uses
 * (one offscreen render per card, cached as a data URL); spells get vector icons drawn on a
 * canvas. Everything is original art generated at runtime.
 */
export class CardArt {
  private cache = new Map<string, string>();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50);
  private target: THREE.WebGLRenderTarget;
  private size = { w: 160, h: 200 };

  constructor(private readonly r: Renderer3D) {
    this.target = new THREE.WebGLRenderTarget(this.size.w, this.size.h, { samples: 4 });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 5);
    this.scene.add(key);
  }

  get(card: CardInfo): string {
    const hit = this.cache.get(card.id);
    if (hit) return hit;
    let url: string;
    try {
      url = card.type === 'SPELL' || !card.unit ? spellIcon(card) : this.renderUnit(card);
    } catch (e) {
      console.warn('Card art failed for', card.id, e);
      url = spellIcon(card);
    }
    this.cache.set(card.id, url);
    return url;
  }

  private renderUnit(card: CardInfo): string {
    const unit = card.unit!;
    const visual = new UnitVisual(visualFor(unit.name, card.type === 'BUILDING' ? 'B' : 'T', unit.movement === 'AIR' ? 1 : 0, unit.radius), 'own');
    visual.update(0.016, 0, { frozen: false });
    this.scene.add(visual.root);
    visual.root.rotation.y = 0.5;
    const box = new THREE.Box3().setFromObject(visual.root);
    const height = Math.max(0.6, box.max.y - box.min.y);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const centre = box.getCenter(new THREE.Vector3());
    const fitH = height * 1.15;
    const fitW = width * 1.2;
    const dist = Math.max(fitH / (2 * Math.tan(THREE.MathUtils.degToRad(15))), fitW / (2 * Math.tan(THREE.MathUtils.degToRad(15)) * 0.8));
    this.camera.position.set(centre.x, centre.y + height * 0.15, centre.z + dist);
    this.camera.lookAt(centre.x, centre.y, centre.z);
    this.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(backgroundFor(card));
    const gl = this.r.renderer;
    const prevTarget = gl.getRenderTarget();
    const prevShadow = gl.shadowMap.enabled;
    gl.shadowMap.enabled = false;
    gl.setRenderTarget(this.target);
    gl.render(this.scene, this.camera);
    const pixels = new Uint8Array(this.size.w * this.size.h * 4);
    gl.readRenderTargetPixels(this.target, 0, 0, this.size.w, this.size.h, pixels);
    gl.setRenderTarget(prevTarget);
    gl.shadowMap.enabled = prevShadow;
    visual.dispose();
    // flip vertically into a canvas
    const canvas = document.createElement('canvas');
    canvas.width = this.size.w;
    canvas.height = this.size.h;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(this.size.w, this.size.h);
    for (let y = 0; y < this.size.h; y++) {
      const src = (this.size.h - 1 - y) * this.size.w * 4;
      img.data.set(pixels.subarray(src, src + this.size.w * 4), y * this.size.w * 4);
    }
    g.putImageData(img, 0, 0);
    vignette(g, this.size.w, this.size.h);
    return canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.target.dispose();
  }
}

function backgroundFor(card: CardInfo): number {
  switch (card.rarity) {
    case 'RARE':
      return 0xf0b060;
    case 'EPIC':
      return 0xb07ae0;
    case 'LEGENDARY':
      return 0x7ad0e0;
    default:
      return 0x8ab4e8;
  }
}

function vignette(g: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = g.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

/** Vector icon for a spell card. */
export function spellIcon(card: CardInfo): string {
  const w = 160;
  const h = 200;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, h);
  const [top, bottom] = palette(card.id);
  bg.addColorStop(0, top);
  bg.addColorStop(1, bottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  drawSymbol(g, card.id);
  g.restore();
  vignette(g, w, h);
  return c.toDataURL('image/png');
}

function palette(id: string): [string, string] {
  const p: Record<string, [string, string]> = {
    fireball: ['#ffb347', '#c0392b'],
    arrows: ['#d9e4f5', '#6b7f99'],
    zap: ['#9fe0ff', '#2c5aa0'],
    freeze: ['#e8f8ff', '#5aa0d0'],
    poison: ['#c8f07a', '#3f7a2a'],
    rage: ['#e0a0ff', '#6a2a9a'],
    rocket: ['#ffcf90', '#a0402a'],
    lightning: ['#fff6a0', '#4a5aa0'],
    log: ['#e8c890', '#7a5030'],
    barblog: ['#e8c890', '#7a5030'],
    tornado: ['#e0e8f0', '#6a7a90'],
    graveyard: ['#a0b0c0', '#2a3040'],
    goblinbarrel: ['#c8e890', '#6a4a2a'],
    clone: ['#a0f0ff', '#2a8aa0'],
    earthquake: ['#e0c090', '#6a4a2a'],
    heal: ['#fff3b0', '#d0a020'],
    mirror: ['#f0f0ff', '#8a8ab0'],
    snowball: ['#ffffff', '#8ab0d0'],
    royaldelivery: ['#ffe8a0', '#a07020'],
    darkmagic: ['#b080ff', '#1a1040'],
    goblincurse: ['#b0f080', '#2a5a2a'],
    vines: ['#a0e080', '#2a6a2a'],
  };
  return p[id] ?? ['#c0c8d8', '#506080'];
}

function drawSymbol(g: CanvasRenderingContext2D, id: string): void {
  const white = 'rgba(255,255,255,0.95)';
  const dark = 'rgba(0,0,0,0.35)';
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 8;
  const circle = (r: number, fill: string) => {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  };
  const bolt = (s = 1) => {
    g.beginPath();
    g.moveTo(-10 * s, -50 * s);
    g.lineTo(18 * s, -50 * s);
    g.lineTo(2 * s, -8 * s);
    g.lineTo(22 * s, -8 * s);
    g.lineTo(-14 * s, 52 * s);
    g.lineTo(-2 * s, 6 * s);
    g.lineTo(-22 * s, 6 * s);
    g.closePath();
    g.fillStyle = '#fff6a0';
    g.fill();
    g.strokeStyle = '#3a4a80';
    g.lineWidth = 4;
    g.stroke();
  };
  switch (id) {
    case 'fireball':
    case 'rocket': {
      circle(38, '#ff7a20');
      circle(26, '#ffd060');
      g.beginPath();
      g.moveTo(-30, 10);
      g.quadraticCurveTo(-60, 60, -10, 70);
      g.strokeStyle = 'rgba(255,200,80,0.8)';
      g.lineWidth = 10;
      g.stroke();
      break;
    }
    case 'arrows': {
      for (const dx of [-30, 0, 30]) {
        g.save();
        g.translate(dx, 0);
        g.rotate(0.2);
        g.strokeStyle = '#6a4a2a';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(0, -45);
        g.lineTo(0, 45);
        g.stroke();
        g.fillStyle = '#ddd';
        g.beginPath();
        g.moveTo(0, 60);
        g.lineTo(-10, 40);
        g.lineTo(10, 40);
        g.closePath();
        g.fill();
        g.restore();
      }
      break;
    }
    case 'zap':
    case 'lightning':
      bolt(id === 'lightning' ? 1.3 : 1);
      break;
    case 'freeze':
    case 'snowball': {
      g.strokeStyle = white;
      g.lineWidth = 7;
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -55);
        g.moveTo(0, -35);
        g.lineTo(-14, -48);
        g.moveTo(0, -35);
        g.lineTo(14, -48);
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'poison':
    case 'goblincurse': {
      circle(42, 'rgba(60,120,30,0.8)');
      for (const [x, y, r] of [[-15, -10, 12], [14, 8, 9], [0, 22, 7], [20, -20, 6]]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = '#d8ff90';
        g.fill();
      }
      break;
    }
    case 'rage': {
      g.font = 'bold 90px system-ui';
      g.fillStyle = white;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', 0, 4);
      circle(50, 'rgba(255,255,255,0.0)');
      g.strokeStyle = white;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(0, 0, 52, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case 'log':
    case 'barblog': {
      g.fillStyle = '#8a5a30';
      g.fillRect(-55, -20, 110, 40);
      g.beginPath();
      g.ellipse(55, 0, 12, 20, 0, 0, Math.PI * 2);
      g.fillStyle = '#d8b080';
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 3;
      g.stroke();
      break;
    }
    case 'tornado': {
      g.strokeStyle = white;
      for (let i = 0; i < 5; i++) {
        g.lineWidth = 8 - i;
        g.beginPath();
        g.ellipse(i * 4 - 8, -40 + i * 20, 50 - i * 9, 10, 0, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case 'graveyard': {
      g.fillStyle = '#d0d6dc';
      g.beginPath();
      g.moveTo(-30, 50);
      g.lineTo(-30, -20);
      g.arc(0, -20, 30, Math.PI, 0);
      g.lineTo(30, 50);
      g.closePath();
      g.fill();
      g.fillStyle = '#7a8088';
      g.fillRect(-4, -30, 8, 40);
      g.fillRect(-16, -16, 32, 8);
      break;
    }
    case 'heal':
      g.fillStyle = white;
      g.fillRect(-12, -45, 24, 90);
      g.fillRect(-45, -12, 90, 24);
      break;
    case 'clone':
    case 'mirror': {
      g.strokeStyle = white;
      g.lineWidth = 6;
      g.strokeRect(-40, -45, 50, 70);
      g.strokeRect(-10, -25, 50, 70);
      break;
    }
    case 'earthquake': {
      g.strokeStyle = '#3a2a1a';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(-50, -30);
      g.lineTo(-20, 0);
      g.lineTo(-30, 20);
      g.lineTo(10, 10);
      g.lineTo(0, 40);
      g.lineTo(50, 30);
      g.stroke();
      break;
    }
    case 'goblinbarrel':
    case 'royaldelivery': {
      g.fillStyle = '#8a5a30';
      g.beginPath();
      g.ellipse(0, 0, 38, 50, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4a4a4a';
      g.lineWidth = 6;
      for (const y of [-25, 25]) {
        g.beginPath();
        g.moveTo(-36, y);
        g.lineTo(36, y);
        g.stroke();
      }
      break;
    }
    case 'darkmagic':
      circle(45, '#1a0a30');
      circle(28, '#a060ff');
      circle(12, '#ffffff');
      break;
    case 'vines': {
      g.strokeStyle = '#d8ffb0';
      g.lineWidth = 8;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(i * 28, 60);
        g.bezierCurveTo(i * 28 - 30, 20, i * 28 + 30, -10, i * 28, -55);
        g.stroke();
      }
      break;
    }
    default:
      circle(40, white);
  }
}
