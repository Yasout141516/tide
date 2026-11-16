# Tide M0 + M1: Foundation, Spikes and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tide Electron app skeleton that builds a Mac (arm64) `.dmg` and a Windows `.exe` in GitHub Actions and speaks a sentence offline when packaged. It also includes the text pipeline that turns a PDF into clean spoken sentences, the audiobook (`.m4b`) export, and the voice-sample script, which together prove PRD spikes M0a–e.

**Architecture:** electron-vite project with three Electron targets (main, preload, renderer) plus a fourth entry, the TTS `utilityProcess`. The text pipeline is pure TypeScript in `src/shared/text/` (no DOM, no Electron), so it runs in Vitest, in a Node CLI and later in a renderer Web Worker. Audio export shells out to a bundled `ffmpeg-static` binary from the main process.

**Tech Stack:** Electron 45, electron-vite 6, React 19 + TypeScript (strict), Tailwind CSS 4, kokoro-js 1.2.1 (+ @huggingface/transformers 3, onnxruntime-node), pdfjs-dist 5 (legacy build in Node), pdf-lib (fixture generation only), ffmpeg-static, Vitest, Playwright (`_electron`), electron-builder 26, GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-11-16-tide-design.md`](../specs/2026-11-16-tide-design.md). Read §6 (how it's built), §6.3 (text pipeline), §6.5 (Save as audio), §6.7 (voices) and §7 M0/M1 before starting.

## Global Constraints

- App name **Tide**. `appId` `com.yasout141516.tide`. Licence GPL-3.0.
- Mac build: **arm64 only**, `.dmg`, `mac.identity: "-"` (ad-hoc), no notarization. Windows: NSIS x64.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `backgroundThrottling: false`.
- **No network at runtime.** transformers.js `env.allowRemoteModels = false`, `env.localModelPath` set to the bundled models dir.
- Kokoro model: repo `onnx-community/Kokoro-82M-v1.0-ONNX` @ revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`. Default dtype `q8` (file `onnx/model_quantized.onnx`). Voices come from `node_modules/kokoro-js/voices/*.bin`.
- `kokoro-js`, `@huggingface/transformers`, `onnxruntime-node`, `phonemizer` and `ffmpeg-static` are **never bundled by Vite** (externalized). They are `asarUnpack`ed.
- Long-sentence budget: **≤ 400 phoneme tokens per synthesis chunk** (Kokoro hard limit ~510, and kokoro-js truncates silently).
- Audio: Kokoro output 24 kHz mono. `.m4b` = AAC-LC 64 kbps mono, one chapter per page. Exports write `<name>.part` then rename.
- Her real PDFs live only in git-ignored `local-fixtures/`. They are never committed, uploaded or read by CI.
- CI Node version: **22**. Runners: `macos-latest` (Apple chip) and `windows-latest`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A PDF (or page) with no text layer at all** should come back from `buildSentences` as zero sentences, with every textless page listed in `textlessPages`, not crash or hang. *(Task 9 test `no-text pdf`.)*
2. **One huge "sentence" with no punctuation** (a 600-word run-on from a table or bad extraction) must split at word boundaries into chunks that each stay ≤ 400 tokens and rejoin to the original. *(Task 4 test `word-boundary fallback`.)*
3. **Missing or corrupt model files in a packaged app** should make `TtsHost.start()` reject with a readable error within 30 s, never hang forever. *(Task 3 test `missing model rejects`.)*
4. **PDF ligatures and typography** (ﬁ, ﬂ, ﬀ, soft hyphens U+00AD, non-breaking spaces) are normalized to plain text before any matching, so "ﬁgure" still counts as a caption and "beneﬁt" is spoken correctly. *(Task 6 test `normalizes ligatures`.)*
5. **"References" appearing early**, in a table of contents or as a mid-document heading before 60% of the document, must not stop reading. *(Task 8 test `ignores early references heading`.)*

---

## File Structure

```
package.json                     scripts, deps, electron-builder config pointer
electron.vite.config.ts          main/preload/renderer + tts-worker entry; externals
electron-builder.yml             packaging (mac arm64 dmg ad-hoc, win nsis), asarUnpack, extraResources
tsconfig.json / tsconfig.node.json / tsconfig.web.json
vitest.config.ts
playwright.config.ts
src/main/index.ts                app lifecycle, BrowserWindow, registers IPC
src/main/paths.ts                resolve bundled resources in dev vs packaged
src/main/tts-host.ts             TtsHost: spawns utilityProcess, request/response by id, timeouts
src/main/audio-export.ts         ffmpeg-based exportM4b / exportMp3 / ffmpegHasMp3
src/main/ipc.ts                  ipcMain handlers (tts:*, test-only export hook)
src/preload/index.ts             contextBridge: window.tide (+ window.tideTest when TIDE_E2E=1)
src/renderer/index.html, src/renderer/src/main.tsx, App.tsx, styles.css   placeholder UI
src/tts/protocol.ts              TtsRequest / TtsResponse types (shared by host + worker)
src/tts/worker.ts                utilityProcess entry: loads Kokoro offline, synthesizes
src/tts/split.ts                 splitForSpeech (pure, injected token counter)
src/shared/text/types.ts         TextItem, PageText, Line, Span, Sentence, ReadingFilters, consts
src/shared/text/normalize.ts     ligature / whitespace normalization
src/shared/text/extract.ts       pdfjs → PageText[] (Node legacy build; renderer later)
src/shared/text/lines.ts         items → Line[] (baseline grouping, 2-column ordering)
src/shared/text/spoken.ts        SpokenText builder: text + char→Span mapping
src/shared/text/filters.ts       headers/footers/page numbers, footnotes, captions/tables, cover, references
src/shared/text/citations.ts     citation removal on SpokenText
src/shared/text/sentences.ts     Intl.Segmenter + abbreviation merge → Sentence[]
src/shared/text/pipeline.ts      buildSentences(pages, filters) orchestration
scripts/fetch-model.mjs          download pinned model files, verify sha256
scripts/make-fixtures.ts         pdf-lib generator for tests/fixtures/pdfs/*.pdf
scripts/spoken-text.ts           CLI: pdf → spoken text (for her real readings)
scripts/voice-samples.ts         M0e: render candidate voices to WAV + compare page
scripts/check-chapters.swift     M0d: AVFoundation chapter count (macOS CI)
tests/unit/**.test.ts            Vitest
tests/fixtures/pdfs/*.pdf        generated, committed
tests/fixtures/spoken/*.txt      golden spoken-text snapshots
tests/e2e/smoke.spec.ts          Playwright: dev + packaged smoke
.github/workflows/ci.yml         PR/push: test + package + packaged smoke on mac & win
.github/workflows/release.yml    tag v*: package + GitHub Release
docs/spikes/m0-results.md        recorded spike outcomes + decisions
```

