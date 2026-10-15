import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { BattleSession } from '../game/BattleSession';
import { cards } from '../game/cards';
import { getLang, setLang, t, type Lang, type StringKey } from '../i18n/strings';
import { Connection } from '../network/Connection';
import { loadIdentity, provisionalName, saveIdentity } from '../network/identity';
import type { CardInfo, MatchEnd, MatchStart, ServerMessage } from '../network/protocol';
import { ARENA_THEMES, themeBundles } from '../rendering/arenaThemes';
import { CardArt } from '../rendering/CardArt';
import { crest, glyph, wordmark } from './brand';
import { CardSizePreview } from './CardSizePreview';
import { forgedFileFor } from '../rendering/visualCatalog';
import { Renderer3D } from '../rendering/Renderer3D';
import { CORE_MODEL_FILES, resetClipCache } from '../rendering/UnitFactory';
import { attacks, cardDesc, cardName, kindLabel, targetsLabel } from './cardLabels';
import { getSettings, updateSettings, type Quality } from './settings';
import { isDark } from './theme';

type Screen = 'loading' | 'home' | 'mode' | 'queue' | 'bot' | 'friend' | 'room' | 'cards' | 'intro' | 'battle' | 'result';

const EXTRA_BUNDLES = ['card_buildings.glb', 'props_dungeon.glb', 'props_spooky.glb'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Material icon (bundled font, ligature name). */
function ic(name: string, cls = ''): string {
  return `<span class="material-icons ${cls}" aria-hidden="true">${name}</span>`;
}

function speedLabel(speed: number): string {
  return t(speed <= 800 ? 'speedSlow' : speed <= 1100 ? 'speedMedium' : speed <= 1600 ? 'speedFast' : 'speedVeryFast');
}

const HELP_KEY = 'anyroyale.helpSeen';
function helpSeen(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return true;
  }
}
function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_KEY, '1');
  } catch {
    // ignore
  }
}

/** Screens, lobby flow and match lifecycle. */
export class App {
  private conn: Connection;
  private r: Renderer3D;
  private art: CardArt;
  private screens: HTMLElement;
  private hudRoot: HTMLElement;
  private stage: HTMLElement;
  private battle: BattleSession | null = null;
  private screen: Screen = 'loading';
  private name = provisionalName();
  private roomCode: string | null = null;
  private pendingJoin: string | null = null;
  private queueWaiting = 0;
  private lastBotDifficulty = 'normal';
  private lastSeed: string | null = null;
  private statusEl: HTMLElement | null = null;
  private assetsReady = false;
  private startQueue: MatchStart[] = [];
  /** True while the player wants an online opponent; the queue is re-joined after a reconnect. */
  private searching = false;
  /** Matches the server cancelled while this client was still loading them. */
  private cancelledMatches = new Set<string>();
  private resultEnd: MatchEnd | null = null;

