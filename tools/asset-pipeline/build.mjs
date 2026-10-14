#!/usr/bin/env node
/**
 * AnyRoyale asset pipeline.
 *
 *   cd tools/asset-pipeline && npm ci && npm run build
 *
 * 1. Fetches each CC0 pack listed in sources.json at its pinned commit (shallow fetch by SHA) into
 *    .cache/ (git-ignored).
 * 2. Builds the outputs listed in manifest.json with glTF-Transform:
 *    - characters: animations stripped (they come from the shared library), unused data pruned;
 *    - animation library: only the clips the client plays, meshes removed, keyframes resampled;
 *    - prop bundles: many small models merged into one file with one named node per item, sharing
 *      the pack texture atlas.
 *    Every output is quantized and meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization,
 *    decoded by three.js' MeshoptDecoder).
 * 3. Writes apps/web/public/assets/models/index.json: file sizes, SHA-256 and source attribution.
 *
 * The generated GLBs are committed (CC0, small), so building the game never needs network access.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, mergeDocuments, prune, quantize, resample, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const cacheDir = path.join(here, '.cache');
const outDir = path.join(repoRoot, 'apps', 'web', 'public', 'assets', 'models');
const sources = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8')).packs;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function fetchPack(name) {
  const pack = sources[name];
  const dir = path.join(cacheDir, name);
  const marker = path.join(dir, '.anyroyale-commit');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === pack.commit) {
    return dir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
  git('init', '-q');
  git('remote', 'add', 'origin', pack.repo);
  git('fetch', '-q', '--depth', '1', 'origin', pack.commit);
  git('checkout', '-q', 'FETCH_HEAD');
  fs.writeFileSync(marker, pack.commit);
  return dir;
}

function sourcePath(packName, rel) {
  const dir = fetchPack(packName);
  const full = path.join(dir, sources[packName].root, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing source file ${packName}:${rel}`);
  }
  return full;
}

/** Fully removes an animation: channels, samplers and their keyframe accessors. */
function dropAnimation(anim) {
  for (const ch of anim.listChannels()) ch.dispose();
  for (const smp of anim.listSamplers()) {
    const input = smp.getInput();
    const output = smp.getOutput();
    smp.dispose();
    if (input && input.listParents().length <= 1) input.dispose();
    if (output && output.listParents().length <= 1) output.dispose();
  }
  anim.dispose();
}

async function finish(doc) {
  await doc.transform(
    dedup(),
    prune({ keepLeaves: false }),
    resample(),
    unpartition(),
    quantize({ quantizeNormal: 10, quantizeTexcoord: 12, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return doc;
}

const index = { generated: new Date().toISOString().slice(0, 10), license: 'CC0-1.0', files: {} };

async function write(doc, out, origin) {
  const target = path.join(outDir, out);
  await io.write(target, doc);
  const bytes = fs.readFileSync(target);
  index.files[out] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    origin,
  };
  console.log(`${out.padEnd(26)} ${(bytes.length / 1024).toFixed(1).padStart(8)} KiB`);
}

function origin(packName, rel) {
  const p = sources[packName];
  return { pack: p.title, repo: p.repo, commit: p.commit, path: rel, license: p.license };
}

fs.mkdirSync(outDir, { recursive: true });

// Animation library: keep listed clips only, drop meshes/materials (bones remain as nodes).
{
  const lib = manifest.animationLibrary;
  const doc = await io.read(sourcePath(lib.pack, lib.path));
  const keep = new Set(lib.keep);
  const root = doc.getRoot();
  const missing = lib.keep.filter((n) => !root.listAnimations().some((a) => a.getName() === n));
  if (missing.length) throw new Error('Animation clips not found: ' + missing.join(', '));
  for (const anim of root.listAnimations()) {
    if (!keep.has(anim.getName())) dropAnimation(anim);
  }
  // IK targets and control bones are Blender rig helpers; their effect is already baked into the
  // deforming bones' keyframes, so their channels only add weight.
  const helper = /IK|control-/;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      if (target && helper.test(target.getName())) {
        const smp = ch.getSampler();
        ch.dispose();
        if (smp && smp.listParents().filter((p) => p.propertyType === 'AnimationChannel').length === 0) {
          const input = smp.getInput();
          const output = smp.getOutput();
          smp.dispose();
          if (input && input.listParents().length <= 1) input.dispose();
          if (output && output.listParents().length <= 1) output.dispose();
        }
      }
    }
  }
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  await finish(doc);
  await write(doc, lib.out, origin(lib.pack, lib.path));
}