---

### Task 1: Project scaffold with a launching window

**Files:**
- Create: everything the electron-vite `react-ts` template creates, at the repo root (keep existing `docs/`, `README.md`, `LICENSE`, `.gitignore`, `.gitattributes`)
- Create: `src/main/paths.ts`, `vitest.config.ts`, `playwright.config.ts`, `tests/unit/paths.test.ts`, `tests/e2e/smoke.spec.ts`
- Modify: `src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/index.html`, `package.json`, `.gitignore`

**Interfaces:**
- Produces: `resourcePath(...segments: string[]): string` in `src/main/paths.ts`. In dev it resolves from `<repo>/resources/`, and when packaged from `process.resourcesPath`.
- Produces: `unpackedPath(p: string): string`, which replaces `app.asar` with `app.asar.unpacked` in a path.
- Produces: npm scripts `dev`, `build`, `typecheck`, `test` (vitest run), `e2e` (playwright test), `package` (electron-builder, added in Task 5).

- [ ] **Step 1: Scaffold.** In a temp dir run `npm create @quick-start/electron@latest tide -- --template react-ts --skip`, copy its contents into the repo root without overwriting `README.md`, `LICENSE` or `.gitignore`, then `npm install`. Add Tailwind 4 per the `@tailwindcss/vite` setup to the renderer config. Add `vitest`, `@playwright/test`, `tsx` as dev deps. Set `"name": "tide"`, `"productName": "Tide"`, `"license": "GPL-3.0-only"`, and keep `"type": "module"` if the template set it.
- [ ] **Step 2: Harden the window** in `src/main/index.ts`: title `Tide`, `minWidth: 900`, `minHeight: 600`, and `webPreferences` exactly as in Global Constraints. On macOS, `close` hides the window (`e.preventDefault(); win.hide()`) unless the app is quitting (`app.on('before-quit')` sets a flag). `activate` shows it again.
- [ ] **Step 3: Write the failing tests.**

```ts
// tests/unit/paths.test.ts
import { describe, it, expect } from 'vitest'
import { unpackedPath } from '../../src/main/paths'
describe('unpackedPath', () => {
  it('rewrites app.asar to app.asar.unpacked', () => {
    expect(unpackedPath('/A/Tide.app/Contents/Resources/app.asar/node_modules/x'))
      .toBe('/A/Tide.app/Contents/Resources/app.asar.unpacked/node_modules/x')
  })
  it('leaves non-asar paths alone', () => {
    expect(unpackedPath('C:\\dev\\tide\\node_modules\\x')).toBe('C:\\dev\\tide\\node_modules\\x')
  })
})
```

```ts
// tests/e2e/smoke.spec.ts  (dev build; packaged variant added in Task 5)
import { test, expect, _electron as electron } from '@playwright/test'
test('window opens titled Tide', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, TIDE_E2E: '1' } })
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Tide')
  await expect(win.getByText('Tide')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 4: Run.** `npm test` should FAIL ("unpackedPath is not exported").
- [ ] **Step 5: Implement** `resourcePath` and `unpackedPath` (`app.isPackaged` decides the base). Replace the template's demo UI in `App.tsx` with a centered `<h1>Tide</h1>`.
- [ ] **Step 6: Verify.** `npm run typecheck && npm test && npm run build && npm run e2e`. All should PASS.
- [ ] **Step 7: Commit.** `.gitignore` gets `resources/models/`, `test-results/`, `playwright-report/`. Message: `feat: scaffold Tide electron-vite app with hardened window`.

---

### Task 2: Pinned model download

**Files:**
- Create: `scripts/fetch-model.mjs`, `scripts/model-manifest.json`, `tests/unit/fetch-model.test.ts`
- Modify: `package.json` (script `fetch-model`, and `postinstall` does **not** run it, because CI calls it explicitly and caches the result)

**Interfaces:**
- Produces: on-disk layout `resources/models/onnx-community/Kokoro-82M-v1.0-ONNX/{config.json,tokenizer.json,tokenizer_config.json,onnx/model_quantized.onnx}` (plus `onnx/model.onnx` when run with `--dtype fp32`).
- Produces: exported `verifySha256(filePath: string, expectedHex: string): Promise<void>`, which throws `Error('sha256 mismatch for <file>')`.

- [ ] **Step 1: Write `scripts/model-manifest.json`** with revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231` and these files. Small JSON files have no published LFS hash, so `sha256` is `null` and they're verified only by successful JSON parse.

| path | size | sha256 |
|---|---|---|
| `config.json` | 44 | null |
| `tokenizer.json` | 3497 | null |
| `tokenizer_config.json` | 113 | null |
| `onnx/model_quantized.onnx` (q8) | 92361116 | `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478` |
| `onnx/model.onnx` (fp32, optional) | 325532232 | `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb` |

- [ ] **Step 2: Write the failing test.**

```ts
// tests/unit/fetch-model.test.ts
import { it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'; import { tmpdir } from 'node:os'
import { verifySha256 } from '../../scripts/fetch-model.mjs'
it('accepts a matching hash and rejects a wrong one', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tide-')), 'a.bin'); writeFileSync(f, 'abc')
  await expect(verifySha256(f, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).resolves.toBeUndefined()
  await expect(verifySha256(f, '00'.repeat(32))).rejects.toThrow('sha256 mismatch')
})
```

