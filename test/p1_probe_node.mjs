// Peggle 1 probe: finds the game, title update and DLC packages among the given files, lists what they hold, reads
// default.xex's image and compares its stored shader containers with a folder of the port's dumped containers.
// Usage: node test/p1_probe_node.mjs <folder with the packages> [<peggle1-nx out/renut_shader_dump>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { diskFile, loadModules } from './node_files.mjs';
import { StfsPackage, readStfsHeader } from '../lib/from_sa2/stfs_package.js';
import { readXexImage } from '../lib/xex.js';
import { imageContainers } from '../lib/containers.js';
import { applyXexPatch, lzxDeltaStep } from '../lib/xexp.js';
import createLzxDeltaModule from '../wasm/lzxdelta.mjs';

const [folder, dumps] = process.argv.slice(2);
const lzxStep = (lzx) => async (compressed, bits, size) => {
  lzx.FS.writeFile('/image.lzx', compressed);
  if (lzx.callMain(['/image.lzx', '/image.bin', String(bits), String(size)])) throw new Error('LZX failed');
  return lzx.FS.readFile('/image.bin');
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

let game = null;
let update = null;
for (const full of walk(folder)) {
  const file = diskFile(full);
  if (file.size < 0xa000) continue;
  const header = readStfsHeader(await file.read(0, 0x600));
  if (!header) continue;
  console.log(`${path.relative(folder, full)}: ${header.magic} title ${header.titleId.toString(16)} content ` +
    `${header.contentType.toString(16).padStart(8, '0')} "${header.displayName}" ${file.size} bytes`);
  const pkg = await StfsPackage.open(file);
  const files = pkg.files();
  for (const f of files) console.log(`    ${f.path} ${f.size}`);
  if (header.contentType === 0x000d0000) game = files;
  if (header.contentType === 0x000b0000) update = files;
}
const xexFile = game.find((f) => f.path.toLowerCase() === 'default.xex');
const xex = await xexFile.read(0, xexFile.size);
const modules = await loadModules();
const { image } = await readXexImage(xex, lzxStep(modules.lzx));
console.log(`default.xex SHA-256 ${sha(xex)}; image ${image.length} bytes`);
const xexpFile = update.find((f) => f.path.toLowerCase() === 'default.xexp');
const xexp = await xexpFile.read(0, xexpFile.size);
const delta = await createLzxDeltaModule({ print: () => {}, printErr: () => {} });
const patched = await applyXexPatch(xex, image, xexp, lzxDeltaStep(delta));
console.log(`patched image ${patched.image.length} bytes, SHA-256 ${sha(patched.image)}`);
const reference = process.argv[4];
if (reference) {
  const ref = fs.readFileSync(reference);
  let first = -1;
  for (let i = 0; i < Math.min(ref.length, patched.image.length); i++) if (ref[i] !== patched.image[i]) { first = i; break; }
  console.log(`against ${reference} (${ref.length} bytes, SHA-256 ${sha(ref)}): ` +
    (first < 0 && ref.length === patched.image.length ? 'identical' : `first difference at ${first}`));
}
const containers = imageContainers(patched.image);
const distinct = new Set(containers.map((c) => sha(c.bytes)));
console.log(`${containers.length} stored containers (${distinct.size} distinct)`);
if (dumps) {
  const dumped = fs.readdirSync(dumps).filter((n) => n.endsWith('.bin')).map((n) => sha(fs.readFileSync(path.join(dumps, n))));
  const missing = dumped.filter((h) => !distinct.has(h));
  console.log(`the port's ${dumped.length} containers: ${dumped.length - missing.length} in the patched image, ${missing.length} not`);
}
if (reference) {
  const ref = fs.readFileSync(reference);
  const runs = [];
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] !== patched.image[i]) {
      const last = runs[runs.length - 1];
      if (last && i - last[1] <= 16) last[1] = i; else runs.push([i, i]);
    }
  }
  const total = runs.reduce((n, [a, b]) => n + b - a + 1, 0);
  console.log(`${runs.length} differing ranges, ${total} bytes: ` +
    runs.slice(0, 8).map(([a, b]) => `${(0x82000000 + a).toString(16)}-${(0x82000000 + b).toString(16)}`).join(' '));
}
