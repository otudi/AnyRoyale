import './ui/styles.css';
import { audio } from './audio/AudioManager';
import { applyDocumentLang } from './i18n/strings';
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

const app = new App();
void app.boot();
