# Tide

A calm, offline PDF read-aloud app for course readings. Tide reads your PDFs aloud in a comforting
voice, highlights each sentence as it goes, skips the junk (page numbers, headers, footnotes,
references), remembers your place, and saves passages as audio for your phone.

- Free, and fully offline: the voice ([Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)) runs on your laptop
- macOS (Apple chip) and Windows
- Themes: Sky & Sea (the default), Deep Sea, Pixel Quest, Kitty, and Match my Mac (follows your
  computer's light or dark setting)

> **Status:** v1.0.0 (pre-release). See the [PRD](docs/superpowers/specs/2026-11-16-tide-design.md) and the
> [screen mockups](docs/design/screens-sky-sea.html).

## Download

Get the latest installer from the [Releases page](../../releases):

- **Mac (Apple chip):** the `.dmg` file
- **Windows:** the `.exe` file

Tide is not signed with a paid developer certificate, so on a Mac you must use **Open Anyway** once
the first time you open it (System Settings, Privacy & Security). A hand-off guide with pictures is
coming with the release. To see the version and the licences of everything bundled, choose
Help, then About Tide (Windows), or Tide, then About Tide (Mac).

## For developers

### Prerequisites

Node 22 and git.

### Setup

```sh
git clone https://github.com/Yasout141516/tide.git
cd tide
npm ci
npm run fetch-model   # downloads the voice model into resources/models/ (about 330 MB, checksum-verified)
npm run dev           # starts Tide with hot reload
```

`NODE_EXTRA_CA_CERTS` is only needed behind a TLS-inspecting proxy (set it to your proxy's root
certificate file before `npm ci` and `npm run fetch-model`). Never commit a certificate.

### Scripts

| Script                           | What it does                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                    | Starts the app with hot reload (electron-vite dev)                                                                   |
| `npm start`                      | Previews the last build (`out/`) without hot reload                                                                  |
| `npm run build`                  | Typechecks, then builds the app into `out/`                                                                          |
| `npm run build:unpack`           | Builds, then produces an unpacked app in `release/` (no installer)                                                   |
| `npm run package`                | Builds, then produces the installers for the current OS in `release/` (never publishes; needs a git `origin` remote) |
| `npm test`                       | Unit tests (vitest)                                                                                                  |
| `npm run e2e`                    | Same as `npx playwright test` (run `npm run build` first)                                                            |
| `npm run lint`                   | ESLint                                                                                                               |
| `npm run format`                 | Prettier, rewrites files                                                                                             |
| `npm run typecheck`              | Typechecks the main/preload code and the renderer (`typecheck:node`, `typecheck:web`)                                |
| `npm run fetch-model`            | Downloads and verifies the Kokoro voice model (`-- --dtype all` also fetches fp32)                                   |
| `npm run spoken-text -- f.pdf`   | Prints what Tide would speak for a PDF, one sentence per line (`--everything` turns the filters off)                 |
| `npm run voice-samples -- f.pdf` | Renders a short sample in every candidate voice into `local-fixtures/` (needs `--dtype all` model)                   |
| `npm run icons`                  | Regenerates every app icon from `build/icon.svg`                                                                     |
| `npm run voice-previews:render`  | Re-renders the bundled voice preview MP3s in `src/renderer/public/voice-previews/` (needs the model)                 |

### Tests

```sh
npm test                    # unit tests
npm run build               # the dev e2e tests launch the build in out/, so build first
npx playwright test         # end-to-end tests against that build; they run serially
```

The packaged run tests the real installer build, with the offline guard that fails any network
access:

```sh
npm run package
TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test
```

`local-fixtures/` is git-ignored. It holds real readings and voice samples that are copyrighted, and
must never be committed.

### Project layout

- `src/main/`: Electron main process (windows, menus, library storage, audio export, IPC)
- `src/preload/`: the bridge that exposes a small, typed API to the renderer
- `src/renderer/`: the React user interface (reader, library, settings, themes)
- `src/shared/`: code used by more than one process (PDF text extraction and cleanup, themes, voices, types)
- `src/tts/`: text-to-speech engine and worker (Kokoro), sentence queue and scheduler

## Release process

1. Bump the version in `package.json` and merge that to `main`.
2. Tag `vX.Y.Z` and push the tag. CI builds both installers into a draft GitHub release and attaches
   the FFmpeg source (`ffmpeg-6.1.1.tar.xz` and `FFMPEG-SOURCE.md`, checksum-verified).
3. Download both installers from the draft and smoke-test them.
4. Publish the draft by hand.

To rehearse without publishing anything, run the dry run from any branch:

```sh
gh workflow run release.yml --ref <branch> -f dry_run=true
```

A manual run never publishes: it builds both installers and uploads them, plus the FFmpeg source, as
workflow artifacts.

## License

GPL-3.0. See [LICENSE](LICENSE). The installers bundle third-party software (ffmpeg, the Kokoro voice
model, ONNX Runtime and more): see [NOTICE.md](NOTICE.md) for their licences and source links.
