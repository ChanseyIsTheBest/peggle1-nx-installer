// Makes deko3d_glsl.bin in Node with the page's code (the title update applied to default.xex, lib/xexp.js; the
// stored containers, lib/containers.js; the chain, lib/deko3d.js) from the player's packages, compares every shader's
// GLSL with peggle1-nx's native chain (out/deko3d_release/glsl_opt: no early alpha) and prints what the build's
// "deko3d" entry of release/manifest.json needs.
// Usage: node test/p1_deko3d_node.mjs <folder with the packages> [<native glsl_opt folder>] [--out <file>] [--dump <folder>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, loadModules, root } from './node_files.mjs';
import { findGames, lzxStep, patchedImage } from '../lib/installer.js';
import { imageContainers } from '../lib/containers.js';
import { buildDeko3dPackage } from '../lib/deko3d.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const dumpAt = args.indexOf('--dump');
const dump = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const [input, reference] = args;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const started = Date.now();

const chosen = await findGames(chosenOnDisk([input]));
const modules = await loadModules();
const { image, xexHash, xexpHash } = await patchedImage(chosen, modules);
console.log(`default.xex ${xexHash}, default.xexp ${xexpHash}: patched image ${image.length} bytes`);
const unique = [];
for (const c of imageContainers(image)) {
  if (!unique.some((u) => sha(u.bytes) === sha(c.bytes))) unique.push(c);
}
console.log(`${unique.length} distinct stored containers`);
const common = fs.readFileSync(path.join(root, 'renut_shader_common.h'));
const { package: pkg, shaders } = await buildDeko3dPackage(unique, modules, common, () => {});
console.log(`${shaders.length} shaders translated in ${((Date.now() - started) / 1000).toFixed(0)} s`);

if (reference) {
  let same = 0;
  const differ = [];
  for (const s of shaders) {
    const file = path.join(reference, `${s.name.slice(0, 3)}${s.name.slice(3).toUpperCase()}.glsl`);
    if (!fs.existsSync(file)) {
      differ.push(`${s.name} (no native file)`);
    } else if (fs.readFileSync(file, 'utf8') === s.glsl) {
      same++;
    } else {
      differ.push(s.name);
    }
  }
  const native = fs.readdirSync(reference).filter((n) => n.endsWith('.glsl')).length;
  console.log(`against the native chain (${native} shaders): ${same} identical, ${differ.length} different` +
    (differ.length ? `: ${differ.join(' ')}` : ''));
}
console.log('"deko3d": ' + JSON.stringify({
  shaders: shaders.map((s) => s.name),
  containers_sha256: [...new Set(shaders.map((s) => sha(unique[s.container].bytes)))],
  package_sha256: sha(pkg),
  package_size: pkg.length,
}));
if (dump) {
  fs.mkdirSync(dump, { recursive: true });
  for (const s of shaders) fs.writeFileSync(path.join(dump, `${s.name.slice(0, 3)}${s.name.slice(3).toUpperCase()}.glsl`), s.glsl);
}
if (out) {
  fs.writeFileSync(out, pkg);
  console.log(`wrote ${out}`);
}