- [ ] **Step 3: Run.** `npx vitest run tests/unit/fetch-model.test.ts` should FAIL.
- [ ] **Step 4: Implement `fetch-model.mjs`.** Download `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/<revision>/<path>` to `<path>.part`, verify, then rename. Skip files that already exist with the right size+hash. The `--dtype q8|fp32|all` flag defaults to `q8`. Only guard the CLI main with `if (import.meta.url === pathToFileURL(process.argv[1]).href)`, so tests can import it.
- [ ] **Step 5: Verify.** Run the test, which should PASS, then `npm run fetch-model`. Files should be present, and a second run should print "up to date".
- [ ] **Step 6: Commit.** `feat: add pinned, hash-verified Kokoro model download`.

---

### Task 3: Offline TTS utilityProcess and host

**Files:**
- Create: `src/tts/protocol.ts`, `src/tts/worker.ts`, `src/main/tts-host.ts`, `src/main/ipc.ts`, `tests/unit/tts-host.test.ts`
- Modify: `electron.vite.config.ts` (add `tts-worker` entry under `main.build.rollupOptions.input`, output `out/main/tts-worker.js`; `external` = the six modules in Global Constraints), `src/main/index.ts` (create the host, register IPC, `host.start()` after window load), `src/preload/index.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces (`src/tts/protocol.ts`):
  ```ts
  export type VoiceId = string            // e.g. 'af_heart'
  export type TtsRequest =
    | { id: number; type: 'load'; modelDir: string; dtype: 'q8' | 'fp32' }
    | { id: number; type: 'synthesize'; text: string; voice: VoiceId; speed: number }
  export type TtsResponse =
    | { id: number; type: 'loaded'; loadMs: number }
    | { id: number; type: 'audio'; pcm: Float32Array; sampleRate: 24000; synthMs: number; chunks: number }
    | { id: number; type: 'error'; message: string }
  ```
- Produces (`src/main/tts-host.ts`): `class TtsHost { constructor(opts: { workerPath: string; modelDir: string; dtype?: 'q8'|'fp32'; timeoutMs?: number; fork?: ForkFn }); start(): Promise<{ loadMs: number }>; synthesize(text: string, o: { voice: VoiceId; speed: number }): Promise<{ pcm: Float32Array; sampleRate: 24000; synthMs: number; chunks: number }>; dispose(): void }`. `ForkFn` defaults to `utilityProcess.fork` and is injectable for unit tests. The default `timeoutMs` is 30000 for `start` and 60000 per `synthesize`.
- Produces (preload): `window.tide.tts.synthesize(text, { voice, speed })`. When `TIDE_E2E=1`: `window.tideTest.ttsLoad(): Promise<{loadMs}>`.
- Consumes: `resourcePath`, `unpackedPath` (Task 1). Model layout from Task 2.

- [ ] **Step 1: Write the failing unit tests** with a fake forked process (an EventEmitter with `postMessage`):

```ts
// tests/unit/tts-host.test.ts
it('resolves synthesize by matching response id', /* fake replies {id, type:'audio', pcm:new Float32Array(4), ...} */)
it('rejects with the worker error message', /* fake replies {type:'error', message:'boom'} → rejects 'boom' */)
it('missing model rejects', /* fake never replies to load; timeoutMs: 50 → rejects /did not load within/ */)
it('rejects pending requests when the process exits', /* fake emits 'exit' 1 → rejects /voice engine stopped/ */)
```

- [ ] **Step 2: Run.** `npx vitest run tests/unit/tts-host.test.ts` should FAIL.
- [ ] **Step 3: Implement `TtsHost`.** It keeps a monotonically increasing id and a `Map<id, {resolve,reject,timer}>`. On `exit` it rejects all pending requests with `Error('voice engine stopped')`.
- [ ] **Step 4: Implement `worker.ts`** (runs in the utilityProcess and receives messages via `process.parentPort`):
  - Set `env.allowRemoteModels = false`, `env.localModelPath = modelDir`, then call `KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })`.
  - When `process.env.TIDE_OFFLINE_GUARD === '1'`, replace `globalThis.fetch` with a function that throws `Error('network access attempted: <url>')`. That way any hidden download fails loudly in tests.
  - Answer `synthesize` with `tts.generate(text, { voice, speed })` → `audio.audio` (Float32Array). Splitting via Task 4 is wired in that task.
  - Wrap each request so errors become `{type:'error'}` replies, never an unhandled rejection.
- [ ] **Step 5: Implement `ipc.ts`.** `ipcMain.handle('tts:synthesize', …)` forwards to the host. `tts:test-load` is registered only when `TIDE_E2E=1`. The host's `workerPath` is `join(__dirname, 'tts-worker.js')` and `modelDir` is `resourcePath('models')`.
- [ ] **Step 6: Extend the e2e test.**

```ts
test('speaks one sentence offline', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, TIDE_E2E: '1', TIDE_OFFLINE_GUARD: '1' } })
  const win = await app.firstWindow()
  const { loadMs } = await win.evaluate(() => (window as any).tideTest.ttsLoad())
  const r = await win.evaluate(() => (window as any).tide.tts.synthesize(
    'Most adults can keep about four items in mind at once.', { voice: 'af_heart', speed: 1 }))
  expect(r.sampleRate).toBe(24000)
  expect(r.pcm.length).toBeGreaterThan(24000)          // > 1 s of audio
  console.log(JSON.stringify({ loadMs, synthMs: r.synthMs, audioSec: r.pcm.length / 24000 }))
  await app.close()
})
```

- [ ] **Step 7: Verify.** `npm test` should PASS. `npm run build && npm run e2e` should PASS on your Windows machine, and the logged JSON shows the real-time factor (`synthMs / 1000 / audioSec`, must be < 1).
- [ ] **Step 8: Commit.** `feat: offline Kokoro TTS in a utilityProcess with timeouts and offline guard`.

---

### Task 4: Long-sentence splitting for speech

**Files:**
- Create: `src/tts/split.ts`, `tests/unit/split.test.ts`
- Modify: `src/tts/worker.ts` (synthesize = split → generate each chunk → concatenate PCM; `chunks` in the reply = number of chunks)

**Interfaces:**
- Produces: `splitForSpeech(text: string, countTokens: (s: string) => Promise<number>, maxTokens = 400): Promise<string[]>`.
- Produces (worker-internal): `countTokens(s)` = character length of `(await phonemize(s, 'en-us')).join(' ')`, using `phonemize` from the `phonemizer` package (the same phonemizer kokoro-js uses; Kokoro tokens are per phoneme character).

**Algorithm** (greedy, preserves text exactly):
1. If `countTokens(text) <= max`, return `[text]`.
2. Otherwise split into pieces after each `;` or `:`. Greedily pack consecutive pieces while the packed string stays `≤ max`. Any single piece still `> max` is recursively split after `,`, and any piece still `> max` after commas is split at spaces (word-boundary fallback).
3. `chunks.join('')` must equal the original `text`. Whitespace stays attached to the end of the preceding chunk, and chunks are `.trim()`ed only when sent to Kokoro.

- [ ] **Step 1: Write the failing tests** with a fake counter `s => Promise.resolve(s.length)`:

```ts
it('keeps short text whole', async () => expect(await splitForSpeech('Hi there.', c, 400)).toEqual(['Hi there.']))
it('prefers semicolons over commas', async () => {
  const t = 'a'.repeat(250) + '; ' + 'b'.repeat(250) + ', c.'
  const out = await splitForSpeech(t, c, 400)
  expect(out[0].endsWith('; ')).toBe(true); expect(out.join('')).toBe(t)
})
it('word-boundary fallback', async () => {
  const t = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ')
  const out = await splitForSpeech(t, c, 400)
  for (const ch of out) expect(ch.length).toBeLessThanOrEqual(400)
  expect(out.join('')).toBe(t)
})
it('real phonemizer: a 120-word academic sentence stays within budget', /* uses worker countTokens; each chunk ≤ 400 */)
```

- [ ] **Step 2: Run** the tests. They should FAIL.
- [ ] **Step 3: Implement** `splitForSpeech`, then wire it into the worker.
- [ ] **Step 4: Verify.** `npm test` should PASS, and `npm run build && npm run e2e` should still pass.
- [ ] **Step 5: Commit.** `feat: split over-long sentences at clause boundaries before synthesis`.

---

### Task 5: Packaging and CI on macOS + Windows (M1, spikes M0a/M0b)

**Files:**
- Create: `electron-builder.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `playwright.config.ts` (project `packaged` with `TIDE_PACKAGED=1`), `tests/e2e/smoke.spec.ts` (launch target chosen by env), `package.json` (`package`: `electron-vite build && electron-builder --publish never`)

