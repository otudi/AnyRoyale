/**
 * Background music: recorded CC0 tracks (public/assets/sfx/music-*.mp3, see docs/ASSETS.md),
 * streamed by <audio> elements routed through Web Audio so the music volume and fades work
 * everywhere (iOS ignores element.volume).
 *
 * Calm by design: a gentle town theme in the menus, an unhurried medieval theme in battle and a
 * slightly livelier one in overtime, crossfaded when the mood changes.
 *
 * Mute does not rely on the Web Audio graph alone: on iOS a media element can end up playing
 * outside the graph (interrupted context, routing lost), so muting also mutes and pauses the
 * elements themselves.
 */
export type Track = 'menu' | 'battle' | 'none';
type Channel = 'menu' | 'battle' | 'overtime';

const FADE = 1.4;
/** Cache-busting version of the music files (2: the calm tracks). */
const MUSIC_VERSION = 2;
/** Relative levels: the menu theme sits a little under the battle one. */
const LEVEL: Record<Channel, number> = { menu: 0.8, battle: 1, overtime: 1 };

export class MusicPlayer {
  private channels = new Map<Channel, { el: HTMLAudioElement; gain: GainNode }>();
  private current: Channel | null = null;
  private wanted: Track = 'none';
  private overtime = false;
  private hidden = false;
  private muted = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly base: string,
  ) {}

  private channel(name: Channel): { el: HTMLAudioElement; gain: GainNode } {
    let c = this.channels.get(name);
    if (!c) {
      const el = new Audio();
      // /assets is cached for a year: bump MUSIC_VERSION whenever a track file changes
      el.src = `${this.base}music-${name}.mp3?v=${MUSIC_VERSION}`;
      el.loop = true;
      el.preload = name === 'menu' ? 'auto' : 'metadata';
      el.muted = this.muted;
      el.setAttribute('playsinline', '');
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      try {
        this.ctx.createMediaElementSource(el).connect(gain);
        gain.connect(this.out);
      } catch {
        // no MediaElementSource: the element plays at its own volume (mute still applies)
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
          if (this.current !== name || this.muted) c.el.pause();
        })
        .catch(() => {});
    }
  }

  /** For tests: which track is audible and whether its element is actually playing. */
  info(): { track: string | null; playing: boolean; time: number; muted: boolean } {
    const c = this.current ? this.channels.get(this.current) : undefined;
    return { track: this.current, playing: !!c && !c.el.paused, time: c ? c.el.currentTime : 0, muted: this.muted };
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

  /** Muted: every element is muted and paused (nothing streams); unmuted: the wanted track resumes. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    for (const c of this.channels.values()) {
      c.el.muted = muted;
      if (muted) c.el.pause();
    }
    if (!muted) this.resumeCurrent();
  }

  /** Page hidden: pause streaming (the context is suspended anyway); resume on return. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const c = this.current ? this.channels.get(this.current) : undefined;
    if (!c) return;
    if (hidden) c.el.pause();
    else this.resumeCurrent();
  }

  private resumeCurrent(): void {
    const c = this.current ? this.channels.get(this.current) : undefined;
    if (c && !this.hidden && !this.muted) void c.el.play().catch(() => {});
  }

  private apply(): void {
    const next: Channel | null =
      this.wanted === 'none' ? null : this.wanted === 'menu' ? 'menu' : this.overtime ? 'overtime' : 'battle';
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
    // the battle and overtime themes start from the top; the menu theme carries on where it was
    if (next !== 'menu') c.el.currentTime = 0;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(LEVEL[next], now + FADE);
    this.resumeCurrent();
  }
}
