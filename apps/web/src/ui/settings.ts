// Persisted user settings (per browser). Read failures fall back to defaults.

export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  quality: Quality;
  showFps: boolean;
  /** Menu colour scheme; 'auto' follows the system. */
  theme: 'auto' | 'light' | 'dark';
  /** Master mute (keeps the volume sliders). */
  muted: boolean;
}

const KEY = 'anyroyale.settings.v1';
const defaults: Settings = { music: 0.55, sfx: 0.8, quality: 'auto', showFps: false, theme: 'auto', muted: false };

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore
  }
  return { ...defaults };
}

let current = read();
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
  for (const l of listeners) l(current);
}

export function onSettings(l: (s: Settings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
