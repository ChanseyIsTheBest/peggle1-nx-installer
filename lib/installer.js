// Builds the peggle1-nx.zip package from the player's own copy of Peggle (Xbox Live Arcade, title 58410889): the
// game (its content package, read in place, or a folder it was extracted into), Title Update #3 (its package, or its
// default.xexp and nightstu.pak) and, when the player has it, the Peggle Nights DLC package.
//
// The zip holds the Switch build (peggle1.nro) and its licenses, the shaders of its renderer made from the game's
// executable (deko3d_glsl.bin), the game's files with the title update's as the asset pack the console mounts
// (game_root.nxpack + .nxidx), and the DLC package, which the game installs at its first start (dlc/). The settings
// file, peggle1.toml, is written by the game at its first start, so an update never replaces the player's settings.

import { readXexImage } from './xex.js';
import { applyXexPatch, lzxDeltaStep } from './xexp.js';
import { StfsPackage, readStfsHeader } from './from_sa2/stfs_package.js';
import { imageContainers } from './containers.js';
import { buildDeko3dPackage } from './deko3d.js';
import { Fnv64, packChunks, packIndex, planPack } from './nxpack.js';
import { ZipWriter, zipSize } from './zip.js';
import { t } from './i18n.js';

const CHUNK = 16 * 1024 * 1024;
const ROOT = 'peggle1-nx';
const TITLE_ID = 0x58410889;
const CONTENT_GAME = 0x000d0000;
const CONTENT_UPDATE = 0x000b0000;
const CONTENT_DLC = 0x00000002;
// files whose header is read to find the packages among the chosen files
const MAX_CANDIDATES = 256;
// the title update's files (an extracted update: these two, beside each other)
const UPDATE_FILES = ['default.xexp', 'nightstu.pak'];

export async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Of(file) {
  // whole-file hashes are of packages up to a few tens of MB: one read
  return sha256(await file.read(0, file.size));
}

async function* chunksOf(file) {
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    yield await file.read(offset, Math.min(CHUNK, file.size - offset));
  }
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function folderOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

// The LZX step of readXexImage, done by libmspack compiled to WebAssembly.
export function lzxStep(lzx) {
  return async (compressed, bits, size) => {
    lzx.FS.writeFile('/image.lzx', compressed);
    const rc = lzx.callMain(['/image.lzx', '/image.bin', String(bits), String(size)]);
    if (rc) {
      throw new Error(`LZX decompression failed (${rc})`);
    }
    const out = lzx.FS.readFile('/image.bin');
    lzx.FS.unlink('/image.lzx');
    lzx.FS.unlink('/image.bin');
    return out;
  };
}

// Where a release file is downloaded from. Its SHA-256 is part of the address, so every version is a different
// address and a copy kept by the browser is never mistaken for a newer one.
export function releasePath(name, hash) {
  return `./release/${name}?sha256=${hash}`;
}

export function programPath(build) {
  return releasePath(build.nro, build.nro_sha256);
}

