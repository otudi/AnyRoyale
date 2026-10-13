// Procedurally synthesised sound effects. Every effect is rendered once into an AudioBuffer with an
// OfflineAudioContext, then replayed cheaply. All sounds are original (no third-party samples).

export type SfxName =
  | 'click'
  | 'select'
  | 'deploy'
  | 'deployHeavy'
  | 'spawnMagic'
  | 'sword'
  | 'axe'
  | 'punch'
  | 'bite'
  | 'arrow'
  | 'arrowHit'
  | 'magic'
  | 'zapShot'
  | 'fireLaunch'
  | 'explosion'
  | 'bigExplosion'
  | 'zap'
  | 'freeze'
  | 'poison'
  | 'rage'
  | 'heal'
  | 'lightning'
  | 'roll'
  | 'cannon'
  | 'towerHit'
  | 'towerDestroyed'
  | 'kingWake'
  | 'death'
  | 'skeletonDeath'
  | 'buildingDeath'
  | 'countdown'
  | 'battleStart'
  | 'victory'
  | 'defeat'
  | 'crown'
  | 'reject'
  | 'elixirFull'
  | 'flap'
  | 'inferno'
  | 'heavyStep';

type Builder = (ctx: OfflineAudioContext, out: AudioNode) => number; // returns duration (s)

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

function env(
  ctx: BaseAudioContext,
  node: AudioParam,
  t0: number,
  attack: number,
  peak: number,
  decay: number,
  end = 0.0001,
): void {
  node.setValueAtTime(0.0001, t0);
  node.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  node.exponentialRampToValueAtTime(end, t0 + attack + decay);
  void ctx;
}

