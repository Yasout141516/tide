# Notices

Tide is free software, licensed under the GNU General Public License version 3 only (GPL-3.0). See
[LICENSE](LICENSE).

The Tide installers (`.dmg` for macOS, `.exe` for Windows) also contain the third-party software
below. Each part keeps its own licence.

## FFmpeg (GPL)

The installers bundle an `ffmpeg` program, used to save audio as `.m4b` audiobooks and `.mp3` files.
It comes from the npm package [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) 5.3.0,
which ships FFmpeg 6.1.1 (release tag
[b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1)). These are GPL builds of
FFmpeg (configured with `--enable-gpl --enable-version3` and GPL parts such as libx264), so the
bundled binary is covered by the GNU GPL version 3 ([FFmpeg legal notes](https://www.ffmpeg.org/legal.html)).

Source code:

- FFmpeg 6.1.1 source: <https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz> (all releases:
  <https://ffmpeg.org/download.html#releases>)
- The ffmpeg-static package: <https://github.com/eugeneware/ffmpeg-static>
- Builders of the bundled binaries, as listed by ffmpeg-static:
  - Windows x64: <https://www.gyan.dev/ffmpeg/builds/>
  - macOS Apple Silicon (arm64): <https://osxexperts.net/>

The licence text and build notes that come with each binary are in the installed app, next to the
binary (`app.asar.unpacked/node_modules/ffmpeg-static/`).

## Voice

- **Kokoro-82M** voice model ([onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
  from [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)): Apache-2.0.
- **kokoro-js** (voices and speech code): Apache-2.0. <https://github.com/hexgrad/kokoro>
- **Transformers.js** (`@huggingface/transformers`): Apache-2.0.
  <https://github.com/huggingface/transformers.js>
- **ONNX Runtime** (`onnxruntime-node`): MIT. <https://github.com/microsoft/onnxruntime>
- **phonemizer**: Apache-2.0; it contains eSpeak NG (GPL-3.0-or-later),
  <https://github.com/espeak-ng/espeak-ng>.
- **sharp** (image library loaded by Transformers.js): Apache-2.0; its native binary
  (`@img/sharp-*`) contains libvips, LGPL-3.0-or-later. <https://github.com/lovell/sharp>

## Text

- **pdf.js** (`pdfjs-dist`): Apache-2.0. <https://github.com/mozilla/pdf.js> For now it is used only
  by Tide's tests and developer scripts, so it is not in the installers yet; the reader screen will
  bundle it.

## Fonts

The installers bundle these fonts (from the [Fontsource](https://fontsource.org/) npm packages), all
under the SIL Open Font License 1.1 (OFL-1.1, <https://openfontlicense.org/>):

- **Nunito Sans**: <https://github.com/googlefonts/nunitosans>
- **Fraunces**: <https://github.com/undercasetype/Fraunces>
- **Press Start 2P**: <https://github.com/codeman38/PressStart2P>
- **Fredoka**: <https://github.com/hafontia-zz/Fredoka-Font>
- **Nunito**: <https://github.com/googlefonts/nunito>

## Electron

- **Electron** (MIT) and Chromium (BSD-style and other licences). Their licence files ship in the
  installed app as `LICENSE.electron.txt` and `LICENSES.chromium.html`.
