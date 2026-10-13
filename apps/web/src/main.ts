import './ui/styles.css';
import { audio } from './audio/AudioManager';
import { applyDocumentLang, t } from './i18n/strings';
import { App } from './ui/App';

applyDocumentLang();

// Browsers only start audio after a user gesture (Safari is strict): unlock on the first one.
const unlock = () => audio.unlock();
for (const ev of ['pointerdown', 'touchend', 'keydown']) {
  window.addEventListener(ev, unlock, { capture: true, passive: true });
}

// Prevent iOS double-tap zoom and pinch on the game surface.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

let app: App | null = null;
try {
  app = new App();
} catch (e) {
  // Almost always: WebGL is unavailable (disabled, blocklisted GPU, or lost at start-up).
  console.error(e);
  const screens = document.getElementById('screens')!;
  screens.innerHTML = `<div class="screen backdrop" data-screen="error"><div class="logo">AnyRoyale</div>
    <div class="panel"><p></p><button class="btn" data-act="retry"></button></div></div>`;
  screens.querySelector('p')!.textContent = t('noWebgl');
  const retry = screens.querySelector<HTMLButtonElement>('[data-act="retry"]')!;
  retry.textContent = t('retry');
  retry.addEventListener('click', () => location.reload());
}
void app?.boot();
