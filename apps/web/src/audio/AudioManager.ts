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
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Call from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.applyVolumes();
      this.music = new MusicPlayer(this.ctx, this.musicBus);
      // iOS: play a silent buffer inside the gesture to fully unlock output.
      const silent = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = silent;
      src.connect(this.ctx.destination);
      src.start(0);
      void this.prerender();
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

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = getSettings();
    this.musicBus.gain.value = s.music * 0.6;
    this.sfxBus.gain.value = s.sfx;
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
    const buf = this.buffers.get(name);
    if (!ctx || !buf || ctx.state !== 'running' || getSettings().sfx <= 0) return;
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

  get ready(): boolean {
    return this.buffers.size > 0;
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
