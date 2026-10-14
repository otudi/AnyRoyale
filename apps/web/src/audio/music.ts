/**
 * Background music: recorded CC0 tracks (public/assets/sfx/music-*.mp3, see docs/ASSETS.md),
 * streamed by <audio> elements routed through Web Audio so the music volume, mute and fades work
 * everywhere (iOS ignores element.volume).
 *
 * The lobby and the battle share one theme so they feel connected: in the menus it plays softly
 * through a low-pass filter (as if heard from outside the arena), and when a battle starts the
 * filter opens and the same music, without restarting, swells to full. Overtime crossfades to a
 * second, more urgent battle track.
 */
export type Track = 'menu' | 'battle' | 'none';
type Channel = 'battle' | 'overtime';

const FADE = 0.9;
/** Low-pass cut-off in the menus (Hz) and when the battle opens it up. */
const MENU_CUTOFF = 900;
const OPEN_CUTOFF = 18000;
const MENU_LEVEL = 0.7;

export class MusicPlayer {
  private channels = new Map<Channel, { el: HTMLAudioElement; gain: GainNode; filter: BiquadFilterNode }>();
  private current: Channel | null = null;
  private wanted: Track = 'none';
  private overtime = false;
  private hidden = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly base: string,
  ) {}

  private channel(name: Channel): { el: HTMLAudioElement; gain: GainNode; filter: BiquadFilterNode } {
    let c = this.channels.get(name);
    if (!c) {
      const el = new Audio();
      el.src = `${this.base}music-${name}.mp3`;
      el.loop = true;
      el.preload = name === 'battle' ? 'auto' : 'metadata';
      el.setAttribute('playsinline', '');
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = OPEN_CUTOFF;
      filter.Q.value = 0.5;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      try {
        this.ctx.createMediaElementSource(el).connect(filter);
        filter.connect(gain);
        gain.connect(this.out);
      } catch {
        // no MediaElementSource: the element plays at its own volume
      }
      c = { el, gain, filter };
      this.channels.set(name, c);
    }
    return c;
  }

  /**
   * Call inside a user gesture: starts and immediately pauses every track so mobile Safari lets
   * them play later without a gesture (each media element needs its own first play).
   */
  bless(): void {
    for (const name of ['battle', 'overtime'] as Channel[]) {
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
    const next: Channel | null = this.wanted === 'none' ? null : this.wanted === 'battle' && this.overtime ? 'overtime' : 'battle';
    const now = this.ctx.currentTime;
    const menu = this.wanted === 'menu';
    if (next && next === this.current) {
      // same music, new mood: muffled and softer in the menus, open and full in battle
      const c = this.channels.get(next)!;
      this.shape(c, menu ? MENU_CUTOFF : OPEN_CUTOFF, menu ? MENU_LEVEL : 1, menu ? 1.2 : 2.2, now);
      return;
    }
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
    if (next === 'overtime') c.el.currentTime = 0;
    c.filter.frequency.cancelScheduledValues(now);
    c.filter.frequency.setValueAtTime(menu ? MENU_CUTOFF : OPEN_CUTOFF, now);
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(menu ? MENU_LEVEL : 1, now + FADE);
    if (!this.hidden) void c.el.play().catch(() => {});
  }

  private shape(c: { gain: GainNode; filter: BiquadFilterNode }, cutoff: number, level: number, secs: number, now: number): void {
    c.filter.frequency.cancelScheduledValues(now);
    c.filter.frequency.setValueAtTime(Math.max(40, c.filter.frequency.value), now);
    c.filter.frequency.exponentialRampToValueAtTime(cutoff, now + secs);
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(level, now + secs);
  }
}