  constructor() {
    this.stage = document.getElementById('stage')!;
    this.screens = document.getElementById('screens')!;
    this.hudRoot = document.getElementById('hud')!;
    this.r = new Renderer3D(this.stage);
    this.art = new CardArt(this.r);
    this.conn = new Connection(Connection.defaultUrl());
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room && /^[A-Za-z0-9]{4,8}$/.test(room)) this.pendingJoin = room.toUpperCase();
    (window as unknown as { __anyroyale: App }).__anyroyale = this; // test hook (read-only use)
    (window as unknown as { __anyroyaleThemes: string[] }).__anyroyaleThemes = Object.keys(ARENA_THEMES);
  }

  async boot(): Promise<void> {
    this.r.start();
    this.renderLoading(0, t('connecting'));
    this.conn.on((m) => this.onMessage(m));
    this.conn.onState((s) => this.onConnState(s));
    this.conn.connect();
    try {
      await cards.load();
      await this.loadAssets();
    } catch (e) {
      console.error(e);
      this.renderLoadError();
      return;
    }
    this.assetsReady = true;
    // A phone keeps an open tab's old build running after a deploy: look for a newer build when
    // the game comes back to the foreground, and every few minutes, and reload only on the home
    // screen (never during a match or in the queue).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.checkForUpdate();
    });
    setInterval(() => void this.checkForUpdate(), 3 * 60_000);
    // Background-load optional bundles so match start is instant.
    void assets.loadAll(EXTRA_BUNDLES);
    if (this.startQueue.length) {
      const s = this.startQueue.pop()!;
      this.startQueue = [];
      void this.onMatchStart(s);
    } else {
      this.showHome();
    }
  }

  private async loadAssets(): Promise<void> {
    const result = await assets.loadAll(CORE_MODEL_FILES, (p) => {
      const pct = p.totalBytes ? (p.loadedBytes / p.totalBytes) * 100 : 0;
      this.renderLoading(pct, `${t('loadingAssets')} · ${(p.loadedBytes / 1048576).toFixed(1)} / ${(p.totalBytes / 1048576).toFixed(1)} MB`);
    });
    resetClipCache();
    if (result.failed.length) {
      console.warn('Failed model files (procedural fallbacks will be used):', result.failed);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------------------------------

  /** Re-renders the current menu screen (after a language, theme or sound switch). */
  private rerender: () => void = () => {};
  private searchTimer = 0;
  private searchStarted = 0;
  private cardFilter: 'ALL' | 'TROOP' | 'SPELL' | 'BUILDING' = 'ALL';

  private set(screen: Screen, html: string, variant: 'solid' | 'overlay' = 'solid'): void {
    this.screen = screen;
    window.clearInterval(this.searchTimer);
    // solid menus stand in front of the castle courtyard (#menu-bg); overlays show the arena
    this.screens.innerHTML = `<div class="mm mm-${variant}" data-screen="${screen}"><div class="mm-col">${html}</div></div>`;
    this.setMenuMode(variant === 'solid');
  }

  /** Menus scroll as a normal page (bounce, pull-to-refresh); the battle keeps the locked stage. */
  private setMenuMode(on: boolean): void {
    const root = document.documentElement;
    const was = root.classList.contains('menu-mode');
    if (was !== on) {
      root.classList.toggle('menu-mode', on);
      // the stage changed size without a window resize: let the renderer re-fit the canvas
      window.dispatchEvent(new Event('resize'));
    }
    if (window.scrollY) window.scrollTo(0, 0);
  }

  /** A 3D menu button: icon + title (+ subtitle) on the start side, chevron on the end side. */
  private btn(act: string, icon: string, title: string, opts: { cls?: string; sub?: string; chev?: boolean; glyph?: string } = {}): string {
    return `<button class="mm-btn ${opts.cls ?? ''}" data-act="${act}"><span class="start">${opts.glyph ?? (icon ? ic(icon) : '')}<span><span class="title">${title}</span>${
      opts.sub ? `<span class="sub">${opts.sub}</span>` : ''
    }</span></span>${opts.chev ? ic('chevron_left', 'chev') : ''}</button>`;
  }

  private backBtn(act = 'back'): string {
    return `<div class="mm-top inner"><button class="mm-circle" data-act="${act}" aria-label="${t('back')}">${ic(getLang() === 'ar' ? 'arrow_forward' : 'arrow_back')}</button></div>`;
  }

  /** Home top bar: the player's plate (tap to rename) and the quick toggles. */
  private topNav(): string {
    const s = getSettings();
    const initial = esc([...this.name.trim()][0]?.toUpperCase() ?? 'A');
    return `<div class="mm-top">
      <button class="mm-name" data-act="name" aria-label="${t('editName')}">
        <span class="avatar">${glyph.shield}<b>${initial}</b></span>
        <span class="who"><b>${esc(this.name)}</b></span>
      </button>
      <div class="mm-cluster">
        <button class="mm-circle gold ${helpSeen() ? '' : 'pulse'}" data-act="help" aria-label="${t('howTitle')}">${ic('lightbulb')}</button>
        <button class="mm-circle blue" data-act="mute" aria-label="${t('mute')}">${ic(s.muted ? 'volume_off' : 'volume_up')}</button>
        <button class="mm-circle" data-act="settings" aria-label="${t('settings')}">${ic('settings')}</button>
      </div>
    </div>`;
  }

  /** Home footer: language and theme switches. */
  private footNav(): string {
    return `<div class="mm-foot">
      <button class="mm-circle" data-act="lang" aria-label="${t('language')}">${getLang() === 'ar' ? 'EN' : 'ع'}</button>
      <button class="mm-circle" data-act="theme" aria-label="${t('darkMode')}">${ic(isDark() ? 'light_mode' : 'dark_mode')}</button>
    </div>`;
  }

  /** Actions of the top navigation, shared by every screen that shows it. */
  private navActions(): Record<string, () => void> {
    return {
      lang: () => {
        setLang(getLang() === 'ar' ? 'en' : 'ar');
        this.rerender();
      },
      theme: () => {
        updateSettings({ theme: isDark() ? 'light' : 'dark' });
        this.rerender();
      },
      mute: () => {
        updateSettings({ muted: !getSettings().muted });
        this.rerender();
      },
      settings: () => this.showSettings(),
      help: () => this.showHelp(),
    };
  }

  /** The crest and wordmark lock-up (docs/BRAND.md). */
  private brand(size = 128): string {
    return `${crest(size)}<h1 class="mm-title">${wordmark(Math.round(size * 2))}</h1>`;
  }

  private renderLoading(pct: number, text: string): void {
    if (this.screen !== 'loading') return;
    const existing = this.screens.querySelector<HTMLElement>('[data-screen="loading"]');
    if (existing) {
      existing.querySelector<HTMLElement>('.mm-progress > div')!.style.width = `${pct}%`;
      existing.querySelector<HTMLElement>('[data-text]')!.textContent = text;
      return;
    }
    this.set(
      'loading',
      `<div class="mm-content" style="justify-content:center;flex:1">
         <div class="mm-brand" style="margin:0">${this.brand(150)}</div>
         <div class="mm-progress"><div style="width:${pct}%"></div></div>
         <div class="mm-note" data-text>${esc(text)}</div>
       </div>`,
    );
  }

  private renderLoadError(): void {
    this.set(
      'loading',
      `<div class="mm-content" style="justify-content:center;flex:1">
         <div class="mm-brand" style="margin:0 0 20px">${this.brand()}</div>
         <div class="mm-card"><div class="mm-card-label">${t('loadFailed')}</div>${this.btn('retry', 'refresh', t('retry'), { cls: 'hero center' })}</div>
       </div>`,
    );
    this.screens.querySelector('[data-act="retry"]')!.addEventListener('click', () => location.reload());
  }

  /** Reloads the page when the server has a newer build and the player is on the home screen. */
  private async checkForUpdate(): Promise<void> {
    if (this.screen !== 'home' || this.battle) return;
    const mine = [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
      .map((el) => el.getAttribute('src') ?? '')
      .find((src) => /\/assets\/index-[\w-]+\.js$/.test(src));
    if (!mine) return; // dev server: nothing to compare
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const latest = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0];
      if (latest && !mine.endsWith(latest) && this.screen === 'home' && !this.battle) location.reload();
    } catch {
      // offline: try again later
    }
  }

  showHome(): void {
    this.searching = false;
    this.disposeBattle();
    audio.playMusic('menu');
    this.rerender = () => this.showHome();
    this.set(
      'home',
      `${this.topNav()}
       <div class="mm-brand">${this.brand(132)}</div>
       <div class="mm-menu">
         ${this.btn('play', '', t('startGame'), { cls: 'hero big center', glyph: glyph.swords })}
         <div class="mm-tiles">
           ${this.btn('bot', '', t('trainingShort'), { glyph: glyph.target.replace('class="glyph"', 'class="glyph blue"') })}
           ${this.btn('cards', '', t('cardsTitle'), { glyph: glyph.deck.replace('class="glyph"', 'class="glyph gold"') })}
         </div>
       </div>
       ${this.footNav()}`,
    );
    this.bind({
      ...this.navActions(),
      name: () => this.editName(),
      play: () => this.showMode(),
      bot: () => this.showBot(),
      cards: () => void this.showCards(),
    });
  }

  private bind(actions: Record<string, () => void>): void {
    for (const el of this.screens.querySelectorAll<HTMLElement>('[data-act]')) {
      const act = el.dataset.act!;
      if (actions[act]) {
        el.addEventListener('click', () => {
          audio.play('click', { volume: 0.5 });
          navigator.vibrate?.(12);
          actions[act]();
        });
      }
    }
  }

  private showMode(): void {
    this.rerender = () => this.showMode();
    this.set(
      'mode',
      `${this.backBtn()}
       <div class="mm-content"><h2 class="mm-header">${t('playMode')}</h2>
         <div class="mm-menu" style="margin-top:0">
           ${this.btn('online', '', t('quickMatch'), { cls: 'hero big center', glyph: glyph.swords })}
           ${this.btn('friend', 'group', t('privateRoom'), { cls: 'blue' })}
         </div>
       </div>`,
    );
    this.bind({ back: () => this.showHome(), online: () => this.queueOnline(), friend: () => this.showFriend() });
  }

  private queueOnline(): void {
    this.conn.send({ type: 'queue' });
    this.queueWaiting = 1;
    this.searching = true;
    this.searchStarted = Date.now();
    this.showQueue();
  }

  private showQueue(): void {
    this.rerender = () => this.showQueue();
    if (!this.searchStarted) this.searchStarted = Date.now();
    this.set(
      'queue',
      `<div class="mm-content" style="justify-content:center;flex:1">
         <div class="mm-loader"></div>
         <div class="mm-status">${t('searching')}</div>
         <div class="mm-timer" data-search-timer>00:00</div>
         <div class="mm-note" data-waiting style="margin-bottom:4px">${t('waitingPlayers', { n: this.queueWaiting })}</div>
         ${this.btn('cancel', 'close', t('cancel'), { cls: 'center' })}
       </div>`,
    );
    const tick = () => {
      const sec = Math.floor((Date.now() - this.searchStarted) / 1000);
      const el = this.screens.querySelector('[data-search-timer]');
      if (el) el.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    };
    tick();
    this.searchTimer = window.setInterval(tick, 1000);
    this.bind({
      cancel: () => {
        this.searching = false;
        this.searchStarted = 0;
        this.conn.send({ type: 'cancelQueue' });
        this.showMode();
      },
    });
  }

  private showBot(): void {
    this.rerender = () => this.showBot();
    const diffs = ['easy', 'normal', 'hard', 'expert'] as const;
    this.set(
      'bot',
      `${this.backBtn()}
       <div class="mm-content"><h2 class="mm-header">${t('chooseDifficulty')}</h2>
         <div class="mm-menu" style="margin-top:0">
           ${diffs
             .map(
               (d) =>
                 `<button class="mm-btn lvl-${d}" data-act="d_${d}"><span class="start">${ic('fiber_manual_record', 'dot')}<span><span class="title">${t(d)}</span></span></span></button>`,
             )
             .join('')}
         </div>
       </div>`,
    );
    const actions: Record<string, () => void> = { back: () => this.showHome() };
    for (const d of diffs) actions[`d_${d}`] = () => this.startBot(d, null);
    this.bind(actions);
  }

  private startBot(difficulty: string, seed: string | null): void {
    this.lastBotDifficulty = difficulty;
    this.conn.send(seed ? { type: 'startBot', difficulty, seed } : { type: 'startBot', difficulty });
    this.rerender = () => {};
    this.set('queue', `<div class="mm-content" style="justify-content:center;flex:1"><div class="mm-loader"></div><div class="mm-status">${t('loading')}</div></div>`);
  }

  private showFriend(): void {
    this.rerender = () => this.showFriend();
    const boxes = [0, 1, 2, 3, 4]
      .map((i) => `<input type="text" class="mm-code-input" data-code-box="${i}" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="${t('roomCode')} ${i + 1}" />`)
      .join('');
    this.set(
      'friend',
      `${this.backBtn()}
       <div class="mm-content"><h2 class="mm-header">${t('privateRoom')}</h2>
         <div class="mm-card"><div class="mm-card-label">${t('yourRoomCode')}</div>${this.btn('create', 'add_circle', t('createRoom'), { cls: 'hero center' })}</div>
         <div class="mm-card"><div class="mm-card-label">${t('joinFriend')}</div>
           <div class="mm-code-inputs">${boxes}</div>
           ${this.btn('join', 'login', t('join'), { cls: 'blue center' })}
         </div>
       </div>`,
    );
    const inputs = [...this.screens.querySelectorAll<HTMLInputElement>('[data-code-box]')];
    const join = () => {
      const code = inputs.map((i) => i.value).join('').toUpperCase();
      if (code.length >= 4) this.conn.send({ type: 'joinRoom', code });
    };
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        const chars = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        // typing one character moves on; pasting a whole code spreads it over the boxes
        input.value = chars.slice(0, 1);
        for (let k = 1; k < chars.length && index + k < inputs.length; k++) inputs[index + k].value = chars[k];
        const next = Math.min(inputs.length - 1, index + Math.max(1, chars.length));
        if (chars.length && next !== index) inputs[next].focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) inputs[index - 1].focus();
        if (e.key === 'Enter') join();
      });
    });
    this.bind({
      back: () => this.showMode(),
      create: () => this.conn.send({ type: 'createRoom' }),
      join,
    });
  }

  private showRoom(code: string): void {
    this.roomCode = code;
    this.rerender = () => this.showRoom(code);
    const link = `${location.origin}/?room=${code}`;
    this.set(
      'room',
      `${this.backBtn()}
       <div class="mm-content"><h2 class="mm-header">${t('privateRoom')}</h2>
         <div class="mm-card"><div class="mm-card-label">${t('shareCode')}</div>
           <div class="mm-code-row"><div class="mm-code" data-room-code>${esc(code)}</div>
             <button class="mm-circle square" data-act="copy" aria-label="${t('copyLink')}">${ic('content_copy')}</button></div>
           ${'share' in navigator ? `<div style="margin-top:14px">${this.btn('share', 'share', t('share'), { cls: 'center' })}</div>` : ''}
         </div>
         <div class="mm-loader" style="margin:16px auto 8px"></div>
         <div class="mm-status">${t('waitingFriend')}</div>
         ${this.btn('cancel', 'close', t('cancel'), { cls: 'center' })}
       </div>`,
    );
    const cancel = () => {
      this.conn.send({ type: 'cancelRoom' });
      this.roomCode = null;
      this.showMode();
    };
    this.bind({
      copy: () => {
        void navigator.clipboard?.writeText(link).then(
          () => {
            this.toast(t('copied'));
            const icon = this.screens.querySelector('[data-act="copy"] .material-icons');
            if (icon) {
              icon.textContent = 'check';
              setTimeout(() => (icon.textContent = 'content_copy'), 2000);
            }
          },
          () => this.toast(link),
        );
      },
      share: () => void navigator.share?.({ title: 'AnyRoyale', text: `AnyRoyale ${code}`, url: link }).catch(() => {}),
      cancel,
      back: cancel,
    });
  }

  // ---- cards page ----------------------------------------------------------------------------

  private async showCards(): Promise<void> {
    this.rerender = () => void this.showCards();
    const order = { TROOP: 0, BUILDING: 1, SPELL: 2 } as const;
    const list = cards
      .all()
      .filter((c) => this.cardFilter === 'ALL' || c.type === this.cardFilter)
      .sort((a, b) => a.cost - b.cost || order[a.type] - order[b.type] || cardName(a).localeCompare(cardName(b)));
    const filters = ['ALL', 'TROOP', 'SPELL', 'BUILDING'] as const;
    this.set(
      'cards',
      `${this.backBtn()}
       <h2 class="mm-header" style="margin-bottom:12px">${t('cardsTitle')} <span style="opacity:.5;font-size:18px">${list.length}</span></h2>
       <div class="mm-chips">${filters
         .map((f) => `<button class="mm-chip ${f === this.cardFilter ? 'on' : ''}" data-filter="${f}">${f === 'ALL' ? t('filterAll') : t(`type${f}` as 'typeTROOP')}</button>`)
         .join('')}</div>
       <div style="height:12px"></div>
       <div class="mm-grid">${list
         .map(
           (c) =>
             `<button class="mm-tile ${c.rarity.toLowerCase()}" data-card="${c.id}"><img class="art" alt="" data-art="${c.id}" /><span class="mm-cost"><span>${c.cost}</span></span><span class="nm">${esc(cardName(c))}</span></button>`,
         )
         .join('')}</div>`,
    );
    this.bind({ back: () => this.showHome() });
    for (const el of this.screens.querySelectorAll<HTMLElement>('[data-filter]')) {
      el.addEventListener('click', () => {
        audio.play('click', { volume: 0.5 });
        this.cardFilter = el.dataset.filter as typeof this.cardFilter;
        void this.showCards();
      });
    }
    for (const el of this.screens.querySelectorAll<HTMLElement>('[data-card]')) {
      el.addEventListener('click', () => {
        const c = cards.get(el.dataset.card!);
        if (c) {
          audio.play('select', { volume: 0.5 });
          this.showCardDetail(c);
        }
      });
    }
    // Portraits are rendered from the 3D models: a few per frame so the page never freezes.
    await assets.loadAll(EXTRA_BUNDLES);
    const imgs = [...this.screens.querySelectorAll<HTMLImageElement>('img[data-art]')];
    let i = 0;
    const step = () => {
      if (this.screen !== 'cards') return;
      const t0 = performance.now();
      while (i < imgs.length && performance.now() - t0 < 12) {
        const img = imgs[i++];
        if (!img.isConnected) continue;
        const c = cards.get(img.dataset.art!);
        if (!c) continue;
        const file = forgedFileFor(c.unit?.name);
        if (file && !assets.get(file)) {
          // its own model is still downloading: draw the portrait once it is there
          void assets.load(file).then(() => {
            if (img.isConnected) img.src = this.art.get(c);
          });
          continue;
        }
        img.src = this.art.get(c);
      }
      if (i < imgs.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private showCardDetail(c: CardInfo): void {
    const ar = getLang() === 'ar';
    const r1 = (n: number) => String(Math.round(n * 10) / 10);
    const stats: [string, string][] = [[t('statCost'), String(c.cost)]];
    const u = c.unit;
    if (u) {
      if (c.count > 1) stats.push([t('statCount'), `×${c.count}`]);
      stats.push([t('statHp'), String(u.hp)]);
      if (u.damage > 0) {
        stats.push([t('statDamage'), String(u.damage)]);
        if (u.hitSpeed > 0) stats.push([t('statHitSpeed'), t('seconds', { n: r1(u.hitSpeed) })]);
        stats.push([t('statRange'), u.range < 2000 ? t('melee') : t('tiles', { n: r1(u.range / 1000) })]);
      }
      if (c.type === 'TROOP' && u.speed > 0) stats.push([t('statSpeed'), speedLabel(u.speed)]);
      if (c.type === 'TROOP') stats.push([t('statKind'), kindLabel(c)]);
      if (attacks(c)) stats.push([t('statTargets'), targetsLabel(c)]);
      if (u.lifetime) stats.push([t('statLifetime'), t('seconds', { n: r1(u.lifetime) })]);
    }
    if (c.spell) {
      if (c.spell.damage > 0) stats.push([t('statDamage'), String(c.spell.damage)]);
      if (c.spell.radius > 0) stats.push([t('statRadius'), t('tiles', { n: r1(c.spell.radius / 1000) })]);
      if (c.spell.duration && c.spell.duration >= 0.5) stats.push([t('statDuration'), t('seconds', { n: r1(c.spell.duration) })]);
    }
    const modal = this.sheet(
      `<div class="mm-detail-head"><img src="${this.art.get(c)}" alt="" />
         <div><div class="nm">${esc(cardName(c))}</div>${ar ? `<div class="en" lang="en" dir="ltr">${esc(cardName(c, 'en'))}</div>` : ''}
           <div class="mm-badges"><span class="mm-badge cost">${ic('water_drop', '')} ${c.cost}</span>
             <span class="mm-badge">${t(`type1${c.type}` as 'type1TROOP')}</span>
             <span class="mm-badge">${t(`rarity${c.rarity}` as 'rarityCOMMON')}</span></div></div></div>
       <p class="mm-desc">${esc(cardDesc(c))}</p>
       <div class="mm-stats">${stats.map(([k, v]) => `<div class="mm-stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
       <div style="margin-top:16px">${this.btn('close', 'close', t('close'), { cls: 'center' })}</div>`,
    );
    modal.querySelector('[data-act="close"]')!.addEventListener('click', () => modal.remove());
  }

  /** Bottom sheet (or centred dialog) over the current screen; tapping outside closes it. */
  private sheet(html: string, centred = false): HTMLElement {
    const modal = document.createElement('div');
    modal.className = `mm-modal ${centred ? 'center' : ''}`;
    modal.innerHTML = `<div class="mm-sheet">${html}</div>`;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    this.stage.appendChild(modal);
    return modal;
  }

  private showHelp(): void {
    markHelpSeen();
    this.screens.querySelector('[data-act="help"]')?.classList.remove('pulse');
    const el = document.createElement('div');
    el.className = 'mm-help';
    const sections: [string, StringKey, StringKey][] = [
      ['flag', 'howGoalT', 'howGoal'],
      ['style', 'howDeckT', 'howDeck'],
      ['water_drop', 'howElixirT', 'howElixir'],
      ['touch_app', 'howDeployT', 'howDeploy'],
      ['lightbulb', 'howTipT', 'howTip'],
    ];
    el.innerHTML = `<div class="mm-help-card"><button class="mm-help-close" data-x aria-label="${t('close')}">×</button>
      <h2>${t('howTitle')}</h2>${sections.map(([i, h, p]) => `<h3>${ic(i)}${t(h)}</h3><p>${t(p)}</p>`).join('')}</div>`;
    this.stage.appendChild(el);
    const close = () => {
      el.remove();
      window.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    el.querySelector('[data-x]')!.addEventListener('click', close);
  }

  private editName(): void {
    const modal = this.sheet(
      `<h2>${t('nameTitle')}</h2>
       <input type="text" class="mm-input" maxlength="16" value="${esc(this.name)}" data-name-input />
       <div class="mm-row">${this.btn('x', '', t('cancel'), { cls: 'center' }).replace('data-act="x"', 'data-m="cancel"')}
         ${this.btn('x', '', t('save'), { cls: 'hero center' }).replace('data-act="x"', 'data-m="save"')}</div>`,
      true,
    );
    const input = modal.querySelector<HTMLInputElement>('[data-name-input]')!;
    input.focus();
    input.select();
    const close = () => modal.remove();
    modal.querySelector('[data-m="cancel"]')!.addEventListener('click', close);
    const save = () => {
      const value = input.value.trim();
      if (value.length >= 2) {
        this.conn.send({ type: 'setName', name: value });
        this.name = value;
        saveIdentity({ name: value });
      }
      close();
      if (this.screen === 'home') this.showHome();
    };
    modal.querySelector('[data-m="save"]')!.addEventListener('click', save);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  }

  showSettings(): void {
    const s = getSettings();
    const modal = this.sheet(
      `<h2>${t('settings')}</h2>
      <div class="mm-field"><label>${t('music')}</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-s="music" /></div>
      <div class="mm-field"><label>${t('sfx')}</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-s="sfx" /></div>
      <div class="mm-field"><label>${t('quality')}</label><select data-s="quality">
        <option value="low" ${s.quality === 'low' ? 'selected' : ''}>${t('qualityLow')}</option>
        <option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>${t('qualityMedium')}</option>
        <option value="high" ${s.quality === 'high' ? 'selected' : ''}>${t('qualityHigh')}</option></select></div>
      <div class="mm-field"><label>${t('cardSize')}</label><span class="mm-size-row"><b data-card-size-name>${t(`cardSize${s.cardSize}` as 'cardSize1')}</b>
        <button class="mm-btn small" data-m="preview">${t('preview')}</button></span></div>
      <div class="mm-field"><label>${t('language')}</label><select data-s="lang">
        <option value="ar" ${getLang() === 'ar' ? 'selected' : ''}>العربية</option>
        <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="mm-field"><label>${t('showFps')}</label><input type="checkbox" ${s.showFps ? 'checked' : ''} data-s="fps" /></div>
      <div style="margin-top:16px">${this.btn('x', '', t('close'), { cls: 'center' }).replace('data-act="x"', 'data-m="close"')}</div>`,
      true,
    );
    modal.querySelector<HTMLInputElement>('[data-s="music"]')!.addEventListener('input', (e) => updateSettings({ music: Number((e.target as HTMLInputElement).value) }));
    modal.querySelector<HTMLInputElement>('[data-s="sfx"]')!.addEventListener('input', (e) => {
      updateSettings({ sfx: Number((e.target as HTMLInputElement).value) });
      audio.play('click');
    });
    modal.querySelector<HTMLSelectElement>('[data-s="quality"]')!.addEventListener('change', (e) => updateSettings({ quality: (e.target as HTMLSelectElement).value as Quality }));
    modal.querySelector<HTMLInputElement>('[data-s="fps"]')!.addEventListener('change', (e) => updateSettings({ showFps: (e.target as HTMLInputElement).checked }));
    modal.querySelector<HTMLSelectElement>('[data-s="lang"]')!.addEventListener('change', (e) => {
      setLang((e.target as HTMLSelectElement).value as Lang);
      modal.remove();
      this.rerender();
    });
    modal.querySelector('[data-m="close"]')!.addEventListener('click', () => modal.remove());
    modal.querySelector('[data-m="preview"]')!.addEventListener('click', () => {
      modal.remove();
      new CardSizePreview(this.r, this.art, this.hudRoot, () => {
        this.rerender();
        this.showSettings();
      });
    });
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.stage.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  // ------------------------------------------------------------------------------------------
  // Network
  // ------------------------------------------------------------------------------------------

  private onConnState(s: string): void {
    if (s === 'open') {
      this.statusEl?.remove();
      this.statusEl = null;
      return;
    }
    if (s === 'reconnecting' && !this.statusEl) {
      this.statusEl = document.createElement('div');
      this.statusEl.className = 'status-bar';
      this.statusEl.textContent = navigator.onLine === false ? t('offline') : t('reconnecting');
      this.stage.appendChild(this.statusEl);
    }
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.name = m.name;
        if (this.screen === 'home') this.showHome();
        if (this.pendingJoin && !m.activeMatch) {
          this.conn.send({ type: 'joinRoom', code: this.pendingJoin });
          history.replaceState(null, '', location.pathname);
          this.pendingJoin = null;
        }
        if (!m.activeMatch && this.searching && this.screen === 'queue') {
          // A reconnect drops us from the server's queue: join it again so the search goes on.
          this.conn.send({ type: 'queue' });
        }
        if (!m.activeMatch && this.battle && !this.battle.ended) {
          // The server no longer knows our match (e.g. restarted): return to the menu.
          this.toast(t('matchCancelled'));
          this.showHome();
        }
        break;
      case 'nameSet':
        this.name = m.name;
        saveIdentity({ name: m.name });
        break;
      case 'queued':
        this.queueWaiting = m.waiting;
        this.screens.querySelector('[data-waiting]')?.replaceChildren(t('waitingPlayers', { n: m.waiting }));
        break;
      case 'roomCreated':
        this.showRoom(m.code);
        break;
      case 'matchStart':
        if (!this.assetsReady) {
          this.startQueue.push(m);
        } else {
          void this.onMatchStart(m);
        }
        break;
      case 'intro':
        if (this.screen === 'intro') this.screens.querySelector('[data-countdown]')?.replaceChildren(t('battleBegins'));
        break;
      case 'battleStart':
        if (this.screen === 'intro') this.hideScreens();
        this.battle?.handle(m);
        break;
      case 'end':
        this.onEnd(m);
        break;
      case 'rematchStatus':
        if (this.screen === 'result') {
          const el = this.screens.querySelector('[data-rematch-status]');
          if (el) el.textContent = m.opponentLeft ? t('opponentLeft') : m.opponentWants ? t('opponentWantsRematch') : '';
          if (m.opponentLeft) this.screens.querySelector<HTMLButtonElement>('[data-act="rematch"]')?.setAttribute('disabled', 'true');
        }
        break;
      case 'matchCancelled':
        if (m.matchId) this.cancelledMatches.add(m.matchId);
        if (!m.matchId || this.battle?.matchId === m.matchId) this.disposeBattle();
        if (m.requeued) {
          // The opponent never showed up: the server already put us back into the queue.
          this.toast(t('opponentNoShow'));
          this.searching = true;
          this.queueWaiting = 1;
          this.searchStarted = Date.now();
          this.showQueue();
        } else {
          this.toast(m.reason === 'youNotReady' ? t('youNotReady') : t('matchCancelled'));
          this.showHome();
        }
        break;
      case 'replaced':
        this.toast(t('replaced'));
        this.conn.close();
        this.set('home', `<div class="mm-content" style="justify-content:center;flex:1"><div class="mm-brand" style="margin:0 0 20px">${this.brand()}</div><div class="mm-card">${t('replaced')}</div></div>`);
        break;
      case 'serverShutdown':
        this.toast(t('serverRestart'));
        break;
      case 'error':
        this.onError(m.code, m.message);
        break;
      default:
        this.battle?.handle(m);
    }
  }

  private onError(code: string, message: string): void {
    if (code === 'matchCrashed' || (code === 'noMatch' && (this.screen === 'intro' || (this.battle && !this.battle.ended)))) {
      // The match is gone on the server: never leave the player on a frozen battlefield.
      this.toast(t('matchCancelled'));
      this.disposeBattle();
      this.showHome();
      return;
    }
    const known = ['roomNotFound', 'ownRoom', 'serverFull', 'inMatch'];
    this.toast(known.includes(code) ? t(code as 'roomNotFound') : message);
    if (['roomNotFound', 'serverFull'].includes(code) && this.screen === 'queue') this.showHome();
  }

  private async onMatchStart(m: MatchStart): Promise<void> {
    if (this.battle && this.battle.matchId === m.matchId) {
      // Reconnected to the same match: resynchronise from fresh snapshots.
      this.battle.view.resync();
      if (m.state === 'RUNNING') {
        this.hideScreens();
        this.battle.begin(false);
      }
      return;
    }
    this.searching = false;
    this.disposeBattle();
    this.lastSeed = m.mode === 'bot' ? m.seed : null;
    this.roomCode = null;
    // Make sure every bundle this arena and deck can use is loaded before building the scene.
    // ...and the deck's own forged character models (a few hundred KB, loaded once per page).
    const forged = m.deck.map((id) => forgedFileFor(cards.get(id)?.unit?.name)).filter((f): f is string => !!f);
    // The intro (opponent, arena, shared deck) goes up at once: the countdown is already running
    // on the server, so it must not wait for the downloads below.
    const intro = m.state !== 'RUNNING' && m.state !== 'ENDED';
    if (intro) this.showIntro(m);
    await assets.loadAll([...new Set([...themeBundles(m.arena.id), ...EXTRA_BUNDLES, ...forged])]);
    if (this.cancelledMatches.has(m.matchId)) return; // cancelled while we were loading
    if (!ARENA_THEMES[m.arena.id]) console.warn('Unknown arena theme', m.arena.id);
    this.battle = new BattleSession(m, this.conn, this.r, this.hudRoot, this.art, this.stage);
    this.battle.onSurrender = () => this.confirmSurrender();
    if (!intro) {
      this.hideScreens();
    } else if (this.screen === 'intro') {
      // portraits drawn before the deck's own models arrived: redraw them now
      for (const img of this.screens.querySelectorAll<HTMLImageElement>('[data-intro-card] img')) {
        const c = cards.get(img.parentElement!.dataset.introCard!);
        if (c) img.src = this.art.get(c);
      }
    }
    this.conn.send({ type: 'ready', matchId: m.matchId });
  }

  private showIntro(m: MatchStart): void {
    const arenaName = getLang() === 'ar' ? m.arena.nameAr : m.arena.name;
    this.rerender = () => {};
    this.set(
      'intro',
      `<div class="mm-content" style="justify-content:center;flex:1">
         <div class="mm-note" style="margin-bottom:0">${t('arena')} ${m.arena.number} · ${esc(arenaName)}</div>
         <div class="mm-vs"><div class="p enemy">${esc(m.opponent.name)}${m.opponent.bot ? ' 🤖' : ''}</div>
           <div class="x">${t('vs')}</div><div class="p own">${esc(this.name)}</div></div>
         <div class="mm-note" style="margin-bottom:0">${t('sharedDeck')}</div>
         <div class="mm-deck">${m.deck
           .map((id) => {
             const c = cards.get(id);
             return c ? `<div class="mm-tile ${c.rarity.toLowerCase()}" data-intro-card="${c.id}" title="${esc(cardName(c))}"><img class="art" src="${this.art.get(c)}" alt="" /><span class="mm-cost"><span>${c.cost}</span></span></div>` : '';
           })
           .join('')}</div>
         <h2 class="mm-header" data-countdown style="margin:10px 0 0">${t('loading')}</h2>
       </div>`,
      'overlay',
    );
  }

  private hideScreens(): void {
    this.screen = 'battle';
    this.screens.innerHTML = '';
    this.setMenuMode(false);
  }

  private confirmSurrender(): void {
    if (!this.battle) return;
    const modal = this.sheet(
      `<h2>${t('surrenderConfirm')}</h2>
       <div class="mm-row">${this.btn('x', '', t('no'), { cls: 'center' }).replace('data-act="x"', 'data-m="no"')}
         ${this.btn('x', '', t('yes'), { cls: 'red center' }).replace('data-act="x"', 'data-m="yes"')}</div>`,
      true,
    );
    modal.querySelector('[data-m="no"]')!.addEventListener('click', () => modal.remove());
    modal.querySelector('[data-m="yes"]')!.addEventListener('click', () => {
      modal.remove();
      if (this.battle) this.conn.send({ type: 'leave', matchId: this.battle.matchId });
    });
  }

  private onEnd(m: MatchEnd): void {
    if (!this.battle || this.battle.matchId !== m.matchId) return;
    this.battle.end();
    this.resultEnd = m;
    audio.playMusic('menu');
    audio.play(m.draw ? 'crown' : m.youWon ? 'victory' : 'defeat');
    // Let the final explosions play before the overlay.
    setTimeout(() => this.showResult(m), 1300);
  }

  private showResult(m: MatchEnd): void {
    if (this.resultEnd !== m) return;
    const you = this.battle?.start.you ?? 'BLUE';
    const opp = you === 'BLUE' ? 'RED' : 'BLUE';
    const title = m.draw ? t('draw') : m.youWon ? t('victory') : t('defeat');
    const isBot = this.battle?.start.mode === 'bot';
    this.rerender = () => {};
    this.set(
      'result',
      `<div class="mm-content" style="justify-content:center;flex:1">
         <h1 class="mm-result-title ${m.youWon ? 'win' : 'lose'}" data-result="${m.draw ? 'draw' : m.youWon ? 'win' : 'lose'}">${title}</h1>
         <div class="mm-result-crowns"><span style="color:#8ac0ff">${m.crowns[you]}</span><span style="color:var(--gold-500);width:34px">${glyph.crown}</span><span style="color:#ff8a92">${m.crowns[opp]}</span></div>
         <div class="mm-note" style="margin-bottom:0">${t(('reason_' + m.reason) as 'reason_crowns')}</div>
         <div class="mm-note" data-rematch-status></div>
         <div class="mm-menu" style="margin-top:0">
           ${isBot
             ? `${this.btn('sameDeck', 'replay', t('rematchSameDeck'), { cls: 'hero' })}${this.btn('newDeck', 'casino', t('newDeck'))}`
             : this.btn('rematch', 'replay', t('rematch'), { cls: 'hero' })}
           ${this.btn('menu', 'home', t('menu'))}
         </div>
       </div>`,
      'overlay',
    );
    this.bind({
      rematch: () => {
        if (!this.battle) return;
        this.conn.send({ type: 'rematch', matchId: this.battle.matchId, sameDeck: false });
        const el = this.screens.querySelector('[data-rematch-status]');
        if (el) el.textContent = t('waitingRematch');
      },
      sameDeck: () => {
        if (!this.battle) return;
        this.conn.send({ type: 'rematch', matchId: this.battle.matchId, sameDeck: true });
      },
      newDeck: () => {
        if (!this.battle) return;
        this.conn.send({ type: 'rematch', matchId: this.battle.matchId, sameDeck: false });
      },
      menu: () => {
        if (this.battle) this.conn.send({ type: 'leave', matchId: this.battle.matchId });
        this.showHome();
      },
    });
    void this.lastSeed;
    void this.lastBotDifficulty;
  }

  private disposeBattle(): void {
    if (this.battle) {
      this.battle.dispose();
      this.battle = null;
    }
    this.resultEnd = null;
  }

  /** Read-only state for automated browser tests. */
  debugState(): Record<string, unknown> {
    const b = this.battle;
    return {
      screen: this.screen,
      name: this.name,
      guestId: loadIdentity().guestId,
      connected: this.conn.isOpen,
      roomCode: this.roomCode,
      match: b
        ? {
            id: b.matchId,
            you: b.start.you,
            arena: b.start.arena.id,
            seed: b.start.seed,
            opponent: b.start.opponent.name,
            deck: b.start.deck,
            mode: b.start.mode,
            running: b.running,
            ended: b.ended,
            tick: b.lastSnapshot?.tick ?? -1,
            elixir: b.lastSnapshot?.me?.elixir ?? null,
            hand: b.lastSnapshot?.me?.hand ?? null,
            entities: b.lastSnapshot?.e.length ?? 0,
            towers: b.lastSnapshot?.e.filter((e) => e[3] === 'K' || e[3] === 'P').map((e) => ({ id: e[0], team: e[2], kind: e[3], hp: e[7] })) ?? [],
            view: b.view.stats(),
          }
        : null,
      fps: this.r.fps,
      audio: { unlocked: audio.unlocked, ready: audio.ready, state: audio.state(), samples: audio.sampleCount, music: audio.musicInfo() },
      failedAssets: [...assets.failed],
      renderer: this.r.info(),
      result: this.resultEnd ? { youWon: this.resultEnd.youWon, draw: this.resultEnd.draw, reason: this.resultEnd.reason } : null,
    };
  }

  /** Test hook: screen position (relative to the stage) of a game-unit arena position. */
  debugProject(gx: number, gy: number): { x: number; y: number } {
    const p = this.r.project(new THREE.Vector3(gx / 1000 - 9, 0, 16 - gy / 1000));
    const rect = this.stage.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  /** Test hook: the authoritative state this client saw at a given tick. */
  debugSnapshot(tick: number): unknown {
    return this.battle?.history.get(tick) ?? null;
  }

  /** Test hook: ticks for which this client holds a snapshot. */
  debugTicks(): number[] {
    return this.battle ? [...this.battle.history.keys()] : [];
  }

  /** Test hook: plays a card through the same path as a drag (used by Playwright). */
  debugPlay(slot: number, gx: number, gy: number): boolean {
    const b = this.battle as unknown as { play?: (s: number, id: string, c: number, x: number, y: number) => void; hud: { cardAt(s: number): string | null } } | null;
    if (!b) return false;
    const id = b.hud.cardAt(slot);
    const card = id ? cards.get(id) : undefined;
    if (!card || !b.play) return false;
    b.play.call(this.battle, slot, card.id, card.cost, gx, gy);
    return true;
  }
}
