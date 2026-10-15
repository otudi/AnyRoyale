// Persisted user settings (per browser). Read failures fall back to defaults.

export type Quality = 'low' | 'medium' | 'high';

/** Card size steps (1 = extra small … 5 = extra large) and the tray scale each one gives. */
export const CARD_SIZES = [0.6, 0.72, 0.84, 0.96, 1.08] as const;
export const DEFAULT_CARD_SIZE = 2;

/** First-run quality from the device: strong desktops high, phones medium, weak devices low. */
export function detectQuality(): Quality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (mem < 3 || cores < 4) return 'low';
  return mobile ? 'medium' : 'high';
}

export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  quality: Quality;
  showFps: boolean;
  /** Menu colour scheme; 'auto' follows the system. */
  theme: 'auto' | 'light' | 'dark';
  /** Master mute (keeps the volume sliders). */
  muted: boolean;
  /** 1..5, see CARD_SIZES. */
  cardSize: number;
}

const KEY = 'anyroyale.settings.v1';
const defaults = (): Settings => ({ music: 0.55, sfx: 0.8, quality: detectQuality(), showFps: false, theme: 'auto', muted: false, cardSize: DEFAULT_CARD_SIZE });

function read(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...d, ...(JSON.parse(raw) as Partial<Settings> & { quality?: string }) } as Settings;
      // older versions stored 'auto': resolve it for this device
      if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = d.quality;
      if (!(s.cardSize >= 1 && s.cardSize <= 5)) s.cardSize = DEFAULT_CARD_SIZE;
      return s;
    }
  } catch {
    // ignore
  }
  return d;
}

/** Applies the card size to the page (a CSS variable read by the battle tray). */
export function applyCardSize(size: number): void {
  const k = CARD_SIZES[Math.min(5, Math.max(1, Math.round(size))) - 1];
  document.documentElement.style.setProperty('--card-scale', String(k));
}

let current = read();
applyCardSize(current.cardSize);
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  if (patch.cardSize !== undefined) applyCardSize(current.cardSize);
  for (const l of listeners) l(current);
}

export function onSettings(l: (s: Settings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
