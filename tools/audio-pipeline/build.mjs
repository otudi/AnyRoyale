// Builds apps/web/public/assets/sfx from CC0 sound packs (see sources.json / sounds.json).
// Needs curl, unzip and ffmpeg (with libmp3lame) on PATH. Usage: node build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const out = join(here, '../../apps/web/public/assets/sfx');
const { packs } = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const { sounds, music } = JSON.parse(readFileSync(join(here, 'sounds.json'), 'utf8'));

mkdirSync(cache, { recursive: true });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fetchPack(id) {
  const p = packs[id];
  const zip = join(cache, `${id}.${p.single ? 'mp3' : 'zip'}`);
  const dir = join(cache, id);
  if (!existsSync(zip)) execFileSync('curl', ['-sSfL', '-m', '300', '-o', zip, p.url]);
  const hash = sha256(readFileSync(zip));
  if (p.sha256 && p.sha256 !== hash) throw new Error(`${id}: sha256 ${hash} != pinned ${p.sha256}`);
  if (p.single) return zip;
  if (!existsSync(dir)) execFileSync('unzip', ['-qo', zip, '-d', dir]);
  return dir;
}

const fileIndex = new Map();
function locate(ref) {
  const [pack, name] = ref.split(':');
  if (!fileIndex.has(pack)) {
    const m = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else m.set(e, f);
      }
    };
    walk(fetchPack(pack));
    fileIndex.set(pack, m);
  }
  const f = fileIndex.get(pack).get(name);
  if (!f) throw new Error(`missing ${ref}`);
  return f;
}

function peak(file) {
  const r = execFileSync('sh', ['-c', 'ffmpeg -hide_banner -i "$1" -af volumedetect -f null - 2>&1 | grep max_volume', 'sh', file], { encoding: 'utf8' });
  return parseFloat(r.split('max_volume:')[1]);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const index = {};
const used = new Set();
for (const [name, variants] of Object.entries(sounds)) {
  index[name] = [];
  variants.forEach((layers, vi) => {
    const file = `${name}${vi ? `-${vi + 1}` : ''}.mp3`;
    const args = ['-hide_banner', '-v', 'error', '-y'];
    const chains = [];
    layers.forEach((l, i) => {
      const src = locate(l.f);
      used.add(l.f.split(':')[0]);
      args.push('-i', src);
      const gain = -1 - peak(src) + (l.gain ?? 0);
      const f = [`aformat=channel_layouts=mono:sample_rates=44100`];
      if (i === 0) f.push('silenceremove=start_periods=1:start_threshold=-45dB');
      if (l.max) f.push(`atrim=0:${l.max}`, `afade=t=out:st=${Math.max(0, l.max - 0.08)}:d=0.08`);
      f.push(`volume=${gain.toFixed(2)}dB`);
      if (l.at) f.push(`adelay=${Math.round(l.at * 1000)}`);
      chains.push(`[${i}:a]${f.join(',')}[l${i}]`);
    });
    const mix = layers.map((_, i) => `[l${i}]`).join('') + `amix=inputs=${layers.length}:normalize=0:duration=longest,alimiter=limit=0.95,silenceremove=stop_periods=-1:stop_threshold=-60dB:stop_duration=0.05[o]`;
    args.push('-filter_complex', [...chains, mix].join(';'), '-map', '[o]', '-c:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', '-ar', '44100', join(out, file));
    execFileSync('ffmpeg', args);
    index[name].push(file);
  });
}
// Music: the background playlist (calm lofi). Whole tracks, silence-trimmed, loudness-normalised
// well under the effects, with soft fades in and out, numbered in playlist order.
const musicOut = join(here, '../../apps/web/public/assets/music');
mkdirSync(musicOut, { recursive: true });
const musicIndex = [];
(music ?? []).forEach((id, i) => {
  const src = fetchPack(id);
  used.add(id);
  const file = `lofi-${i + 1}.mp3`;
  const staged = join(cache, `music-stage-${i + 1}.mp3`);
  const trim = 'silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse';
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', src, '-af', `${trim},loudnorm=I=-22:TP=-2:LRA=9,afade=t=in:d=1.5`, '-ar', '44100', '-ac', '2', '-b:a', '72k', staged]);
  const secs = Number(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', staged]).toString());
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', staged, '-af', `afade=t=out:st=${Math.max(0, secs - 2.5)}:d=2.5`, '-b:a', '72k', join(musicOut, file)]);
  musicIndex.push(file);
});
const sources = {};
for (const id of [...used].sort()) {
  sources[id] = { page: packs[id].page, license: packs[id].license, sha256: sha256(readFileSync(join(cache, `${id}.${packs[id].single ? 'mp3' : 'zip'}`))) };
}
writeFileSync(join(out, 'index.json'), JSON.stringify({ sounds: index, music: musicIndex, sources }, null, 1) + '\n');
let total = 0;
for (const f of readdirSync(out)) total += statSync(join(out, f)).size;
console.log(`${Object.keys(index).length} sounds, ${readdirSync(out).length - 1} files, ${(total / 1024).toFixed(0)} KB`);
