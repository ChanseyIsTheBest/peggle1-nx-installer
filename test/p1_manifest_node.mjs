// Writes the build's entry of release/manifest.json from the tested files: the player's packages (the game, Title
// Update #3, Peggle Nights), the NRO in release/ and the shaders the page makes (lib/deko3d.js, all of the stored
// containers of the patched executable).
// Usage: node test/p1_manifest_node.mjs <folder with the packages> <version> [--write]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, loadModules, root } from './node_files.mjs';
import { findGames, patchedImage } from '../lib/installer.js';
import { imageContainers } from '../lib/containers.js';
import { buildDeko3dPackage } from '../lib/deko3d.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const [input, version] = args.filter((a) => a !== '--write');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const whole = async (f) => sha(await f.read(0, f.size));

const chosen = await findGames(chosenOnDisk([input]));
if (!chosen.game || !chosen.update) {
  throw new Error('the game and its title update are both needed');
}
const modules = await loadModules();
const { image, xexHash, xexpHash } = await patchedImage(chosen, modules);
const unique = [];
for (const c of imageContainers(image)) {
  if (!unique.some((u) => sha(u.bytes) === sha(c.bytes))) unique.push(c);
}
const common = fs.readFileSync(path.join(root, 'renut_shader_common.h'));
const { package: pkg, shaders } = await buildDeko3dPackage(unique, modules, common);
const nights = chosen.update.files.find((f) => f.path === 'nightstu.pak');
const nro = fs.readFileSync(path.join(root, 'release', 'peggle1.nro'));
const build = {
  edition: 'Xbox Live Arcade (title 58410889) with Title Update #3',
  version,
  xex_sha256: xexHash,
  xexp_sha256: xexpHash,
  nightstu: { size: nights.size, sha256: await whole(nights) },
  game_files: chosen.game.files.map((f) => ({ path: f.path, size: f.size })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  dlc: await Promise.all(chosen.dlc.map(async (d) => ({ name: d.name, title: d.displayName, size: d.file.size,
    sha256: await whole(d.file) }))),
  nro: 'peggle1.nro',
  nro_sha256: sha(nro),
  nro_size: nro.length,
  deko3d: {
    shaders: shaders.map((s) => s.name),
    containers_sha256: shaders.map((s) => sha(unique[s.container].bytes)),
    package_sha256: sha(pkg),
    package_size: pkg.length,
  },
};
const manifest = { version: 1, builds: [build] };
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) {
  fs.writeFileSync(path.join(root, 'release', 'manifest.json'), text);
  console.log(`wrote release/manifest.json (${build.game_files.length} game files, ${build.dlc.length} DLC, ` +
    `${shaders.length} shaders, NRO ${build.nro_sha256})`);
} else {
  process.stdout.write(text);
}
