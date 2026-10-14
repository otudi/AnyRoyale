import { getSettings, onSettings } from './settings';

/** Menu colour scheme: the saved choice, or the system preference when set to "auto". */
export function isDark(): boolean {
  const pref = getSettings().theme;
  if (pref !== 'auto') return pref === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyTheme(): void {
  document.documentElement.classList.toggle('dark', isDark());
}

onSettings(applyTheme);
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