function noise(
  ctx: OfflineAudioContext,
  out: AudioNode,
  t0: number,
  dur: number,
  filterType: BiquadFilterType,
  freq: number,
  q: number,
  gain: number,
  attack = 0.002,
  freqEnd?: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t0);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(ctx, g.gain, t0, attack, gain, dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone(
  ctx: OfflineAudioContext,
  out: AudioNode,
  t0: number,
  dur: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  gain: number,
  attack = 0.005,
): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = ctx.createGain();
  env(ctx, g.gain, t0, attack, gain, dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
}

function metallic(ctx: OfflineAudioContext, out: AudioNode, t0: number, base: number, gain: number, dur: number): void {
  for (const ratio of [1, 2.76, 5.4, 8.93]) {
    tone(ctx, out, t0, dur / ratio ** 0.3, 'sine', base * ratio, base * ratio * 0.995, gain / ratio ** 0.6, 0.001);
  }
}

function chord(ctx: OfflineAudioContext, out: AudioNode, t0: number, notes: number[], dur: number, type: OscillatorType, gain: number): void {
  for (const n of notes) tone(ctx, out, t0, dur, type, n, n, gain / notes.length, 0.01);
}

const N = (semi: number) => 440 * 2 ** ((semi - 9) / 12); // semitones from C4

export const SFX: Record<SfxName, Builder> = {
  click: (c, o) => {
    tone(c, o, 0, 0.06, 'triangle', 900, 600, 0.5, 0.001);
    return 0.1;
  },
  select: (c, o) => {
    tone(c, o, 0, 0.08, 'triangle', 700, 1000, 0.4, 0.002);
    return 0.12;
  },
  deploy: (c, o) => {
    noise(c, o, 0, 0.18, 'lowpass', 900, 0.7, 0.7, 0.003, 200);
    tone(c, o, 0, 0.16, 'sine', 160, 60, 0.7, 0.002);
    return 0.25;
  },
  deployHeavy: (c, o) => {
    noise(c, o, 0, 0.45, 'lowpass', 600, 0.7, 0.9, 0.003, 90);
    tone(c, o, 0, 0.4, 'sine', 90, 35, 1.0, 0.002);
    return 0.55;
  },
  spawnMagic: (c, o) => {
    for (let i = 0; i < 4; i++) tone(c, o, i * 0.05, 0.25, 'sine', N(12 + i * 4), N(12 + i * 4), 0.18, 0.005);
    return 0.5;
  },
  sword: (c, o) => {
    noise(c, o, 0, 0.08, 'highpass', 2500, 0.8, 0.45, 0.002);
    metallic(c, o, 0.01, 1300, 0.35, 0.35);
    return 0.4;
  },
  axe: (c, o) => {
    noise(c, o, 0, 0.12, 'bandpass', 1400, 1.2, 0.6, 0.002);
    metallic(c, o, 0.01, 700, 0.3, 0.3);
    tone(c, o, 0, 0.12, 'sine', 140, 70, 0.5, 0.002);
    return 0.4;
  },
  punch: (c, o) => {
    noise(c, o, 0, 0.1, 'lowpass', 1200, 0.8, 0.8, 0.002, 300);
    tone(c, o, 0, 0.1, 'sine', 180, 70, 0.7, 0.002);
    return 0.18;
  },
  bite: (c, o) => {
    noise(c, o, 0, 0.07, 'bandpass', 2200, 2, 0.6, 0.001);
    noise(c, o, 0.06, 0.07, 'bandpass', 1800, 2, 0.5, 0.001);
    return 0.16;
  },
  arrow: (c, o) => {
    noise(c, o, 0, 0.18, 'bandpass', 3000, 1.5, 0.35, 0.01, 900);
    tone(c, o, 0, 0.05, 'triangle', 500, 300, 0.3, 0.001);
    return 0.22;
  },
  arrowHit: (c, o) => {
    noise(c, o, 0, 0.05, 'bandpass', 1800, 2, 0.55, 0.001);
    tone(c, o, 0, 0.05, 'square', 220, 120, 0.12, 0.001);
    return 0.1;
  },
  magic: (c, o) => {
    tone(c, o, 0, 0.3, 'sawtooth', 300, 1200, 0.15, 0.01);
    tone(c, o, 0, 0.3, 'sine', 600, 2400, 0.2, 0.01);
    noise(c, o, 0, 0.25, 'highpass', 4000, 0.7, 0.15, 0.02);
    return 0.35;
  },
  zapShot: (c, o) => {
    for (let i = 0; i < 6; i++) tone(c, o, i * 0.025, 0.04, 'square', 1800 - i * 120, 600, 0.12, 0.001);
    noise(c, o, 0, 0.18, 'highpass', 3000, 0.7, 0.3, 0.001);
    return 0.25;
  },
  fireLaunch: (c, o) => {
    noise(c, o, 0, 0.5, 'lowpass', 400, 0.8, 0.6, 0.05, 2500);
    return 0.55;
  },
  explosion: (c, o) => {
    noise(c, o, 0, 0.7, 'lowpass', 2500, 0.7, 1.0, 0.003, 120);
    tone(c, o, 0, 0.5, 'sine', 120, 35, 0.9, 0.002);
    return 0.8;
  },
  bigExplosion: (c, o) => {
    noise(c, o, 0, 1.4, 'lowpass', 1800, 0.7, 1.0, 0.003, 60);
    tone(c, o, 0, 1.1, 'sine', 90, 25, 1.0, 0.002);
    noise(c, o, 0.05, 0.8, 'bandpass', 600, 0.6, 0.5, 0.01, 150);
    return 1.5;
  },
  zap: (c, o) => {
    for (let i = 0; i < 10; i++) noise(c, o, i * 0.03, 0.05, 'highpass', 2500 + (i % 3) * 1500, 1, 0.5, 0.001);
    tone(c, o, 0, 0.35, 'sawtooth', 80, 60, 0.25, 0.002);
    return 0.45;
  },
  freeze: (c, o) => {
    for (let i = 0; i < 8; i++) tone(c, o, i * 0.04, 0.5, 'sine', N(24 + ((i * 5) % 12)), N(24 + ((i * 5) % 12)), 0.12, 0.003);
    noise(c, o, 0, 0.8, 'highpass', 5000, 0.5, 0.25, 0.05);
    return 1.0;
  },
  poison: (c, o) => {
    for (let i = 0; i < 9; i++) tone(c, o, i * 0.09, 0.08, 'sine', 300 + ((i * 137) % 400), 700 + ((i * 89) % 500), 0.15, 0.005);
    return 0.9;
  },
  rage: (c, o) => {
    tone(c, o, 0, 0.6, 'sawtooth', 110, 220, 0.25, 0.02);
    tone(c, o, 0, 0.6, 'sawtooth', 165, 330, 0.2, 0.02);
    noise(c, o, 0, 0.5, 'bandpass', 800, 1, 0.3, 0.05, 2000);
    return 0.7;
  },
  heal: (c, o) => {
    chord(c, o, 0, [N(12), N(16), N(19)], 0.6, 'sine', 0.45);
    chord(c, o, 0.15, [N(24), N(28)], 0.5, 'sine', 0.25);
    return 0.8;
  },
  lightning: (c, o) => {
    noise(c, o, 0, 0.15, 'highpass', 1500, 0.7, 1.0, 0.001);
    noise(c, o, 0.05, 1.1, 'lowpass', 900, 0.7, 0.9, 0.01, 80);
    tone(c, o, 0.05, 0.9, 'sine', 70, 30, 0.8, 0.005);
    return 1.3;
  },
  roll: (c, o) => {
    for (let i = 0; i < 10; i++) noise(c, o, i * 0.07, 0.09, 'lowpass', 500, 1, 0.5, 0.005);
    tone(c, o, 0, 0.8, 'sine', 70, 55, 0.4, 0.05);
    return 0.9;
  },
  cannon: (c, o) => {
    noise(c, o, 0, 0.35, 'lowpass', 1500, 0.7, 0.9, 0.002, 150);
    tone(c, o, 0, 0.25, 'sine', 140, 45, 0.9, 0.002);
    return 0.45;
  },
  towerHit: (c, o) => {
    noise(c, o, 0, 0.12, 'bandpass', 900, 1, 0.5, 0.002);
    tone(c, o, 0, 0.12, 'sine', 220, 120, 0.3, 0.002);
    return 0.18;
  },
  towerDestroyed: (c, o) => {
    noise(c, o, 0, 1.8, 'lowpass', 1200, 0.6, 1.0, 0.005, 50);
    for (let i = 0; i < 6; i++) noise(c, o, 0.2 + i * 0.18, 0.2, 'bandpass', 400 + i * 90, 1.5, 0.4, 0.005);
    tone(c, o, 0, 1.2, 'sine', 80, 28, 1.0, 0.003);
    return 2.0;
  },
  kingWake: (c, o) => {
    chord(c, o, 0, [N(-12), N(-5), N(0)], 0.5, 'sawtooth', 0.35);
    chord(c, o, 0.25, [N(-10), N(-3), N(2)], 0.6, 'sawtooth', 0.35);
    return 0.9;
  },
  death: (c, o) => {
    tone(c, o, 0, 0.35, 'triangle', 420, 120, 0.35, 0.005);
    noise(c, o, 0, 0.2, 'bandpass', 900, 1, 0.3, 0.005);
    return 0.4;
  },
  skeletonDeath: (c, o) => {
    for (let i = 0; i < 5; i++) noise(c, o, i * 0.035, 0.04, 'bandpass', 2500 - i * 200, 4, 0.5, 0.001);
    return 0.25;
  },
  buildingDeath: (c, o) => {
    noise(c, o, 0, 0.9, 'lowpass', 900, 0.7, 0.9, 0.005, 80);
    tone(c, o, 0, 0.7, 'sine', 100, 35, 0.7, 0.003);
    return 1.0;
  },
  countdown: (c, o) => {
    tone(c, o, 0, 0.15, 'square', 880, 880, 0.2, 0.002);
    return 0.2;
  },
  battleStart: (c, o) => {
    chord(c, o, 0, [N(0), N(4), N(7)], 0.25, 'sawtooth', 0.4);
    chord(c, o, 0.22, [N(5), N(9), N(12)], 0.25, 'sawtooth', 0.4);
    chord(c, o, 0.44, [N(7), N(11), N(14), N(19)], 0.7, 'sawtooth', 0.5);
    return 1.3;
  },
  victory: (c, o) => {
    const seq = [0, 4, 7, 12, 7, 12, 16];
    seq.forEach((s, i) => tone(c, o, i * 0.13, 0.25, 'triangle', N(s + 12), N(s + 12), 0.4, 0.005));
    chord(c, o, 0.95, [N(12), N(16), N(19), N(24)], 1.2, 'sawtooth', 0.45);
    return 2.3;
  },
  defeat: (c, o) => {
    const seq = [7, 5, 3, 0];
    seq.forEach((s, i) => tone(c, o, i * 0.25, 0.4, 'triangle', N(s), N(s), 0.4, 0.01));
    chord(c, o, 1.0, [N(-12), N(-9), N(-5)], 1.2, 'sawtooth', 0.35);
    return 2.3;
  },
  crown: (c, o) => {
    chord(c, o, 0, [N(19), N(24)], 0.4, 'triangle', 0.5);
    chord(c, o, 0.12, [N(23), N(28)], 0.5, 'triangle', 0.45);
    return 0.7;
  },
  reject: (c, o) => {
    tone(c, o, 0, 0.12, 'square', 200, 150, 0.25, 0.002);
    tone(c, o, 0.13, 0.15, 'square', 150, 110, 0.25, 0.002);
    return 0.32;
  },
  elixirFull: (c, o) => {
    tone(c, o, 0, 0.15, 'sine', N(24), N(31), 0.25, 0.005);
    return 0.2;
  },
  flap: (c, o) => {
    noise(c, o, 0, 0.09, 'lowpass', 700, 1, 0.35, 0.01);
    return 0.12;
  },
  inferno: (c, o) => {
    noise(c, o, 0, 0.5, 'bandpass', 1200, 1, 0.4, 0.05, 2400);
    tone(c, o, 0, 0.5, 'sawtooth', 200, 400, 0.12, 0.05);
    return 0.55;
  },
  heavyStep: (c, o) => {
    tone(c, o, 0, 0.18, 'sine', 70, 40, 0.6, 0.003);
    noise(c, o, 0, 0.12, 'lowpass', 300, 1, 0.4, 0.003);
    return 0.22;
  },
};

export async function renderSfx(name: SfxName, sampleRate: number): Promise<AudioBuffer> {
  // First pass measures duration with a generous buffer; builders return their own length.
  const maxSeconds = 2.6;
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * maxSeconds), sampleRate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  SFX[name](ctx, comp);
  return ctx.startRendering();
}
