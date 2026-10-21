<div align=center>

<img src="icons/icon-192.png" alt="Peggle" width="20%">

</div>
<h1 align=center>peggle1-nx installer</h1>

The installer page of [peggle1-nx](https://github.com/ChanseyIsTheBest/peggle1-nx), the native Nintendo Switch port of
Peggle (Xbox Live Arcade): **https://chanseyisthebest.github.io/peggle1-nx-installer/**

You give it your own copy of the game, its Title Update #3 and, if you have it, Peggle Nights, and it gives you a zip
ready to extract into `sdmc:/switch/`. Everything runs in your browser: the game files never leave your computer.

## What it does

1. **Finds your files** in what you chose (files or a whole folder):
   - the game: its content package `87D0A5D366F24C8FF8BEE120E5F72D78F100E189` (title `58410889`, content type
     `0x000D0000`, read in place: `lib/from_sa2/stfs_package.js`), or a folder it was extracted into (`default.xex`
     with `peggle.pak`);
   - Title Update #3: its package (content type `0x000B0000`, e.g. `TU_1C42249_0000108000000.0000000000102`), or its
     `default.xexp` and `nightstu.pak` in a folder. It is needed: the port's code is the updated executable;
   - Peggle Nights (optional): its package `6AE5772224F8D86683B03E3A1B7509A48D1D4AAE58` (content type `0x00000002`).
2. **Checks them** against `release/manifest.json`: `default.xex`, `default.xexp`, `nightstu.pak` and the Peggle Nights
   package by their SHA-256, the game's other files by their sizes.
3. **Downloads the build's NRO** and checks its SHA-256.
4. **Makes the renderer's shaders** (`deko3d_glsl.bin`): the title update applied to `default.xex` as the console does
   (`lib/xexp.js`: the runtime's XEX patch steps, with libmspack's LZX delta decoder in `wasm/lzxdelta.*`), the 82
   shader containers the patched executable stores (`lib/containers.js`), translated by Renut's XenosRecomp
   (`wasm/renut_hlsl`), DXC (`wasm/dxc_web`) and SPIRV-Cross (`wasm/spirv_cross`) and turned into the GLSL the
   console's shader compiler takes (`lib/deko3d_glsl.js`, `lib/deko3d_package.js`). The package must match the
   manifest's SHA-256: it is the one the release was tested with.
5. **Writes the game pack** (`game_root.nxpack` + `.nxidx`, `lib/nxpack.js`) from the game's files and the title
   update's.
6. **Streams the zip to disk** through the service worker, so nothing large has to fit in memory.

The zip holds `peggle1-nx/peggle1.nro` with its `LICENSES.txt`, `deko3d_glsl.bin`, `game_root.nxpack` + `.nxidx` and,
when you chose it, `dlc/` with the Peggle Nights package (the game installs it at its first start). The update zip holds
the NRO, its licenses and the shaders. Neither holds `peggle1.toml`: the game writes it at its first start, so an
update never overwrites your settings.

## Checks

- `test/p1_deko3d_node.mjs`: the patched executable is the runtime's (the same image as peggle1-nx's code generator
  used, apart from the import table the loader fills in), and its 82 shaders come out of the page's chain as the
  native chain's GLSL (15 byte for byte, 67 with the same code and other SPIR-V temporary numbers: DXC v2025.1 against
  1.8.2407).
- `test/package_node.mjs`: the whole zip in Node with the page's code; its game pack is the native tool's byte for byte
  (apart from the pack's random id). That zip, extracted, was played in Ryujinx from a first start: the game wrote its
  settings, installed Peggle Nights and compiled its shaders from `deko3d_glsl.bin`.
- `test/browser_package.html`: the same in the browser (Chromium): the same shaders and the same zip size.
- `test/texts_node.mjs`: the interface texts.

## Layout

| Path | Contents |
|---|---|
| `index.html`, `app.js` | The page and its interface (`lib/i18n.js`) |
| `worker.js` | Builds the package off the main thread |
| `sw.js` | Offline cache and the download stream |
| `lib/` | STFS package reader, XEX reader and patcher, shader containers, deko3d shader chain, asset pack and zip writers |
| `wasm/` | WebAssembly builds: DXC and the LZX decoder (futari-nx-installer's), the LZX delta decoder (`wasm/src/lzx/`), Renut's shader translator and SPIRV-Cross (`wasm/src/deko3d/build_wasm_deko3d.sh`, built from peggle2-nx, whose translator is peggle1-nx's) |
| `release/` | The list of builds and the licenses of the NRO; the deployment adds the NRO from the peggle1-nx release |
| `test/` | Node scripts and a browser page that run the same code as the page |

## License

GPL-3.0 (see [LICENSE](LICENSE)). Third-party components are listed in [NOTICES.md](NOTICES.md). The page is built on
[peggle2-nx-installer](https://github.com/ChanseyIsTheBest/peggle2-nx-installer), itself built on
[futari-nx-installer](https://github.com/ChanseyIsTheBest/futari-nx-installer),
[sa2-nx-installer](https://github.com/ChanseyIsTheBest/sa2-nx-installer) and
[nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND.

Peggle is a trademark of PopCap Games / Electronic Arts; the icon artwork is © PopCap Games. This project is not
affiliated with or endorsed by PopCap Games, Electronic Arts, Nintendo or Microsoft.