**Interfaces:**
- Produces: `release/mac-arm64/Tide.app` and `release/Tide-<ver>-arm64.dmg`; `release/win-unpacked/Tide.exe` and `release/Tide Setup <ver>.exe`.
- Produces: an e2e launch helper. When `TIDE_PACKAGED=1`, `executablePath` is the packaged binary (`release/mac-arm64/Tide.app/Contents/MacOS/Tide` or `release/win-unpacked/Tide.exe`); otherwise `args: ['out/main/index.js']`.

- [ ] **Step 1: Write `electron-builder.yml`:**
  - `appId: com.yasout141516.tide`, `productName: Tide`, `directories.output: release`
  - `asarUnpack: ['node_modules/onnxruntime-node/**', 'node_modules/kokoro-js/**', 'node_modules/phonemizer/**', 'node_modules/ffmpeg-static/**']`
  - `extraResources: [{ from: resources/models, to: models }]`
  - `mac: { target: [{ target: dmg, arch: [arm64] }], identity: '-', hardenedRuntime: false, category: public.app-category.education }`
  - `win: { target: [{ target: nsis, arch: [x64] }] }`
  - `nsis: { oneClick: true, perMachine: false }`
  - `files` excludes `local-fixtures/**`, `tests/**`, `docs/**`, `scripts/**`
- [ ] **Step 2: Package locally on Windows.** `npm run package`, then `TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test`. **Expected: both smoke tests PASS against `release/win-unpacked/Tide.exe`.** This is the "silent when packaged" check: if the voice fails here, fix the asarUnpack and externals before continuing.
- [ ] **Step 3: Write `.github/workflows/ci.yml`.** It triggers on push and pull_request, with matrix `os: [macos-latest, windows-latest]`. Steps:
  1. checkout, then setup-node 22 with npm cache, then `npm ci`
  2. restore `actions/cache` for `resources/models`, keyed on `hashFiles('scripts/model-manifest.json')`; then `npm run fetch-model`
  3. `npm run typecheck`, then `npm test`, then `npm run package`
  4. `npx playwright test` with `TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1`. On Windows the packaged app works headless; on macOS, runners have a GUI session.
  5. append the logged `{loadMs, synthMs, audioSec}` JSON and the real-time factor to `$GITHUB_STEP_SUMMARY`
  6. **macOS only (M0b):**
     - `codesign --verify --deep --strict release/mac-arm64/Tide.app` succeeds
     - `codesign -dv release/mac-arm64/Tide.app 2>&1 | grep 'Signature=adhoc'` matches. This proves the ad-hoc signature that avoids the "damaged" error
     - then `xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Safari;" release/mac-arm64/Tide.app && spctl --assess --type execute -vv release/mac-arm64/Tide.app || true`, with the output written to the summary (expected: "rejected", which is the state that offers **Open Anyway**)
  7. upload the `.dmg` and `.exe` as artifacts (7-day retention)