// Characters: geometry + skin + texture, no animations.
for (const ch of manifest.characters) {
  const doc = await io.read(sourcePath(ch.pack, ch.path));
  for (const anim of doc.getRoot().listAnimations()) dropAnimation(anim);
  await finish(doc);
  await write(doc, ch.out, origin(ch.pack, ch.path));
}

// Forged characters (tools/character-forge): per-unit models assembled in Blender from the same CC0
// KayKit parts, recoloured, with procedural accessories. Already one skinned mesh + atlas.
{
  const forgeDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'character-forge', 'out');
  const files = fs.existsSync(forgeDir) ? fs.readdirSync(forgeDir).filter((f) => /^forged_.*\.glb$/.test(f)).sort() : [];
  for (const f of files) {
    const doc = await io.read(path.join(forgeDir, f));
    for (const anim of doc.getRoot().listAnimations()) dropAnimation(anim);
    await finish(doc);
    await write(doc, f, {
      pack: 'AnyRoyale character forge (derived from KayKit Adventurers/Skeletons, CC0 1.0)',
      recipe: `tools/character-forge/recipes.json#${f.replace(/^forged_|\.glb$/g, '')}`,
      license: 'CC0-1.0',
    });
  }
}

// Bundles: one node per item, named by key.
for (const bundle of manifest.bundles) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('bundle');
  doc.getRoot().setDefaultScene(scene);
  const origins = [];
  for (const item of bundle.items) {
    const src = await io.read(sourcePath(item.pack, item.path));
    for (const anim of src.getRoot().listAnimations()) dropAnimation(anim);
    const before = new Set(doc.getRoot().listScenes());
    mergeDocuments(doc, src);
    const added = doc.getRoot().listScenes().filter((s) => !before.has(s));
    const group = doc.createNode(item.key);
    for (const s of added) {
      for (const child of s.listChildren()) {
        s.removeChild(child);
        group.addChild(child);
      }
      s.dispose();
    }
    scene.addChild(group);
    origins.push({ key: item.key, ...origin(item.pack, item.path) });
  }
  // Merged documents bring their own buffers; collapse to one.
  const buffers = doc.getRoot().listBuffers();
  for (const b of buffers.slice(1)) {
    for (const acc of doc.getRoot().listAccessors()) {
      if (acc.getBuffer() === b) acc.setBuffer(buffers[0]);
    }
    b.dispose();
  }
  await finish(doc);
  await write(doc, bundle.out, origins);
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
fs.writeFileSync(
  path.join(outDir, 'LICENSE.txt'),
  [
    'The 3D models in this directory are derived from KayKit asset packs by Kay Lousberg',
    '(www.kaylousberg.com), released under Creative Commons Zero (CC0 1.0):',
    'http://creativecommons.org/publicdomain/zero/1.0/',
    '',
    'They were converted (animations split, data pruned, quantized, meshopt-compressed) by',
    'tools/asset-pipeline/build.mjs. Source repositories and pinned commits: see index.json.',
    'They are not Clash Royale assets and are not affiliated with Supercell.',
    '',
  ].join('\n'),
);
const total = Object.values(index.files).reduce((a, f) => a + f.bytes, 0);
console.log(`Total ${(total / 1024).toFixed(1)} KiB in ${Object.keys(index.files).length} files`);
