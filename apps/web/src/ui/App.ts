import * as THREE from 'three';
import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { BattleSession } from '../game/BattleSession';
import { cards } from '../game/cards';
import { getLang, setLang, t, type Lang } from '../i18n/strings';
import { Connection } from '../network/Connection';
import { loadIdentity, provisionalName, saveIdentity } from '../network/identity';
import type { MatchEnd, MatchStart, ServerMessage } from '../network/protocol';
import { ARENA_THEMES, themeBundles } from '../rendering/arenaThemes';
import { CardArt } from '../rendering/CardArt';
import { Renderer3D } from '../rendering/Renderer3D';
import { CORE_MODEL_FILES, resetClipCache } from '../rendering/UnitFactory';
import { getSettings, updateSettings, type Quality } from './settings';

type Screen = 'loading' | 'home' | 'queue' | 'bot' | 'friend' | 'room' | 'intro' | 'battle' | 'result';

const EXTRA_BUNDLES = ['card_buildings.glb', 'props_dungeon.glb', 'props_spooky.glb'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
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

  private set(screen: Screen, html: string, backdrop = true): void {
    this.screen = screen;
    this.screens.innerHTML = `<div class="screen ${backdrop ? 'backdrop' : ''}" data-screen="${screen}">${html}</div>`;
  }

  private renderLoading(pct: number, text: string): void {
    if (this.screen !== 'loading') return;
    const existing = this.screens.querySelector<HTMLElement>('[data-screen="loading"]');
    if (existing) {
      existing.querySelector<HTMLElement>('.progress > div')!.style.width = `${pct}%`;
      existing.querySelector<HTMLElement>('[data-text]')!.textContent = text;
      return;
    }
    this.set(
      'loading',
      `<div class="logo">AnyRoyale</div><div class="tagline">${t('tagline')}</div>
       <div class="progress"><div style="width:${pct}%"></div></div>
       <div class="muted" data-text>${esc(text)}</div>`,
    );
  }

  private renderLoadError(): void {
    this.set(
      'loading',
      `<div class="logo">AnyRoyale</div><div class="panel"><p>${t('loadFailed')}</p>
       <button class="btn" data-act="retry">${t('retry')}</button></div>`,
    );
    this.screens.querySelector('[data-act="retry"]')!.addEventListener('click', () => location.reload());
  }

  showHome(): void {
    this.disposeBattle();
    audio.playMusic('menu');
    this.set(
      'home',
      `<div class="toolbar"><button class="icon-btn" data-act="settings" aria-label="${t('settings')}">⚙️</button></div>
       <div class="logo">AnyRoyale</div>
       <div class="tagline">${t('tagline')}</div>
       <button class="name-chip" data-act="name"><span>👤 ${esc(this.name)}</span><small>✏️ ${t('editName')}</small></button>
       <div class="menu">
         <button class="btn" data-act="online">⚔️ ${t('playOnline')}</button>
         <button class="btn blue" data-act="bot">🤖 ${t('training')}</button>
         <button class="btn green" data-act="friend">🤝 ${t('friend')}</button>
       </div>
       <div class="muted" style="max-width:320px">${t('howTo')}</div>`,
    );
    this.bind({
      settings: () => this.showSettings(),
      name: () => this.editName(),
      online: () => this.queueOnline(),
      bot: () => this.showBot(),
      friend: () => this.showFriend(),
    });
  }

  private bind(actions: Record<string, () => void>): void {
    for (const el of this.screens.querySelectorAll<HTMLElement>('[data-act]')) {
      const act = el.dataset.act!;
      if (actions[act]) {
        el.addEventListener('click', () => {
          audio.play('click', { volume: 0.5 });
          actions[act]();
        });
      }
    }
  }

  private queueOnline(): void {
    this.conn.send({ type: 'queue' });
    this.queueWaiting = 1;
    this.showQueue();
  }

  private showQueue(): void {
    this.set(
      'queue',
      `<div class="spinner"></div><h2>${t('searching')}</h2>
       <div class="muted" data-waiting>${t('waitingPlayers', { n: this.queueWaiting })}</div>
       <div class="muted" style="max-width:300px">${t('searchingHint')}</div>
       <div class="menu"><button class="btn gray" data-act="cancel">${t('cancel')}</button></div>`,
    );
    this.bind({
      cancel: () => {
        this.conn.send({ type: 'cancelQueue' });
        this.showHome();
      },
    });
  }

  private showBot(): void {
    const diffs = ['easy', 'normal', 'hard', 'expert'] as const;
    this.set(
      'bot',
      `<h2>${t('chooseDifficulty')}</h2>
       <div class="difficulty-grid panel">
         ${diffs
           .map(
             (d) =>
               `<button class="btn ${d === 'easy' ? 'green' : d === 'normal' ? 'blue' : d === 'hard' ? '' : 'red'}" data-act="d_${d}">${t(d)}<span class="sub">${t((d + 'Desc') as 'easyDesc')}</span></button>`,
           )
           .join('')}
       </div>
       <div class="menu"><button class="btn gray" data-act="back">${t('back')}</button></div>`,
    );
    const actions: Record<string, () => void> = { back: () => this.showHome() };
    for (const d of diffs) actions[`d_${d}`] = () => this.startBot(d, null);
    this.bind(actions);
  }

  private startBot(difficulty: string, seed: string | null): void {
    this.lastBotDifficulty = difficulty;
    this.conn.send(seed ? { type: 'startBot', difficulty, seed } : { type: 'startBot', difficulty });
    this.set('queue', `<div class="spinner"></div><div class="muted">${t('loading')}</div>`);
  }

  private showFriend(): void {
    this.set(
      'friend',
      `<h2>🤝 ${t('friend')}</h2>
       <div class="panel">
         <button class="btn" data-act="create" style="width:100%">${t('createRoom')}</button>
         <div class="row" style="margin-top:16px"><input type="text" maxlength="6" placeholder="${t('roomCode')}" data-code autocapitalize="characters" autocomplete="off" /></div>
         <button class="btn blue" data-act="join" style="width:100%">${t('join')}</button>
       </div>
       <div class="menu"><button class="btn gray" data-act="back">${t('back')}</button></div>`,
    );
    this.bind({
      back: () => this.showHome(),
      create: () => this.conn.send({ type: 'createRoom' }),
      join: () => {
        const code = this.screens.querySelector<HTMLInputElement>('[data-code]')!.value.trim().toUpperCase();
        if (code) this.conn.send({ type: 'joinRoom', code });
      },
    });
  }

  private showRoom(code: string): void {
    this.roomCode = code;
    const link = `${location.origin}/?room=${code}`;
    this.set(
      'room',
      `<h2>${t('shareCode')}</h2>
       <div class="code" data-room-code>${esc(code)}</div>
       <div class="menu">
         <button class="btn blue" data-act="copy">🔗 ${t('copyLink')}</button>
         ${'share' in navigator ? `<button class="btn green" data-act="share">📤 ${t('share')}</button>` : ''}
       </div>
       <div class="spinner"></div><div class="muted">${t('waitingFriend')}</div>
       <div class="menu"><button class="btn gray" data-act="cancel">${t('cancel')}</button></div>`,
    );
    this.bind({
      copy: () => {
        void navigator.clipboard?.writeText(link).then(
          () => this.toast(t('copied')),
          () => this.toast(link),
        );
      },
      share: () => void navigator.share?.({ title: 'AnyRoyale', text: `AnyRoyale ${code}`, url: link }).catch(() => {}),
      cancel: () => {
        this.conn.send({ type: 'cancelRoom' });
        this.roomCode = null;
        this.showHome();
      },
    });
  }

  private editName(): void {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="panel"><h2>${t('nameTitle')}</h2>
      <input type="text" maxlength="16" value="${esc(this.name)}" data-name-input />
      <div class="row" style="margin-top:14px"><button class="btn gray small" data-m="cancel">${t('cancel')}</button>
      <button class="btn green small" data-m="save">${t('save')}</button></div></div>`;
    this.stage.appendChild(modal);
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
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="panel"><h2>⚙️ ${t('settings')}</h2>
      <div class="row"><label>🎵 ${t('music')}</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-s="music" /></div>
      <div class="row"><label>🔊 ${t('sfx')}</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-s="sfx" /></div>
      <div class="row"><label>🖥️ ${t('quality')}</label><select data-s="quality">
        <option value="auto" ${s.quality === 'auto' ? 'selected' : ''}>${t('qualityAuto')}</option>
        <option value="high" ${s.quality === 'high' ? 'selected' : ''}>${t('qualityHigh')}</option>
        <option value="low" ${s.quality === 'low' ? 'selected' : ''}>${t('qualityLow')}</option></select></div>
      <div class="row"><label>🌐 ${t('language')}</label><select data-s="lang">
        <option value="ar" ${getLang() === 'ar' ? 'selected' : ''}>العربية</option>
        <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="row"><label>📈 ${t('showFps')}</label><input type="checkbox" ${s.showFps ? 'checked' : ''} data-s="fps" /></div>
      <button class="btn small" data-m="close" style="width:100%;margin-top:8px">${t('close')}</button></div>`;
    this.stage.appendChild(modal);
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
      if (this.screen === 'home') this.showHome();
    });
    modal.querySelector('[data-m="close"]')!.addEventListener('click', () => modal.remove());
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
        this.toast(t('matchCancelled'));
        this.showHome();
        break;
      case 'replaced':
        this.toast(t('replaced'));
        this.conn.close();
        this.set('home', `<div class="logo">AnyRoyale</div><div class="panel">${t('replaced')}</div>`);
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
    const known = ['roomNotFound', 'ownRoom', 'serverFull', 'inMatch'];
    this.toast(known.includes(code) ? t(code as 'roomNotFound') : message);
    if (['roomNotFound', 'serverFull'].includes(code) && (this.screen === 'queue' || this.screen === 'friend')) this.showHome();
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
    this.disposeBattle();
    this.lastSeed = m.mode === 'bot' ? m.seed : null;
    this.roomCode = null;
    // Make sure every bundle this arena and deck can use is loaded before building the scene.
    await assets.loadAll([...new Set([...themeBundles(m.arena.id), ...EXTRA_BUNDLES])]);
    if (!ARENA_THEMES[m.arena.id]) console.warn('Unknown arena theme', m.arena.id);
    this.battle = new BattleSession(m, this.conn, this.r, this.hudRoot, this.art, this.stage);
    this.battle.onSurrender = () => this.confirmSurrender();
    if (m.state === 'RUNNING' || m.state === 'ENDED') {
      this.hideScreens();
    } else {
      this.showIntro(m);
    }
    this.conn.send({ type: 'ready', matchId: m.matchId });
  }

  private showIntro(m: MatchStart): void {
    const arenaName = getLang() === 'ar' ? m.arena.nameAr : m.arena.name;
    this.set(
      'intro',
      `<div class="muted">${t('arena')} ${m.arena.number} · ${esc(arenaName)}</div>
       <div class="vs"><div class="player enemy">${esc(m.opponent.name)}${m.opponent.bot ? ' 🤖' : ''}</div>
       <div class="x">${t('vs')}</div><div class="player own">${esc(this.name)}</div></div>
       <div class="muted">${t('sharedDeck')}</div>
       <div class="deck-preview">${m.deck
         .map((id) => {
           const c = cards.get(id);
           return c ? `<div class="card ${c.rarity.toLowerCase()}" title="${esc(c.name)}"><img src="${this.art.get(c)}" alt="${esc(c.name)}" /><div class="cost"><span>${c.cost}</span></div></div>` : '';
         })
         .join('')}</div>
       <h2 data-countdown>${t('loading')}</h2>`,
    );
  }

  private hideScreens(): void {
    this.screen = 'battle';
    this.screens.innerHTML = '';
  }

  private confirmSurrender(): void {
    if (!this.battle) return;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="panel"><h2>${t('surrenderConfirm')}</h2><div class="row">
      <button class="btn gray small" data-m="no">${t('no')}</button><button class="btn red small" data-m="yes">${t('yes')}</button></div></div>`;
    this.stage.appendChild(modal);
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
    this.set(
      'result',
      `<div class="result-title ${m.youWon ? 'win' : 'lose'}" data-result="${m.draw ? 'draw' : m.youWon ? 'win' : 'lose'}">${title}</div>
       <div class="result-crowns"><span style="color:#8ac0ff">👑 ${m.crowns[you]}</span> — <span style="color:#ff8a8a">${m.crowns[opp]} 👑</span></div>
       <div class="muted">${t(('reason_' + m.reason) as 'reason_crowns')}</div>
       <div class="muted" data-rematch-status></div>
       <div class="menu">
         ${isBot
           ? `<button class="btn green" data-act="sameDeck">🔁 ${t('rematchSameDeck')}</button>
              <button class="btn blue" data-act="newDeck">🎲 ${t('newDeck')}</button>`
           : `<button class="btn green" data-act="rematch">⚔️ ${t('rematch')}</button>`}
         <button class="btn gray" data-act="menu">🏠 ${t('menu')}</button>
       </div>`,
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
      audio: { unlocked: audio.unlocked, ready: audio.ready, state: audio.state() },
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
