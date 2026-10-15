/**
 * Background music: a calm lofi playlist (public/assets/music/lofi-N.mp3, CC0, see docs/ASSETS.md)
 * that sounds like ordinary background music, not game music. It plays track after track like a
 * radio, from a random starting track, and carries on unchanged between the menus and battles
 * (only a little quieter in the menus).
 *
 * One <audio> element streams the current track; it is routed through Web Audio so the music
 * volume and fades work everywhere (iOS ignores element.volume). Mute does not rely on the graph
 * alone: on iOS a media element can end up playing outside it, so muting also mutes and pauses
 * the element itself.
 */
export type Track = 'menu' | 'battle' | 'none';

/** Cache-busting version of the music files (/assets is cached for a year). */
const MUSIC_VERSION = 3;
const PLAYLIST = ['lofi-1.mp3', 'lofi-2.mp3', 'lofi-3.mp3', 'lofi-4.mp3', 'lofi-5.mp3'];
const FADE = 1.5;
const LEVEL: Record<Track, number> = { menu: 0.85, battle: 1, none: 0 };

export class MusicPlayer {
  private el: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private index = Math.floor(Math.random() * PLAYLIST.length);
  private wanted: Track = 'none';
  private hidden = false;
  private muted = false;
  private pauseTimer = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly base: string,
  ) {}

  private element(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio();
      el.preload = 'auto';
      el.muted = this.muted;
      el.setAttribute('playsinline', '');
      el.src = this.url(this.index);
      // next track when one ends (the same element keeps its iOS playback permission)
      el.addEventListener('ended', () => {
        this.index = (this.index + 1) % PLAYLIST.length;
        el.src = this.url(this.index);
        this.resume();
      });
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      try {
        this.ctx.createMediaElementSource(el).connect(gain);
        gain.connect(this.out);
      } catch {
        // no MediaElementSource: the element plays at its own volume (mute still applies)
      }
      this.el = el;
      this.gain = gain;
    }
    return this.el;
  }

  private url(i: number): string {
    return `${this.base}${PLAYLIST[i]}?v=${MUSIC_VERSION}`;
  }

  /** Call inside a user gesture: a first play() lets mobile Safari play the element later. */
  bless(): void {
    const el = this.element();
    el.play()
      .then(() => {
        if (this.wanted === 'none' || this.muted || this.hidden) el.pause();
      })
      .catch(() => {});
  }

  /** For tests: the mood, whether the element is actually playing, and the current track. */
  info(): { track: string | null; playing: boolean; time: number; muted: boolean; song: string } {
    return {
      track: this.wanted === 'none' ? null : this.wanted,
      playing: !!this.el && !this.el.paused,
      time: this.el?.currentTime ?? 0,
      muted: this.muted,
      song: PLAYLIST[this.index],
    };
  }

  play(track: Track): void {
    if (track === this.wanted) return;
    this.wanted = track;
    const el = this.element();
    const now = this.ctx.currentTime;
    const g = this.gain!.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(LEVEL[track], now + FADE);
    window.clearTimeout(this.pauseTimer);
    if (track === 'none') {
      this.pauseTimer = window.setTimeout(() => el.pause(), FADE * 1000 + 100);
      return;
    }
    this.resume();
  }

  /** The playlist keeps the same calm mood in overtime: nothing to change. */
  setIntensity(_v: number): void {}

  /** Muted: the element is muted and paused (nothing streams); unmuted: the music resumes. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (this.el) {
      this.el.muted = muted;
      if (muted) this.el.pause();
    }
    if (!muted) this.resume();
  }

  /** Page hidden: pause streaming (the context is suspended anyway); resume on return. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.el?.pause();
    else this.resume();
  }

  private resume(): void {
    if (this.el && this.wanted !== 'none' && !this.hidden && !this.muted) void this.el.play().catch(() => {});
  }
}