- [ ] **Step 4: Write `.github/workflows/release.yml`.** It triggers on `push: tags: ['v*']` with the same matrix. It runs `electron-builder --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `publish: { provider: github, releaseType: draft }`, plus `permissions: contents: write`.
- [ ] **Step 5: Verify.** Push to a branch and open a PR. **Expected: both matrix jobs green.** The summary shows load time and real-time factor (target: first audio < 2 s after load, RTF < 1) plus `Signature=adhoc`.
- [ ] **Step 6: Commit.** `ci: package arm64 dmg + win nsis and run packaged offline smoke on both OSes`.

---

### Task 6: PDF extraction, normalization and line building

**Files:**
- Create: `src/shared/text/types.ts`, `src/shared/text/normalize.ts`, `src/shared/text/extract.ts`, `src/shared/text/lines.ts`, `scripts/make-fixtures.ts`, `tests/fixtures/pdfs/*.pdf` (generated), `tests/unit/text/extract.test.ts`, `tests/unit/text/lines.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface TextItem { page: number; index: number; str: string; x: number; y: number; width: number; fontSize: number }
  //   y = baseline distance from page TOP (pdf.js transform f → pageHeight - f); x,width in PDF points
  export interface PageText { page: number; width: number; height: number; items: TextItem[] }
  export interface Line { page: number; items: TextItem[]; text: string; x: number; y: number; width: number; fontSize: number }
  export interface Span { page: number; itemIndex: number; start: number; end: number }   // [start,end) in item.str
  export interface Sentence { id: number; text: string; spans: Span[] }
  export interface ReadingFilters { skipHeadersFooters: boolean; skipFootnotes: boolean; stopAtReferences: boolean;
    skipCaptionsTables: boolean; skipCoverPages: boolean; readCitations: boolean }
  export const DEFAULT_FILTERS: ReadingFilters   // all skips true, readCitations false
  export const READ_EVERYTHING: ReadingFilters   // all skips false, readCitations true
  export const PIPELINE_VERSION = 1
  ```
- Produces: `normalizeText(s: string): string`. It maps ﬁ→fi, ﬂ→fl, ﬀ→ff, ﬃ→ffi, ﬄ→ffl, removes U+00AD, maps U+00A0/U+2009 → space, and collapses runs of spaces. **Item `str` keeps the original characters.** Normalization is applied when building `Line.text` and spoken text, and the char→Span mapping in Task 7 accounts for length changes.
- Produces: `extractPages(data: Uint8Array): Promise<PageText[]>`. It uses `pdfjs-dist/legacy/build/pdf.mjs` and skips empty-string items, while `index` stays the item's index in pdf.js `getTextContent().items` so highlight can address it later. It throws `Error('PDF is password-protected')` on `PasswordException`.
- Produces: `buildLines(page: PageText): Line[]`:
  - Items join a line when `|Δy| < 0.5 × fontSize`. Within a line they sort by x, with a space inserted when the x-gap is > 0.15 × fontSize.
  - **Two columns:** if some x in the middle third of the page (`0.33w–0.67w`) is crossed by no item, and items lie on both sides of it across ≥ 70% of the vertical span between the first and last line of body text, the page is two-column. Return all lines with `x + width ≤ gutter`, ordered by y, then the lines right of it, ordered by y. Full-width lines (that cross the gutter) are emitted in y order before the column whose first line is below them.
- Produces (`make-fixtures.ts`, run with `npx tsx scripts/make-fixtures.ts`): deterministic PDFs with pdf-lib, standard Helvetica, letter size. Each fixture has a `.json` sidecar listing what *should* be spoken.
  - `single-column.pdf`: 4 pages. Running header "PSYC 201 — Week 4" and footer "Page N" on every page, a hyphenated line break `atten-` / `tion`, a footnote marker "¹" and a 7pt footnote "¹ See Miller (1956)."
  - `two-column.pdf`: 3 pages, two columns, with a full-width title.
  - `captions-tables.pdf`: "Figure 1. Recall by list length." and a 4×4 table of short numbers.
  - `cover-refs.pdf`: 6 pages. Page 1 is a cover with "© 2026 Course Pack — All rights reserved". Page 2 is a table of contents including "References ........ 6". Page 3 has a mid-document "Notes" heading. Page 6 has a "References" heading followed by entries.
  - `citations.pdf`: sentences with `(Smith, 2019)`, `(Smith & Jones, 2019, p. 4)`, `(e.g., Lee et al., 2020; Kim, 2021)`, `[12]`, `[3–5]`, "Smith (2019) argues", and the non-citation "(born 1990 in Leeds)".
  - `no-text.pdf`: 2 pages with only a drawn rectangle.
  - `ligatures.pdf`: contains "ﬁgure", "beneﬁt" and "o\u00ADther".
  - `long-sentence.pdf`: one 130-word sentence.

- [ ] **Step 1: Write the generator** and run it. The fixtures are committed.
- [ ] **Step 2: Write the failing tests:**

```ts
it('normalizes ligatures', () => expect(normalizeText('ﬁgure beneﬁt o\u00ADther')).toBe('figure benefit other'))
it('extracts items with top-origin y and page numbers', async () => {
  const pages = await extractPages(read('single-column.pdf'))
  expect(pages).toHaveLength(4); expect(pages[0].items[0].page).toBe(1)
  const header = pages[0].items.find(i => i.str.includes('PSYC 201'))!
  expect(header.y).toBeLessThan(pages[0].height * 0.1)
})
it('orders two-column text left column first', async () => {
  const lines = buildLines((await extractPages(read('two-column.pdf')))[0]).map(l => l.text)
  expect(lines.indexOf('LEFT-END')).toBeLessThan(lines.indexOf('RIGHT-START'))   // markers placed by the generator
})
```

  *(Password-protected PDFs: `extractPages` maps pdf.js `PasswordException` to `Error('PDF is password-protected')` now, but its test and fixture belong to the M3 plan, which owns the password dialog.)*
- [ ] **Step 3: Run** the tests. They should FAIL.
- [ ] **Step 4: Implement** `normalize.ts`, `extract.ts` and `lines.ts`.
- [ ] **Step 5: Verify.** `npm test` should PASS.
- [ ] **Step 6: Commit.** `feat(text): pdf extraction, normalization, line and column ordering with fixtures`.

---

### Task 7: Spoken-text builder, headers/footers/page numbers, de-hyphenation

**Files:**
- Create: `src/shared/text/spoken.ts`, `src/shared/text/filters.ts` (first part), `tests/unit/text/spoken.test.ts`, `tests/unit/text/headers.test.ts`

**Interfaces:**
- Produces (`spoken.ts`):
  ```ts
  export class SpokenText {
    appendLine(line: Line): void          // joins with ' ' or de-hyphenates against previous line
    hardBreak(): void                     // forces a sentence boundary (headings, paragraph gaps)
    remove(regex: RegExp): void           // deletes matches from the text; mapping stays consistent
    blocks(): { text: string; map: (start: number, end: number) => Span[] }[]  // split at hard breaks
  }
  ```
  Internally an ordered list of segments `{ text: string; src: Span | null }` (src = null for inserted spaces). `map` walks segments to convert a character range of the block's text into Spans, merging adjacent ranges of the same item.
- Produces (`filters.ts`): `dropHeadersFooters(pagesLines: Line[][], pageHeights: number[]): Line[][]`:
  - **Zones:** top 8% and bottom 8% of the page height.
  - **Key:** `text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()`.
  - A zone line is dropped if its key appears in the same zone on ≥ `min(3, ceil(0.5 × pageCount))` pages, or if it matches `/^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d{1,4})?$/i`.
- **De-hyphenation rule (in `appendLine`):** if the previous text ends with `/[A-Za-z]-$/` and the new line starts with `/^[a-z]/`, drop the hyphen and join with no space.
- **Hard-break rule (applied by the pipeline in Task 9):**
  - insert a hard break *before* a line whose `fontSize > 1.15 × body`, or that starts after a vertical gap > `1.4 × lineHeight`
  - insert a hard break *after* a line that doesn't end in `[.!?:;"”)]`, is shorter than 70% of the median line width, and is followed by such a gap
  - `body` = median fontSize of items weighted by `str.length`

- [ ] **Step 1: Write the failing tests:**

```ts
it('de-hyphenates across lines and maps back to both items', () => {
  const s = new SpokenText(); s.appendLine(line('keep atten-', 1, 0)); s.appendLine(line('tion here.', 1, 1))
  const [b] = s.blocks(); expect(b.text).toBe('keep attention here.')
  expect(b.map(5, 14).map(x => x.itemIndex)).toEqual([0, 1])
})
it('remove keeps mapping consistent', () => { /* remove /\(Smith, 2019\) ?/ then map('Then') points at the right item/offset */ })
it('drops running header and "Page N" footer on single-column.pdf', async () => {
  const text = spokenOf('single-column.pdf', { onlyHeadersFooters: true })
  expect(text).not.toMatch(/PSYC 201 — Week 4/); expect(text).not.toMatch(/Page \d/)
})
it('keeps a line that only repeats on 2 of 6 pages', /* key frequency below threshold */)
```

  The test helpers `line()` and `spokenOf()` live in `tests/unit/text/helpers.ts`. `spokenOf` runs extract → lines → the filters under test → SpokenText.
- [ ] **Step 2: Run** the tests. They should FAIL.
- [ ] **Step 3: Implement** `SpokenText` and `dropHeadersFooters`.
- [ ] **Step 4: Verify.** `npm test` should PASS.
- [ ] **Step 5: Commit.** `feat(text): spoken-text builder with span mapping, header/footer removal, de-hyphenation`.

---

### Task 8: Footnotes, captions/tables, cover pages, References cut-off

**Files:**
- Modify: `src/shared/text/filters.ts`
- Create: `tests/unit/text/filters.test.ts`

**Interfaces** (all pure, `Line[][]` in → `Line[][]` out unless noted; `body` = median fontSize from Task 7):
- `dropFootnotes(pages: Line[][], heights: number[], body: number): Line[][]`:
  - In the bottom 35% of a page, find the first line with `fontSize < 0.85 × body` that starts with a digit, `*`, `†` or a superscript digit `[¹²³⁴⁵⁶⁷⁸⁹⁰]`. Drop it and every line below it on that page.
  - Separately, drop inline marker items: `fontSize < 0.75 × body`, `str` matching `/^[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†]{1,3}$/`, and a baseline at least `0.2 × body` above the host line's baseline.
- `dropCaptionsAndTables(pages: Line[][], body: number): Line[][]`:
  - **Captions:** a line matching `/^(figure|fig\.|table|exhibit|chart)\s*\d+[.:]?/i` (after `normalizeText`) is dropped, together with following lines of the same fontSize (±0.5) until a gap > 1.5 × line height or a fontSize change.
  - **Tables:** a run of ≥ 3 consecutive lines where each line has ≥ 3 items separated by x-gaps > 2 × fontSize and every item has ≤ 4 words. The whole run is dropped.
- `coverPages(pages: Line[][]): number[]` returns the 1-based pages to skip. It only considers pages 1–3. A page is skipped if its text matches `/©|copyright|all rights reserved|isbn|course\s*pack|reproduced (with|by) permission/i`, or if it has < 60 words and ≤ 2 sentence-ending punctuation marks.
- `referencesStart(pages: Line[][], body: number): { page: number; lineIndex: number } | null` finds the first line that:
  - after trimming trailing dot leaders and page numbers (`.replace(/[.\s]*\d*$/, '')`), matches `/^(references|bibliography|works cited|reference list|notes|endnotes)$/i`;
  - **and** has `fontSize ≥ body`;
  - **and** is on a page with `(page - 1) / pageCount ≥ 0.6`;
  - **and** is not followed on the same line by a page number. That rules out table-of-contents entries.

- [ ] **Step 1: Write the failing tests** against the fixtures and their `.json` sidecars:

```ts
it('drops the footnote and its inline marker', /* single-column: no 'See Miller (1956)', no '¹' */)
it('drops figure caption and table text', /* captions-tables: no 'Figure 1', none of the table numbers */)
it('skips the copyright cover page', () => expect(coverPages(linesOf('cover-refs.pdf'))).toEqual([1]))
it('stops at the late References heading', () => expect(referencesStart(linesOf('cover-refs.pdf'), body)).toEqual({ page: 6, lineIndex: expect.any(Number) }))
it('ignores early references heading', /* the TOC 'References ........ 6' on p2 and the 'Notes' heading on p3 are not matches */)
```

- [ ] **Step 2: Run** the tests. They should FAIL.
- [ ] **Step 3: Implement** the four functions.
- [ ] **Step 4: Verify.** `npm test` should PASS.
- [ ] **Step 5: Commit.** `feat(text): footnote, caption/table, cover-page and References filters`.

---

### Task 9: Citations, sentences, pipeline, golden snapshots, CLI (spike M0c)

**Files:**
- Create: `src/shared/text/citations.ts`, `src/shared/text/sentences.ts`, `src/shared/text/pipeline.ts`, `scripts/spoken-text.ts`, `tests/unit/text/pipeline.test.ts`, `tests/unit/text/local-readings.test.ts`, `tests/fixtures/spoken/*.txt`
- Modify: `package.json` (script `spoken-text`: `tsx scripts/spoken-text.ts`)

**Interfaces:**
- Produces: `CITATION_PATTERNS: RegExp[]` and `removeCitations(s: SpokenText): void`, which applies, in order:
  1. parenthetical with an author and year: `/\s?\((?:[^()]*?(?:[A-Z][A-Za-z'’-]+(?:\s(?:&|and)\s[A-Z][A-Za-z'’-]+)?(?:\set al\.)?,?\s(?:19|20)\d{2}[a-z]?)[^()]*)\)/g`
  2. a narrative year right after a capitalised name: `/(?<=[A-Z][a-z'’-]+(?: et al\.)?)\s\((?:19|20)\d{2}[a-z]?(?:,\s*pp?\.\s*\d+(?:[–-]\d+)?)?\)/g`
  3. numeric brackets: `/\s?\[\d+(?:[–-]\d+)?(?:,\s*\d+(?:[–-]\d+)?)*\]/g`
- Produces: `segmentSentences(blockText: string): { start: number; end: number }[]`. It uses `Intl.Segmenter('en', { granularity: 'sentence' })`, then merges a segment into the next when the segment's last word (lowercased, trailing `.` kept) is in `['e.g.','i.e.','et al.','p.','pp.','fig.','vs.','dr.','mr.','ms.','mrs.','cf.','ca.','no.','vol.','ch.','ed.','eds.']`, or when the trimmed segment is < 3 chars. Whitespace-only segments are dropped.
- Produces: `buildSentences(pages: PageText[], filters: ReadingFilters = DEFAULT_FILTERS): { sentences: Sentence[]; textlessPages: number[] }`, which runs in this order:
  1. lines
  2. cover pages
  3. headers/footers
  4. footnotes
  5. captions/tables
  6. References cut-off (drop everything from the start)
  7. SpokenText with hard breaks
  8. citations (unless `readCitations`)
  9. sentences

  Each step runs only when its filter flag is on. Sentence `id`s are 0-based in reading order. `textlessPages` lists pages with zero items.
- Produces (CLI): `npm run spoken-text -- <file.pdf> [--everything]` prints one sentence per line, with `--- page N ---` markers taken from the first span of each sentence.

- [ ] **Step 1: Write the failing tests:**

```ts
for (const f of ['single-column','two-column','captions-tables','cover-refs','citations','ligatures','long-sentence'])
  it(`golden spoken text: ${f}`, async () => {
    const got = render(buildSentences(await extractPages(read(`${f}.pdf`))))   // one sentence per line + page markers
    expect(got).toBe(readFileSync(`tests/fixtures/spoken/${f}.txt`, 'utf8'))
  })
it('removes citations but keeps "(born 1990 in Leeds)"', /* citations.pdf */)
it('does not split on "e.g." or "et al."', /* sentence count from citations.pdf */)
it('Read everything keeps headers, footnotes, captions, references and citations', /* READ_EVERYTHING on cover-refs + citations */)
it('no-text pdf', async () => {
  const r = buildSentences(await extractPages(read('no-text.pdf')))
  expect(r.sentences).toEqual([]); expect(r.textlessPages).toEqual([1, 2])
})
it('every sentence maps to at least one span on a real item', /* all fixtures: spans non-empty, start<end<=item.str.length */)
```

  Golden files are written by hand from each fixture's `.json` sidecar. Never generate them from the implementation.
- [ ] **Step 2: Add the local-only test** `tests/unit/text/local-readings.test.ts`. For every `local-fixtures/*.pdf`, if a `local-fixtures/spoken/<name>.txt` exists it compares against it; otherwise it writes `local-fixtures/spoken/<name>.actual.txt` for Yasin to review. The whole suite uses `describe.skipIf(!existsSync('local-fixtures'))`, so CI skips it.
- [ ] **Step 3: Run** the tests. They should FAIL.
- [ ] **Step 4: Implement** citations, sentences, pipeline and the CLI.
- [ ] **Step 5: Verify.** `npm test` should PASS. Then run `npm run spoken-text -- local-fixtures/<her reading>.pdf` on each of her readings and read the output for missed headers, footnotes, captions or references. Save the problems you see as notes for Task 12.
- [ ] **Step 6: Commit.** `feat(text): citations, sentence segmentation, pipeline, golden snapshots and spoken-text CLI`.

---

### Task 10: Voice samples for picking voices (spike M0e)

**Files:**
- Create: `scripts/voice-samples.ts`
- Modify: `package.json` (script `voice-samples`)

**Interfaces:**
- Consumes: `extractPages`, `buildSentences` (Task 9), `splitForSpeech` (Task 4), the model layout (Task 2, run `npm run fetch-model -- --dtype all` first).
- Produces: `npm run voice-samples -- <pdf> [--page N]` writes `local-fixtures/voice-samples/<voice>-<dtype>.wav` (16-bit PCM, 24 kHz mono) for the voices `af_heart, af_bella, af_nicole, af_sarah, af_kore, bf_emma, bf_isabella, am_michael, am_fenrir, am_puck, bm_george, bm_fable` × dtypes `q8, fp32`. It also writes `local-fixtures/voice-samples/index.html`, a table with one `<audio controls>` per file grouped by voice, so q8 and fp32 sit side by side. The sample text is the first 3 sentences of page N (default: the first page with ≥ 3 sentences).

- [ ] **Step 1: Implement** the script (plain Node via `tsx`, with kokoro-js loaded as in the worker and `allowRemoteModels = false`). Write a small `writeWav(path, pcm: Float32Array, sampleRate)` helper inside the script.
- [ ] **Step 2: Verify.** Run it on one of her readings. Expect 24 WAV files plus `index.html`. Open `index.html` in a browser; every clip should play and contain the right text.
- [ ] **Step 3: Hand off for listening.** Ask Yasin to pick 6–8 voices and the default, and record the choice in `docs/spikes/m0-results.md` (Task 12).
- [ ] **Step 4: Commit** (the script only, since samples are git-ignored). `feat: voice sample renderer for choosing Tide's voices`.

---

### Task 11: Audiobook and MP3 export via ffmpeg (spike M0d)

**Files:**
- Create: `src/main/audio-export.ts`, `scripts/check-chapters.swift`, `tests/unit/audio-export.test.ts`
- Modify: `src/main/ipc.ts` (when `TIDE_E2E=1`, register `test:export-m4b`), `src/preload/index.ts` (`window.tideTest.exportM4b(outPath)`), `tests/e2e/smoke.spec.ts`, `.github/workflows/ci.yml`, `package.json` (dependency `ffmpeg-static`)

**Interfaces:**
- Produces:
  ```ts
  export interface Chapter { title: string; startSec: number }
  export interface AudioMeta { title: string; album: string; artist: string }
  export function ffmpegPath(): string                   // unpackedPath(require('ffmpeg-static'))
  export function ffmpegHasMp3(): Promise<boolean>       // `ffmpeg -hide_banner -encoders` contains 'libmp3lame'
  export function exportM4b(pcm: Float32Array, sampleRate: number, chapters: Chapter[], meta: AudioMeta, outPath: string, signal?: AbortSignal): Promise<void>
  export function exportMp3(pcm: Float32Array, sampleRate: number, meta: AudioMeta, outPath: string, signal?: AbortSignal): Promise<void>
  ```
- **The ffmpeg call:** convert Float32 to s16le and stream it on stdin. Write an FFMETADATA file to a temp dir with `[CHAPTER]` blocks (`TIMEBASE=1/1000`, `START`, `END` = the next chapter's start or the total duration, `title=`). Then run:
  `ffmpeg -y -f s16le -ar <sr> -ac 1 -i pipe:0 -i <meta.txt> -map 0:a -map_metadata 1 -map_chapters 1 -c:a aac -b:a 64k -movflags +faststart -f ipod <outPath>.part`
  then rename to `outPath`. MP3 uses `-c:a libmp3lame -b:a 96k -f mp3`. Abort or error kills ffmpeg, deletes the `.part` and rejects. `exportM4b` with `chapters=[]` writes a single chapter titled `meta.title`.

- [ ] **Step 1: Write the failing tests** (Node, real ffmpeg-static):

```ts
const sine = (sec: number) => Float32Array.from({ length: 24000 * sec }, (_, i) => 0.2 * Math.sin(i / 10))
it('writes an m4b whose chapters ffmpeg reads back', async () => {
  await exportM4b(sine(6), 24000, [{ title: 'Page 1', startSec: 0 }, { title: 'Page 2', startSec: 3 }], meta, out)
  const meta2 = execFileSync(ffmpegPath(), ['-i', out, '-f', 'ffmetadata', '-'], { encoding: 'utf8' })
  expect(meta2.match(/\[CHAPTER\]/g)).toHaveLength(2); expect(meta2).toContain('title=Page 2')
  expect(existsSync(out + '.part')).toBe(false)
})
it('abort deletes the .part and rejects', /* AbortController aborted after start → rejects, no out, no .part */)
it('exportMp3 works when libmp3lame is present', async () => { if (!(await ffmpegHasMp3())) return; /* writes, size > 0 */ })
it('zero chapters becomes one chapter named after the title', /* chapters [] → 1 [CHAPTER] with title=meta.title */)
```

- [ ] **Step 2: Run** the tests. They should FAIL.
- [ ] **Step 3: Implement** `audio-export.ts`.
- [ ] **Step 4: Write `scripts/check-chapters.swift`.** It loads `AVURLAsset(url:)`, calls `try await asset.loadChapterMetadataGroups(bestMatchingPreferredLanguages: ["en"])`, prints the group count and each group's title (common key `.commonKeyTitle`), and exits 1 if the count is not equal to `CommandLine.arguments[2]`.
- [ ] **Step 5: E2E plus CI wiring.** The e2e test calls `tideTest.exportM4b('<tmp>/smoke.m4b')`, which synthesizes 2 short sentences, makes 2 chapters and exports. CI's macOS job then runs `swift scripts/check-chapters.swift test-results/smoke.m4b 2` and writes the output to the summary. **This is the M0d gate: Apple's AVFoundation must see 2 chapters.** Both jobs also write `ffmpegHasMp3` to the summary.
- [ ] **Step 6: Verify.** `npm test` should PASS locally, the packaged e2e should PASS, and CI should be green with "2 chapters" in the macOS summary.
- [ ] **Step 7: Commit.** `feat: ffmpeg audiobook (m4b, chapters) and mp3 export with AVFoundation check in CI`.

---

### Task 12: Spike results and the go/no-go gate

**Files:**
- Create: `docs/spikes/m0-results.md`
- Modify (only if a result forces it): `docs/superpowers/specs/2026-11-16-tide-design.md`

- [ ] **Step 1: Write `docs/spikes/m0-results.md`** with one section per spike:
  - **M0a:** load time and RTF on the macOS and Windows runners, copied from CI summaries, with a pass/fail against "first audio < 2 s, RTF < 1".
  - **M0b:** the `codesign` and `spctl` outputs, plus a note that the real Open Anyway check stays at hand-off.
  - **M0c:** for each of her readings, the pages where junk leaked or content was wrongly skipped (from Task 9 Step 5), with the fix applied or the follow-up ticket.
  - **M0d:** the AVFoundation chapter count, `ffmpegHasMp3`, and the decision whether lamejs is dropped.
  - **M0e:** Yasin's chosen voices, the default, and whether q8 is good enough or fp32 is needed.
- [ ] **Step 2: Apply the gate.** If M0a RTF ≥ 1 on the macOS runner, or M0d shows < 2 chapters, **stop and raise it with Yasin** before planning M2+. Otherwise mark M0/M1 done and update PRD §12 with the voice choice and the lamejs decision.
- [ ] **Step 3: Commit.** `docs: record M0 spike results and decisions`.

---

## Next plans (not in scope here)

M2 Library · M3 Reader (pdf.js rendering, highlight overlay using `Sentence.spans`, resume anchor) · M4 Voice/player · M5 Save as audio UI · M6 Settings & themes (Sky & Sea, Deep Sea, Pixel Quest, Kitty) · M7 Ship. Each gets its own plan after this one lands, building on the interfaces above.
