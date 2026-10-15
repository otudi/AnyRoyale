import '@fontsource/baloo-bhaijaan-2/500.css';
import '@fontsource/baloo-bhaijaan-2/700.css';
import '@fontsource/baloo-bhaijaan-2/800.css';
import 'material-icons/iconfont/filled.css';
import './ui/styles.css';
import './ui/menu.css';
import { audio } from './audio/AudioManager';
import { applyDocumentLang, t } from './i18n/strings';
import { App } from './ui/App';
import { applyTheme } from './ui/theme';

applyDocumentLang();
applyTheme();

// Browsers only start audio after a user gesture (Safari is strict): unlock on the first one.
const unlock = () => audio.unlock();
for (const ev of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
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
  screens.innerHTML = `<div class="mm mm-solid" data-screen="error"><div class="mm-col"><div class="mm-content" style="justify-content:center;flex:1">
    <h1 class="mm-title" style="text-align:center;margin-bottom:18px">AnyRoyale</h1>
    <div class="mm-card"><div class="mm-card-label"></div><button class="mm-btn hero center" data-act="retry"></button></div></div></div></div>`;
  screens.querySelector('.mm-card-label')!.textContent = t('noWebgl');
  const retry = screens.querySelector<HTMLButtonElement>('[data-act="retry"]')!;
  retry.textContent = t('retry');
  retry.addEventListener('click', () => location.reload());
}
void app?.boot();
