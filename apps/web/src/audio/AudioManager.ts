import { getSettings, onSettings } from '../ui/settings';
import { MusicPlayer, type Track } from './music';
import { renderSfx, SFX, type SfxName } from './sfx';

/**
 * Owns the single AudioContext. Browsers (Safari especially) only allow audio after a user
 * gesture, so the context is created/resumed by {@link unlock}, which main.ts wires to the first
 * pointer/key event. Before that, play() calls are silently dropped. The context is suspended while
 * the page is hidden to save battery and resumed on return.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private buffers = new Map<SfxName, AudioBuffer>();
  /** Recorded CC0 samples (public/assets/sfx); they replace the synthesised fallback once decoded. */
  private samples = new Map<SfxName, AudioBuffer[]>();
  private music: MusicPlayer | null = null;
  private pendingTrack: Track = 'none';
  private voices = new Map<SfxName, number>();
  private totalVoices = 0;
  private lastPlay = new Map<SfxName, number>();
  unlocked = false;

  constructor() {
    onSettings(() => this.applyVolumes());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      const hidden = document.visibilityState === 'hidden';
      if (hidden) void this.ctx.suspend();
      else void this.ctx.resume();
      this.music?.setHidden(hidden);
    });
  }

  /** Call from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      // iOS: Web Audio is silenced by the ring/silent switch unless the page's audio session is
      // 'playback' (like a video). Safari 16.4+ exposes this; older browsers ignore it.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) {
        try {
          session.type = 'playback';
        } catch {
          // read-only in some versions
        }
      }
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.applyVolumes();
      this.music = new MusicPlayer(this.ctx, this.musicBus, `${import.meta.env.BASE_URL}assets/sfx/`);
      this.applyVolumes(); // the player must know about mute before its first play
      this.music.bless();
      // iOS: play a silent buffer inside the gesture to fully unlock output.
      const silent = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = silent;
      src.connect(this.ctx.destination);
      src.start(0);
      void this.prerender();
      void this.loadSamples();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    this.unlocked = true;
    if (this.pendingTrack !== 'none') this.playMusic(this.pendingTrack);
  }

  private async prerender(): Promise<void> {
    const ctx = this.ctx!;
    for (const name of Object.keys(SFX) as SfxName[]) {
      try {
        const raw = await renderSfx(name, ctx.sampleRate);
        this.buffers.set(name, trim(ctx, raw));
      } catch {
        // OfflineAudioContext unsupported: that sound stays silent
      }
    }
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx!;
    const base = `${import.meta.env.BASE_URL}assets/sfx/`;
    let index: { sounds: Record<string, string[]> };
    try {
      index = await (await fetch(`${base}index.json`)).json();
    } catch {
      return; // offline: keep the synthesised sounds
    }
    await Promise.all(
      Object.entries(index.sounds).map(async ([name, files]) => {
        const list: AudioBuffer[] = [];
        for (const f of files) {
          try {
            const data = await (await fetch(base + f)).arrayBuffer();
            // callback form: older Safari has no promise-returning decodeAudioData
            list.push(await new Promise<AudioBuffer>((ok, fail) => ctx.decodeAudioData(data, ok, fail)));
          } catch {
            // that variant stays unavailable
          }
        }
        if (list.length) this.samples.set(name as SfxName, list);
      }),
    );
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = getSettings();
    const on = s.muted ? 0 : 1;
    // the master gain silences everything routed through Web Audio; the music elements are
    // muted on their own as well (iOS can play them outside the graph)
    this.master.gain.value = on;
    this.musicBus.gain.value = s.music * 0.38 * on;
    this.sfxBus.gain.value = s.sfx * on;
    this.music?.setMuted(s.muted || s.music <= 0);
  }

  playMusic(track: Track): void {
    this.pendingTrack = track;
    if (this.music && this.unlocked) this.music.play(track);
  }

  setMusicIntensity(v: number): void {
    this.music?.setIntensity(v);
  }

  /**
   * Plays an effect. {@code pan} -1..1 positions it left/right (from the arena x coordinate);
   * {@code volume} scales it (distant/minor events quieter). Rate-limited per sound so a swarm of
   * twenty skeletons does not produce twenty overlapping clicks.
   */
  play(name: SfxName, opts: { pan?: number; volume?: number; rate?: number } = {}): void {
    const ctx = this.ctx;
    const variants = this.samples.get(name);
    const buf = variants ? variants[Math.floor(Math.random() * variants.length)] : this.buffers.get(name);
    if (!ctx || !buf || ctx.state !== 'running' || getSettings().sfx <= 0 || getSettings().muted) return;
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.035) return;
    const active = this.voices.get(name) ?? 0;
    if (active >= 4 || this.totalVoices >= 24) return;
    this.lastPlay.set(name, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let node: AudioNode = src.connect(g);
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node = node.connect(p);
    }
    node.connect(this.sfxBus);
    this.voices.set(name, active + 1);
    this.totalVoices++;
    src.onended = () => {
      this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      this.totalVoices = Math.max(0, this.totalVoices - 1);
    };
    src.start();
  }

  state(): string {
    return this.ctx?.state ?? 'none';
  }

  musicInfo(): { track: string | null; playing: boolean; time: number; muted: boolean } {
    return this.music?.info() ?? { track: null, playing: false, time: 0, muted: false };
  }

  get sampleCount(): number {
    return this.samples.size;
  }

  get ready(): boolean {
    return this.buffers.size > 0 || this.samples.size > 0;
  }
}

function trim(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const data = buf.getChannelData(0);
  let end = data.length - 1;
  while (end > 0 && Math.abs(data[end]) < 0.0008) end--;
  const len = Math.max(1, end + Math.floor(ctx.sampleRate * 0.02));
  const out = ctx.createBuffer(1, Math.min(len, data.length), buf.sampleRate);
  out.copyToChannel(data.subarray(0, out.length), 0);
  return out;
}

export const audio = new AudioManager();