// Sorts out what the player chose (files [{ path, size, read }] from the "Files" button or every file under the
// "Folder"). Returns { game, update, dlc, others }:
//   game = { kind: 'package' | 'folder', name, files } (the game's files, paths relative to the game) or null;
//   update = { kind: 'package' | 'folder', name, files } (default.xexp and nightstu.pak) or null;
//   dlc = [{ name, displayName, file }] (Peggle's DLC packages, copied as they are);
//   others = names of packages of other games.
export async function findGames(chosen) {
  let game = null;
  let update = null;
  const dlc = [];
  const others = [];
  // An extracted game: the shallowest default.xex with peggle.pak beside it. An extracted title update: a default.xexp
  // with nightstu.pak beside it (it may be in the game's folder).
  const byFolder = new Map();
  for (const f of chosen) {
    const folder = folderOf(f.path);
    if (!byFolder.has(folder)) {
      byFolder.set(folder, []);
    }
    byFolder.get(folder).push(f);
  }
  const folders = [...byFolder.keys()].sort((a, b) => a.split('/').length - b.split('/').length);
  for (const folder of folders) {
    const here = byFolder.get(folder);
    const has = (name) => here.find((f) => baseName(f.path).toLowerCase() === name);
    if (!game && has('default.xex') && has('peggle.pak')) {
      // the game's files: everything under its folder but the title update's files (they are taken from the update)
      const files = chosen.filter((f) => f.path.startsWith(folder))
        .map((f) => ({ ...f, path: f.path.slice(folder.length) }))
        .filter((f) => !UPDATE_FILES.includes(f.path.toLowerCase()) && !/(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(f.path)
          && !f.path.includes('/'));
      game = { kind: 'folder', name: folder ? baseName(folder.slice(0, -1)) : '', files };
    }
    if (!update && has('default.xexp') && has('nightstu.pak')) {
      update = { kind: 'folder', name: folder ? baseName(folder.slice(0, -1)) : '', files: UPDATE_FILES.map((n) => ({ ...has(n), path: n })) };
    }
  }
  // Packages, by their header (Xbox 360 content packages have no extension, but a title update's file name has a dot:
  // TU_1C42249_0000108000000.0000000000102; the game's own file types are left out).
  const inside = (f) => [game, update].some((g) => g && g.kind === 'folder' && g.files.some((h) => h.read === f.read));
  const candidates = chosen.filter((f) => f.size >= 0xa000 && !inside(f)
    && !/\.(pak|png|xml|wmv|xex|xexp|bin|zip|nro|toml|txt|db|ini)$/i.test(f.path)).slice(0, MAX_CANDIDATES);
  for (const file of candidates) {
    const header = readStfsHeader(await file.read(0, 0x600));
    if (!header) {
      continue;
    }
    const name = baseName(file.path);
    if (header.titleId !== TITLE_ID) {
      others.push(header.displayName || name);
    } else if (header.contentType === CONTENT_GAME && !game) {
      const pkg = await StfsPackage.open(file);
      game = { kind: 'package', name, files: pkg.files().filter((f) => !f.path.includes('/')) };
    } else if (header.contentType === CONTENT_UPDATE && !update) {
      const pkg = await StfsPackage.open(file);
      const files = pkg.files();
      if (UPDATE_FILES.every((n) => files.some((f) => f.path.toLowerCase() === n))) {
        update = { kind: 'package', name: header.displayName || name, files: UPDATE_FILES.map((n) => ({ ...files.find((f) => f.path.toLowerCase() === n), path: n })) };
      }
    } else if (header.contentType === CONTENT_DLC && !dlc.some((d) => d.name === name)) {
      dlc.push({ name, displayName: header.displayName || name, file });
    }
  }
  return { game, update, dlc, others };
}

function fileNamed(files, name) {
  return files.find((f) => f.path.toLowerCase() === name);
}

// Identifies the build: default.xex and the title update's default.xexp and nightstu.pak by their SHA-256, and each
// DLC package by its SHA-256 among the build's. Returns { xex, xexHash, xexp, xexpHash, build, dlc, problems }
// (dlc: the chosen DLC packages that are the build's, with their names in the zip).
export async function identifyGames(chosen, manifest) {
  const { game, update } = chosen;
  if (!game) {
    const error = new Error(t('noGame'));
    error.code = 'noGame';
    throw error;
  }
  const xexFile = fileNamed(game.files, 'default.xex');
  const xex = await xexFile.read(0, xexFile.size);
  const xexHash = await sha256(xex);
  const build = manifest.builds.find((b) => b.xex_sha256 === xexHash) || null;
  const problems = [];
  let xexp = null;
  let xexpHash = null;
  const dlc = [];
  if (build) {
    if (!update) {
      problems.push('noUpdate');
    } else {
      const xexpFile = fileNamed(update.files, 'default.xexp');
      xexp = await xexpFile.read(0, xexpFile.size);
      xexpHash = await sha256(xexp);
      if (xexpHash !== build.xexp_sha256) {
        problems.push('updateDifferent');
      } else {
        const nights = fileNamed(update.files, 'nightstu.pak');
        if (nights.size !== build.nightstu.size || (await sha256Of(nights)) !== build.nightstu.sha256) {
          problems.push('updateDifferent');
        }
      }
    }
    for (const want of build.game_files) {
      const f = fileNamed(game.files, want.path.toLowerCase());
      if (!f || f.size !== want.size) {
        problems.push('gameDifferent');
        break;
      }
    }
    for (const d of chosen.dlc) {
      const known = (build.dlc || []).find((k) => k.size === d.file.size);
      if (known && (await sha256Of(d.file)) === known.sha256) {
        dlc.push({ ...d, zipName: known.name, title: known.title });
      } else {
        problems.push('dlcDifferent');
      }
    }
  }
  return { xex, xexHash, xexp, xexpHash, build, dlc, problems };
}

// The executable the console runs: default.xex's image with the title update applied (lib/xexp.js).
export async function patchedImage(chosen, modules) {
  const xexFile = fileNamed(chosen.game.files, 'default.xex');
  const xex = await xexFile.read(0, xexFile.size);
  const xexpFile = fileNamed(chosen.update.files, 'default.xexp');
  const xexp = await xexpFile.read(0, xexpFile.size);
  const { image: base } = await readXexImage(xex, lzxStep(modules.lzx));
  const { image } = await applyXexPatch(xex, base, xexp, lzxDeltaStep(modules.lzxDelta));
  return { image, xexHash: await sha256(xex), xexpHash: await sha256(xexp) };
}

// The shaders of the Switch build's renderer (Renut on deko3d): deko3d_glsl.bin, which the NRO reads beside itself,
// made from the shaders stored in the patched executable (lib/deko3d.js) and checked against the build's manifest
// entry ("deko3d": { shaders, containers_sha256, package_sha256 }).
// modules: { lzx, lzxDelta, renutHlsl, dxc, spirvCross }; renutCommon: Renut's shader_common.h; onShader(done, total)
// after each shader.
export async function makeDeko3dPackage(chosen, build, modules, renutCommon, log = () => {}, onShader = () => {}) {
  const { image } = await patchedImage(chosen, modules);
  const wanted = build.deko3d.containers_sha256;
  const containers = [];
  const seen = new Set();
  for (const c of imageContainers(image)) {
    const hash = await sha256(c.bytes);
    if (wanted.includes(hash) && !seen.has(hash)) {
      seen.add(hash);
      containers.push(c);
    }
  }
  if (seen.size !== wanted.length) {
    throw new Error(t('deko3dContainers', { found: seen.size, wanted: wanted.length }));
  }
  log(t('deko3dShaders', { count: build.deko3d.shaders.length }));
  let done = 0;
  const { package: pkg } = await buildDeko3dPackage(containers, modules, renutCommon,
    () => onShader(++done, build.deko3d.shaders.length), build.deko3d.shaders);
  const hash = await sha256(pkg);
  if (hash !== build.deko3d.package_sha256) {
    throw new Error(t('deko3dMismatch', { hash }));
  }
  log(t('deko3dReady'));
  return pkg;
}

// chosen: findGames(); release: { manifest, nro, licenses, renutShaderCommon } (bytes)
// modules: { lzx, lzxDelta, renutHlsl, dxc, spirvCross } instantiated Emscripten modules
// sink: { write(Uint8Array), close() } receiving the zip file
// onSize(bytes) is called with the exact size of the zip before the first byte is written.
// update: only the program, its licenses and the shaders, for a folder already on the SD card.
export async function createPackage(chosen, release, modules, sink, log = () => {}, progress = () => {},
  onSize = () => {}, { update = false } = {}) {
  const id = await identifyGames(chosen, release.manifest);
  const { build } = id;
  if (!build) {
    throw new Error(t('notSupportedYet', { hash: id.xexHash }));
  }
  if (id.problems.length) {
    throw new Error(t(id.problems[0]));
  }
  log(t('logBuild', { version: build.version }));
  if (update) {
    log(t('logUpdate'));
  } else if (id.dlc.length) {
    for (const d of id.dlc) {
      log(t('logDlc', { name: d.title }));
    }
  } else {
    log(t('logNoDlc'));
  }

  // The shaders first: they are the step most likely to stop the package, and nothing is written before them.
  const stage = (from, to) => (f) => progress(from + (to - from) * Math.min(Math.max(f, 0), 1));
  const shaderStage = stage(0, update ? 0.9 : 0.35);
  const deko3d = await makeDeko3dPackage(chosen, build, modules, release.renutShaderCommon, log,
    (done, total) => shaderStage(done / total));

  let gameIndex = null;
  let plan = null;
  let dataChecksum = 0n;
  if (!update) {
    // The game pack: the game's files and the title update's (default.xexp: the console applies it at start, as the
    // Xbox 360 does; nightstu.pak: the update's Peggle Nights texts).
    const files = [...chosen.game.files, ...chosen.update.files];
    plan = planPack(files);
    log(t('checksumming', { count: plan.items.length }));
    const sum = stage(0.35, 0.55);
    const fnv = new Fnv64();
    let seen = 0;
    for (const item of plan.items) {
      for await (const chunk of chunksOf(item.file)) {
        fnv.update(chunk);
        seen += chunk.length;
        sum(seen / plan.packSize);
      }
    }
    dataChecksum = fnv.value();
    gameIndex = packIndex(plan, dataChecksum);
  }

  const dlc = update ? [] : id.dlc;
  const entries = [
    { path: `${ROOT}/peggle1.nro`, size: release.nro.length },
    { path: `${ROOT}/LICENSES.txt`, size: release.licenses.length },
    { path: `${ROOT}/deko3d_glsl.bin`, size: deko3d.length },
    ...(update ? [] : [
      { path: `${ROOT}/game_root.nxidx`, size: gameIndex.length },
      { path: `${ROOT}/game_root.nxpack`, size: plan.packSize },
      ...dlc.map((d) => ({ path: `${ROOT}/dlc/${d.zipName}`, size: d.file.size })),
    ]),
  ];
  onSize(zipSize(entries));
  log(t('packing'));
  const total = update ? 1 : plan.packSize + dlc.reduce((n, d) => n + d.file.size, 0);
  const write = stage(update ? 0.9 : 0.55, 1);
  let done = 0;
  const onChunk = (chunk) => {
    done += chunk.length;
    write(done / total);
  };
  const zip = new ZipWriter(sink);
  await zip.addBytes(`${ROOT}/peggle1.nro`, release.nro);
  await zip.addBytes(`${ROOT}/LICENSES.txt`, release.licenses);
  await zip.addBytes(`${ROOT}/deko3d_glsl.bin`, deko3d);
  if (!update) {
    await zip.addBytes(`${ROOT}/game_root.nxidx`, gameIndex);
    await zip.addFile(`${ROOT}/game_root.nxpack`, plan.packSize,
      packChunks(plan, dataChecksum, (item) => chunksOf(item.file)), onChunk);
    for (const d of dlc) {
      await zip.addFile(`${ROOT}/dlc/${d.zipName}`, d.file.size, chunksOf(d.file), onChunk);
    }
  }
  await zip.finish();
  progress(1);
  log(t('done'));
  return { version: build.version, update };
}
