// Procedural music: a lookahead step sequencer playing original compositions with synthesised
// instruments. "menu" is calm, "battle" drives harder, and battle switches to a faster, brighter
// variation when overtime / double elixir starts.

export type Track = 'menu' | 'battle' | 'none';

interface Song {
  bpm: number;
  bars: string[]; // chord root per bar as semitone offset from key
  key: number; // semitones from A3
  melody: (number | null)[]; // 16th-note grid over the loop, semitone offsets (null = rest)
  drums: string; // per 16th: k=kick s=snare h=hat .=rest
  bassPattern: number[]; // 16th-step positions where bass plays
  padLevel: number;
}

const MENU: Song = {
  bpm: 92,
  key: 2,
  bars: ['0', '-4', '5', '3'],
  melody: [
    12, null, null, 15, null, 17, null, null, 19, null, 17, null, 15, null, null, null,
    12, null, null, 10, null, 8, null, null, 7, null, null, null, null, null, null, null,
    17, null, null, 19, null, 20, null, null, 22, null, 20, null, 19, null, 17, null,
    15, null, null, 14, null, 12, null, null, 10, null, null, null, null, null, null, null,
  ],
  drums: 'k.......s.......k.....k.s.......',
  bassPattern: [0, 6, 10],
  padLevel: 0.12,
};

const BATTLE: Song = {
  bpm: 128,
  key: 0,
  bars: ['0', '0', '-2', '-4', '0', '0', '3', '-2'],
  melody: [
    12, null, 15, null, 17, null, 15, 12, null, null, 10, null, 12, null, null, null,
    12, null, 15, null, 19, null, 17, 15, null, null, 17, null, 15, null, 12, null,
    10, null, 14, null, 17, null, 14, 10, null, null, 8, null, 10, null, null, null,
    8, null, 12, null, 15, null, 12, 8, null, null, 7, null, 8, null, 10, null,
  ],
  drums: 'k.h.s.h.k.k.s.h.k.h.s.h.k.hks.hh',
  bassPattern: [0, 3, 6, 8, 11, 14],
  padLevel: 0.07,
};

const freq = (semiFromA3: number) => 220 * 2 ** (semiFromA3 / 12);

export class MusicPlayer {
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private song: Song | null = null;
  private intensity = 1;
  private noise: AudioBuffer | null = null;
  track: Track = 'none';

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  play(track: Track): void {
    if (track === this.track) return;
    this.track = track;
    window.clearInterval(this.timer);
    if (track === 'none') {
      this.song = null;
      return;
    }
    this.song = track === 'menu' ? MENU : BATTLE;
    this.intensity = 1;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** 1 = normal; 1.12 = faster/brighter for double elixir and overtime. */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  stop(): void {
    this.play('none');
  }

  private schedule(): void {
    const song = this.song;
    if (!song) return;
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.1;
      return;
    }
    const stepDur = 60 / (song.bpm * this.intensity) / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(song, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(song: Song, step: number, t: number, stepDur: number): void {
    const stepsPerBar = 16;
    const bar = Math.floor(step / stepsPerBar) % song.bars.length;
    const inBar = step % stepsPerBar;
    const root = song.key + Number(song.bars[bar]);

    if (inBar === 0) {
      this.pad(t, [root, root + 3 + (bar % 2 === 0 ? 0 : 1), root + 7], stepDur * 16, song.padLevel);
    }
    if (song.bassPattern.includes(inBar)) {
      this.bass(t, root - 12, stepDur * 1.8);
    }
    const mel = song.melody[step % song.melody.length];
    if (mel !== null && mel !== undefined) {
      this.pluck(t, song.key + mel, stepDur * 2.5, this.intensity > 1 ? 0.13 : 0.1);
    }
    const d = song.drums[step % song.drums.length];
    if (d === 'k') this.kick(t);
    if (d === 's') this.snare(t);
    if (d === 'h' || (this.intensity > 1 && inBar % 2 === 1)) this.hat(t);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pluck(t: number, semi: number, dur: number, level: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq(semi + 12);
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq(semi + 12) * 1.003;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, level, dur);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private bass(t: number, semi: number, dur: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq(semi);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, 0.16, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(t: number, semis: number[], dur: number, level: number): void {
    for (const s of semis) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq(s);
      o.detune.value = (Math.random() - 0.5) * 12;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level / semis.length, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private noiseBuf(): AudioBuffer {
    if (!this.noise) {
      const len = this.ctx.sampleRate * 0.3;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.5, 0.2);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.22, 0.15);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + 0.25);
  }

  private hat(t: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, 0.06, 0.04);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + 0.08);
  }
}
