/**
 * Background music: recorded CC0 tracks (public/assets/sfx/music-*.mp3, see docs/ASSETS.md),
 * streamed by <audio> elements routed through Web Audio so the music volume, mute and fades work
 * everywhere (iOS ignores element.volume). Tracks crossfade; overtime switches to a second, more
 * urgent battle track.
 */
export type Track = 'menu' | 'battle' | 'none';
type Channel = 'menu' | 'battle' | 'overtime';

const FADE = 0.9;

export class MusicPlayer {
  private channels = new Map<Channel, { el: HTMLAudioElement; gain: GainNode }>();
  private current: Channel | null = null;
  private wanted: Track = 'none';
  private overtime = false;
  private hidden = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly base: string,
  ) {}

  private channel(name: Channel): { el: HTMLAudioElement; gain: GainNode } {
    let c = this.channels.get(name);
    if (!c) {
      const el = new Audio();
      el.src = `${this.base}music-${name}.mp3`;
      el.loop = true;
      el.preload = name === 'menu' ? 'auto' : 'metadata';
      el.setAttribute('playsinline', '');
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      try {
        this.ctx.createMediaElementSource(el).connect(gain);
        gain.connect(this.out);
      } catch {
        // no MediaElementSource: the element plays at its own volume
      }
      c = { el, gain };
      this.channels.set(name, c);
    }
    return c;
  }

  /**
   * Call inside a user gesture: starts and immediately pauses every track so mobile Safari lets
   * them play later without a gesture (each media element needs its own first play).
   */
  bless(): void {
    for (const name of ['menu', 'battle', 'overtime'] as Channel[]) {
      const c = this.channel(name);
      c.el
        .play()
        .then(() => {
          if (this.current !== name) c.el.pause();
        })
        .catch(() => {});
    }
  }

  /** For tests: which track is audible and whether its element is actually playing. */
  info(): { track: string | null; playing: boolean; time: number } {
    const c = this.current ? this.channels.get(this.current) : undefined;
    return { track: this.current, playing: !!c && !c.el.paused, time: c ? c.el.currentTime : 0 };
  }

  play(track: Track): void {
    this.wanted = track;
    this.apply();
  }

  /** 1 during regular time, more in overtime. */
  setIntensity(v: number): void {
    this.overtime = v > 1.05;
    this.apply();
  }

  /** Page hidden: pause streaming (the context is suspended anyway); resume on return. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const c = this.current ? this.channels.get(this.current) : undefined;
    if (!c) return;
    if (hidden) c.el.pause();
    else void c.el.play().catch(() => {});
  }

  private apply(): void {
    const next: Channel | null = this.wanted === 'none' ? null : this.wanted === 'battle' && this.overtime ? 'overtime' : this.wanted;
    if (next === this.current) return;
    const now = this.ctx.currentTime;
    const prev = this.current ? this.channels.get(this.current) : undefined;
    const prevName = this.current;
    this.current = next;
    if (prev) {
      prev.gain.gain.cancelScheduledValues(now);
      prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
      prev.gain.gain.linearRampToValueAtTime(0, now + FADE);
      window.setTimeout(() => {
        if (this.current !== prevName) prev.el.pause();
      }, FADE * 1000 + 100);
    }
    if (!next) return;
    const c = this.channel(next);
    // a new battle starts its music from the top; the menu resumes where it was
    if (next !== 'menu' && prevName !== 'battle' && prevName !== 'overtime') c.el.currentTime = 0;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(1, now + FADE);
    if (!this.hidden) void c.el.play().catch(() => {});
  }
}
