# Tide M4 + M5: Voice and Save as audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After M4 she presses Play and Tide reads the reading aloud, sentence by sentence, with the highlight following the voice. She can skip ±15 s, change voice and speed (with an instant Listen preview), set a sleep timer, use media keys, and keep listening with the window hidden. At the end Tide offers the next reading. After M5 she can select text to "Read from here" or "Save as audio", and save a selection or a page range as an MP3, or a whole reading as an `.m4b` audiobook with page chapters, while she keeps listening.

**Architecture:** The TTS utilityProcess gets a v2 protocol: string generation ids, three priorities (live > preview > export), cancel, a timeout measured from job start, and the worker is recycled when it hangs. A pure, DOM-free `PlayerEngine` in the renderer owns playback: it requests sentence *n*, prefetches *n+1…n+3*, wraps the PCM as WAV blob URLs and plays them through one `<audio>` element (behind an `AudioSink` interface, so it is unit-tested with fakes). React binds the engine to the existing `ReaderState.current`, so M3's highlight follows the voice. For M5, pdf.js text layers make the pages selectable. A pure mapper snaps a DOM selection to whole sentences. Main runs export jobs: it synthesises at export priority and streams PCM into the bundled ffmpeg (MP3 in one pass; `.m4b` in two passes: AAC first, then a chapter remux). It writes `.part`, then renames.

**Tech Stack:** Electron 45 (utilityProcess, powerSaveBlocker, shell), React 19 + TS strict, Tailwind 4 tokens, Radix (Dialog, DropdownMenu, plus Popover, new), pdfjs-dist 6.5.438 (`TextLayer`), kokoro-js 1.2.1 + onnxruntime-node (fp32), ffmpeg-static 5.3.0, Vitest + Testing Library, Playwright `_electron`.

**Spec:** [`docs/superpowers/specs/2026-11-16-tide-design.md`](../specs/2026-11-16-tide-design.md). Read §5 (simplicity rules, keyboard), §5.1 screens 1 and 4–7, §5.3 states, §6.2, §6.4, §6.5, §6.7, §12 ("Decided by Yasin for M4"). Mockups: [`docs/design/screens-sky-sea.html`](../../design/screens-sky-sea.html) (screens 1, 4–7). Previous plan, whose interfaces this one builds on: [`2026-11-17-tide-m2-m3-library-reader.md`](2026-11-17-tide-m2-m3-library-reader.md). Deferred items: [`docs/superpowers/decisions/2026-11-18-m2-m3-rulings.md`](../decisions/2026-11-18-m2-m3-rulings.md) and [`docs/spikes/m0-results.md`](../../spikes/m0-results.md) "Follow-ups".

**Branch:** `feat/m4-m5-voice-save-audio`, cut from `fix/e2e-cold-launch-pin`, or from `main` once that fix is merged. **STOP after Task 10** (end of M4): Yasin installs the build and listens before M5 starts.

## Global Constraints

- **Exactly five player controls**, each labelled in words (no icon-only buttons): **Back 15s**, **Play / Pause**, **Forward 15s**, **voice & speed** (shows e.g. `Emma · 1×`), **Sleep** (shows `Sleep 19:42` while a timer runs). Status lines, the Finished offer and toasts are not controls.
- **No autoplay on open.** The only automatic starts: "Play next" from the Finished offer, and "Read from here".
- Keys (Windows uses Ctrl for ⌘): **Space** play/pause, **← / →** back/forward 15 s. Arrows and Space are ignored while a dialog, menu, popover or text field has focus, or with any modifier held.
- Speeds are exactly **0.8×, 1×, 1.25×, 1.5×, 2×**, through Kokoro's native `speed` parameter.
- Voices are exactly these 10, in this order: **af_kore, af_nicole, af_sarah, am_fenrir, am_michael, am_puck, bf_emma, bf_isabella, bm_fable, bm_george**. The default is **bf_emma**. Every other voice `.bin` is pruned from the installer.
- Model precision is **fp32** on both OSes (`onnx/model.onnx`). The q8 file no longer ships.
- Copy fixed by the spec (verbatim): "Getting the voice ready…"; "The voice stopped unexpectedly. Restarting…"; "Restart Tide"; "Finished ✓ · Next: <title>"; "Select any text to read from there or save it as audio."; "Whole readings save as an audiobook. Open it in Books on your iPhone and it remembers your place."; "Save as MP3 instead"; "Audio not saved."; "Couldn't save the audio: <reason>."; "Show in Finder" (macOS) / "Show in folder" (Windows); "Making your audio…"; "You can keep reading while this finishes."
- Prefetch window: **3** sentences after the current one. The engine never holds more than 4 sentences of audio, and every blob URL is revoked once played or discarded.
- Auto-scroll is suppressed for **5 s** after she scrolls the page herself.
- Position writes: main keeps its 3 s throttle. Pause and the sleep-timer stop also call `library.flush()`; quit already flushes.
- Sleep timer: Off / 10 / 20 / 30 / 45 min / End of this page / End of this reading. It counts down only while playing. It fades out over the last **5 s**, then pauses, restores the volume and flushes the position.
- Export: MP3 is mono 24 kHz at **64 kbps** (libmp3lame). `.m4b` is AAC-LC mono **64 kbps** with one chapter per page that has spoken text, titled `Page N`. The default folder is `<app.getPath('music')>/Tide`, created if missing. A name collision becomes `name (2).ext`, then ` (3)`, and so on. Tags: title = reading title + range, album = course name (or `Tide` when there is none), artist = `Tide · <voice name>`.
- **The renderer never sends a file path to main**; "Show in folder" and "Choose another folder" go through job ids and main's own dialog. The test-only `TIDE_MUSIC_DIR` override is honoured only when `TIDE_E2E=1`.
- CSP becomes exactly `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:` (WAV blob URLs and bundled previews).
- No network at runtime: `TIDE_OFFLINE_GUARD=1` e2e runs must stay green.
- Copyright: nothing from `local-fixtures/` reaches code, tests, previews, logs or commits. Test text and the preview sentence are invented. Local-reading checks report aggregate numbers by index only.
- CI runners have no sound device. Tests assert `<audio>` events and state, engine state and TTS metrics, never sound.
- New dependencies are exact-pinned (`@radix-ui/react-popover`: the newest version compatible with the installed Radix packages). Installs need `NODE_EXTRA_CA_CERTS=D:/pdf-narrator/.superpowers/roots.pem`. `unset ELECTRON_RUN_AS_NODE` before any npm, vitest, electron or playwright command.
- Commit trailer names the model that actually wrote the commit: `Co-Authored-By: Claude <Model> <noreply@anthropic.com>` (e.g. `Claude Sonnet 5.5`).

## Review Focus

1. **A very long sentence on a slow CPU** (a 1,500-character run-on from a table or reference list, Windows laptop) must not hit the job timeout and recycle the worker in a loop. The timeout grows with the text. *(Task 1 test `job timeout grows with text length and is measured from job start`.)*
2. **Mashing → or switching voice or speed rapidly while audio is synthesising** must never play stale audio (an old voice, or a sentence she skipped past) and must not leak blob URLs. *(Task 4 test `late audio from a superseded generation is dropped and its URL revoked`.)*
3. **Clicking another reading on the shelf mid-sentence** stops the old audio at once, saves the old reading's place, and never autoplays the new one. *(Task 6 test `switching readings while playing stops audio, flushes the old place and does not autoplay`.)*
4. **Course or title with characters Windows forbids in file names** (`PSYC 201: Intro/Basics?`) must save under a cleaned name, not fail. *(Task 13 test `safeFileName replaces characters illegal on Windows or macOS and trims dots and spaces`.)*
5. **A selection that covers only skipped text** (a running header, a References page, a caption) must not offer a bubble that saves or reads nothing. *(Task 11 test `a selection inside skipped text maps to no sentences`; Task 12 test `no bubble for a selection with no spoken sentences`.)*

---

## File Structure

```
src/shared/voices.ts                   VOICES (id, name, description), DEFAULT_VOICE, SPEEDS, PREVIEW_SENTENCE, voiceName
src/shared/ipc-types.ts                + TtsStatus, LiveSynthesizeOptions, Export* types
src/tts/protocol.ts                    v2: gen, priority, cancel, started, cancelled
src/tts/queue.ts                       JobQueue: priority + FIFO, cancel by gen (pure)
src/tts/worker.ts                      uses JobQueue, cancellation between chunks, warm-up after load
src/main/tts-host.ts                   started-based timeout, recycle on hang, status events, crash policy
src/main/ipc.ts                        tts:synthesize/cancel/status, app:playing, app:relaunch
src/main/playing.ts                    PlayingBlocker (powerSaveBlocker while playing)
src/main/library/{schema,library,ipc}.ts  settings.voice/speed, ui.tipsSeen, flush IPC, coalesced position broadcasts
src/main/export/files.ts               exportDir, safeFileName, uniquePath, failureReason
src/main/export/writers.ts             streaming MP3 writer, two-pass M4B writer (on top of audio-export.ts)
src/main/export/job.ts                 runExport: synthesize at export priority, chapters, progress, cancel
src/main/export/ipc.ts                 export:start/cancel/reveal + progress/finished events
src/main/audio-export.ts               refactored to share the writers; test hook kept
src/preload/index.ts, index.d.ts       tts, app, library and export bridges
src/renderer/index.html                CSP media-src
src/renderer/public/voice-previews/    <voiceId>.mp3 ×10 (rendered by scripts/voice-previews.ts, committed)
src/renderer/src/player/wav.ts         pcmToWav (pure)
src/renderer/src/player/timeline.ts    Timeline: estimates, measured durations, skip targets, time left (pure)
src/renderer/src/player/clips.ts       firstClips: short first clip after play/seek (pure)
src/renderer/src/player/engine.ts      PlayerEngine + AudioSink/TtsClient interfaces
src/renderer/src/player/sink.ts        HtmlAudioSink (the one <audio> element)
src/renderer/src/player/sleep.ts       SleepTimer (pure, injected clock)
src/renderer/src/player/media-session.ts  bindMediaSession
src/renderer/src/player/PlayerContext.tsx PlayerProvider/usePlayer: engine ↔ ReaderState, keys, saves, finished
src/renderer/src/player/PlayerBar.tsx  five controls, label, time left, status line, Finished offer
src/renderer/src/player/VoicePopover.tsx  voices with Listen, speed steps
src/renderer/src/player/SleepPopover.tsx
src/renderer/src/shell/Toast.tsx       toast host (crash, export)
src/renderer/src/reader/{ReaderView,PdfPage,pdf}.tsx|ts  memo, hands-off scroll, text layer, selection
src/renderer/src/reader/selection-dom.ts  DOM selection → Points
src/shared/text/selection.ts           selectionSentences (pure)
src/renderer/src/reader/SelectionBubble.tsx, SelectTip.tsx
src/renderer/src/save/SavePanel.tsx, ExportProgress.tsx, useExport.ts, names.ts
scripts/voice-previews.ts              renders the 10 previews (fp32, invented sentence)
electron-builder.yml                   fp32 model, voice pruning
.github/workflows/ci.yml               installer baseline for fp32
```

---

## M4: Voice

### Task 1: TTS protocol v2: generations, priorities, cancel, timeout from start, recycle on hang

**Files:**
- Create: `src/tts/queue.ts`, `tests/unit/tts-queue.test.ts`, `src/shared/voices.ts` (content defined in Task 2)
- Modify: `src/tts/protocol.ts`, `src/tts/worker.ts`, `src/main/tts-host.ts`, `src/shared/ipc-types.ts`
- Test: `tests/unit/tts-host.test.ts` (extend; it already uses a fake `TtsChild`)

**Interfaces:**
- Produces (`protocol.ts`):
  ```ts
  export type Priority = 'live' | 'preview' | 'export'
  export type TtsRequest =
    | { id: number; type: 'load'; modelDir: string; dtype: 'q8' | 'fp32'; warmVoice: VoiceId }
    | { id: number; type: 'synthesize'; text: string; voice: VoiceId; speed: number; priority: Priority; gen: string }
    | { id: number; type: 'cancel'; gen: string }
  export type TtsResponse =
    | { id: number; type: 'loaded'; loadMs: number; warmMs: number }
    | { id: number; type: 'started' }
    | { id: number; type: 'audio'; pcm: Float32Array; sampleRate: 24000; synthMs: number; chunks: number }
    | { id: number; type: 'cancelled' }
    | { id: number; type: 'error'; message: string }
  ```
- Produces (`queue.ts`): `class JobQueue<T extends { priority: Priority; gen: string }> { push(job: T): void; next(): T | undefined; cancel(gen: string): T[] /* removed jobs */; get size(): number }`. Order: live, then preview, then export; FIFO within a priority.
- Produces (`ipc-types.ts`): `type TtsStatus = 'loading' | 'ready' | 'restarting' | 'failed'`.
- Produces (`TtsHost`): `synthesize(text, { voice, speed, priority = 'live', gen = 'default' }): Promise<TtsAudio>` (a cancelled job rejects with an `Error` whose `name === 'AbortError'`); `cancel(gen: string): void`; `status(): TtsStatus`; `onStatus(cb: (s: TtsStatus) => void): () => void`; `jobTimeoutMs(text: string): number` exported as a pure function: `30_000 + 150 * text.length`.

- [ ] **Step 1: Write the failing tests.** In `tests/unit/tts-queue.test.ts`: `orders live before preview before export, FIFO within a priority`; `cancel(gen) removes only that generation's queued jobs and returns them`. In `tests/unit/tts-host.test.ts` (fake child, fake timers):
  - `job timeout grows with text length and is measured from job start`: a job queued behind another for 100 s does not time out. After `started`, it times out at `jobTimeoutMs(text)` exactly (check that `jobTimeoutMs('x'.repeat(1500)) === 255_000`).
  - `a job that hangs after started kills and respawns the worker, rejects pending jobs and reports restarting then ready`: statuses seen are `['restarting', 'loading', 'ready']`, and `fork` is called twice.
  - `two failures in a row report failed and stop restarting`: the second hang or crash before any successful synthesis gives `failed`, with no third fork. A later `synthesize` rejects with `voice engine stopped`.
  - `a successful synthesis after a restart resets the failure count`.
  - `cancel(gen) posts a cancel and the pending job rejects with AbortError when the worker replies cancelled`.
  - `an unexpected exit restarts the worker once, like a hang`.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/unit/tts-queue.test.ts tests/unit/tts-host.test.ts`. Expected: FAIL (no `queue.ts`; host has no `cancel`/`onStatus`).

- [ ] **Step 3: Implement `JobQueue`, then the worker.** The worker replaces its promise chain with a `JobQueue` and runs one job at a time. It posts `started` when a job begins. Between chunks it checks a `cancelledGens: Set<string>`; a cancelled job replies `cancelled`. A `cancel` message is handled immediately (outside the queue): it removes that gen's queued jobs (each replies `cancelled`) and adds the gen to the set. After `from_pretrained`, `load` synthesises `'Ready.'` once with `warmVoice` (discarding the audio) and reports `warmMs`.

- [ ] **Step 4: Implement the host changes.** The per-request timer starts on `started`, not on post; the load timeout stays at 30 s from post. On a job timeout or an unexpected exit: if this is the 1st consecutive failure, emit `restarting`, `dispose` the child (rejecting everything pending with `voice engine stopped`), then `start()` again. If it is the 2nd, emit `failed` and do not restart. `start()` emits `loading`, then `ready`. Statuses are de-duplicated (no repeat emits). The default dtype becomes `'fp32'`, and `warmVoice` is `DEFAULT_VOICE`. Create `src/shared/voices.ts` here, exactly as Task 2's Interfaces block gives it; its tests and the packaging changes stay in Task 2.

- [ ] **Step 5: Run the tests and the existing suites.** `npx vitest run tests/unit` → PASS. `npm run typecheck` → no errors.

- [ ] **Step 6: Commit.** `feat(tts): v2 protocol with generations, priorities, cancel, start-based timeout and worker recycling`.

### Task 2: Voices, fp32, bundled previews, pruning and CSP

**Files:**
- Create: `scripts/voice-previews.ts`, `src/renderer/public/voice-previews/*.mp3`, `tests/unit/voices.test.ts`
- Modify: `electron-builder.yml`, `scripts/fetch-model.mjs` (default `--dtype fp32`), `tests/unit/fetch-model.test.ts` (if it pins the default), `src/main/ipc.ts`, `src/renderer/index.html`, `tests/e2e/smoke.spec.ts`, `package.json` (script `voice-previews:render`)

**Interfaces:**
- Produces:
  ```ts
  export interface Voice { id: string; name: string; description: string }
  export const VOICES: readonly Voice[]       // the 10, in the Global Constraints order
  export const VOICE_IDS: ReadonlySet<string>
  export const DEFAULT_VOICE = 'bf_emma'
  export const SPEEDS = [0.8, 1, 1.25, 1.5, 2] as const
  export const PREVIEW_SENTENCE = 'Hello! I can read your notes aloud, one calm sentence at a time.'
  export function voiceName(id: string): string   // unknown id → the default voice's name
  export function speedLabel(s: number): string   // 1 → '1×', 1.25 → '1.25×', 0.8 → '0.8×'
  ```
  Proposed names and descriptions (Yasin reviews them in the plan review): Kore "Clear, steady"; Nicole "Soft, hushed"; Sarah "Bright, friendly"; Fenrir "Deep, strong"; Michael "Deep, relaxed"; Puck "Lively, upbeat"; Emma "Calm, British"; Isabella "Warm, British"; Fable "Storyteller, British"; George "Steady, British".

- [ ] **Step 1: Write the failing tests** in `tests/unit/voices.test.ts`:
  - `VOICES lists exactly the ten chosen ids in order and DEFAULT_VOICE is bf_emma`.
  - `every voice has a bundled preview`: each `src/renderer/public/voice-previews/<id>.mp3` exists and is > 5 KB.
  - `electron-builder prunes every voice that is not in VOICES`: parse `electron-builder.yml` (as text). The `!node_modules/kokoro-js/voices/!(…).bin` pattern names exactly the `VOICE_IDS`.
  - `electron-builder ships the fp32 model and not q8`: the extraResources filter contains `**/onnx/model.onnx` and not `model_quantized`.
  - `tts:synthesize rejects a voice outside VOICES` (in `tests/unit/ipc.test.ts`).

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/unit/voices.test.ts tests/unit/ipc.test.ts` → FAIL.

- [ ] **Step 3: Implement the packaging config** (`voices.ts` already exists from Task 1). Add the pruning pattern under `files`. Switch the extraResources filter to `**/onnx/model.onnx`. Make `fetch-model.mjs` default to `fp32`. Have `tts:synthesize` validate `voice ∈ VOICE_IDS`, `priority ∈ {'live','preview'}` (export never comes from the renderer) and `gen` as a string of at most 64 characters. Add `tts:cancel(gen)`. Add `media-src 'self' blob:` to the CSP. Replace `af_heart` with `DEFAULT_VOICE` in `smoke.spec.ts` and `exportTwoPageM4b`.

- [ ] **Step 4: Render the previews.** `scripts/voice-previews.ts` follows `voice-samples.ts` (blockNetwork, configureOffline, fp32, `speechChunks`). It renders `PREVIEW_SENTENCE` at speed 1 for each voice in `VOICES` and encodes each one with the bundled ffmpeg to `src/renderer/public/voice-previews/<id>.mp3` (mono, 64 kbps). Run `npm run fetch-model && npm run voice-previews:render`, then commit the 10 files (an invented sentence, so committing them is allowed).

- [ ] **Step 5: Verify.** `npx vitest run` → PASS. `npm run build && npx playwright test tests/e2e/smoke.spec.ts` → PASS. Log `loadMs`, `warmMs` and warm `synthMs` from the smoke test into the task report (fp32 numbers on this machine).

- [ ] **Step 6: Commit.** `feat(voice): ten curated voices, fp32 model, bundled previews, pruned voice files, media CSP`.

### Task 3: Player maths: WAV, timeline, short first clip

**Files:**
- Create: `src/renderer/src/player/{wav,timeline,clips}.ts`, `tests/unit/player/{wav,timeline,clips}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // wav.ts
  export function pcmToWav(pcm: Float32Array, sampleRate: number): ArrayBuffer  // 16-bit PCM mono, 44-byte header
  // timeline.ts
  export function estimateSec(text: string, speed: number): number  // text.length / (14.5 * speed) + 0.25
  export class Timeline {
    constructor(texts: string[])
    record(i: number, seconds: number, speed: number): void   // stored speed-normalised (seconds * speed)
    durationOf(i: number, speed: number): number              // measured / speed, else estimateSec
    skipTarget(current: number, offsetSec: number, deltaSec: number, speed: number): number
    secondsLeft(current: number, offsetSec: number, speed: number): number
  }
  export function timeLeftLabel(sec: number): string  // '< 60' → 'Less than a minute left'; else 'About N min left' (rounded, min 1)
  // clips.ts
  export function firstClips(text: string): string[]
  ```
  `skipTarget`: t = start(current) + offsetSec + deltaSec, clamped to [0, end of the last sentence). It returns the index of the sentence containing t. Going forward, a target inside the current sentence moves to `current + 1` (so → always advances; the last sentence stays last). Going back, when `offsetSec > 3` and the target is inside the current sentence, it returns `current`, which restarts the sentence.
  `firstClips`: splits once at the first `, ; : —` that has ≥ 4 words before it and ≥ 3 words after it, within the first 160 characters. Otherwise it returns `[text]`. The pieces rejoin exactly to `text`.

- [ ] **Step 1: Write the failing tests:** `pcmToWav writes a valid RIFF header and clamps samples`; `estimateSec scales inversely with speed`; `measured durations replace estimates and are speed-normalised`; `forward 15 s lands on the sentence containing the target and always advances at least one`; `back 15 s from 2 s into a sentence goes to the sentence containing the target`; `back 15 s from 5 s into a long sentence restarts it`; `skipTarget clamps at the first and last sentence`; `secondsLeft sums the rest of the reading`; `timeLeftLabel wording`; `firstClips splits at the first clause boundary and rejoins exactly`; `firstClips keeps short or unpunctuated sentences whole`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/player` → FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `feat(player): WAV wrapping, sentence timeline with ±15 s targets, short first clip`.

### Task 4: PlayerEngine

**Files:**
- Create: `src/renderer/src/player/engine.ts`, `src/renderer/src/player/sink.ts`, `tests/unit/player/engine.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Timeline`, `firstClips`, `pcmToWav`); `TtsStatus` and `TtsAudio`.
- Produces:
  ```ts
  export interface AudioSink {
    setSource(url: string): void
    play(): Promise<void>
    pause(): void
    readonly currentTime: number   // seconds into the current clip
    volume: number                 // 0..1
    onEnded(cb: () => void): void
    onError(cb: () => void): void
  }
  export interface TtsClient {
    synthesize(text: string, o: { voice: string; speed: number; priority: 'live'; gen: string }): Promise<TtsAudio>
    cancel(gen: string): void
    status(): Promise<TtsStatus>
    onStatus(cb: (s: TtsStatus) => void): () => void
  }
  export type PlayerPhase = 'idle' | 'loading-voice' | 'buffering' | 'playing' | 'paused' | 'finished' | 'error'
  export interface PlayerSnapshot { phase: PlayerPhase; index: number | null; voice: string; speed: number; secondsLeft: number | null }
  export interface EngineDeps { sink: AudioSink; tts: TtsClient; makeUrl(wav: ArrayBuffer): string; revokeUrl(url: string): void }
  export class PlayerEngine {
    constructor(deps: EngineDeps, voice: string, speed: number)
    setSentences(texts: string[], index: number | null): void   // a new or rebuilt list: stop, drop all audio, new generation
    setIndex(i: number): void      // a seek; keeps playing if playing
    play(): void; pause(): void; toggle(): void
    skip(deltaSec: number): void
    setVoice(id: string): void; setSpeed(s: number): void
    offsetSec(): number
    readonly timeline: Timeline
    subscribe(cb: (s: PlayerSnapshot) => void): () => void
    dispose(): void
  }
  // sink.ts
  export class HtmlAudioSink implements AudioSink { constructor(el: HTMLAudioElement) }
  ```
  Behaviour: generation ids are `live-<counter>`. Any seek, list change, voice or speed change starts a new generation: it cancels the old one through `tts.cancel`, revokes every held URL and re-requests from the current index. The first sentence after play or seek is requested as `firstClips(text)` pieces, later ones whole. The engine keeps current + 3 ahead requested. When a sentence's audio arrives, `timeline.record` stores its real duration (`pcm.length / 24000`). When the current clip ends: play the next ready clip, else enter `buffering`. When the last sentence ends: `finished`. Before the first audio arrives: `loading-voice` while `tts.status()` is `loading` or `restarting`, else `buffering`. If a synthesis fails with a status other than `restarting`, the phase is `error`; when the status returns to `ready` after `restarting`, the engine re-requests from the current index and resumes if it was playing. `play()` while `finished` starts again from sentence 0.

- [ ] **Step 1: Write the failing tests** (fake sink, fake TTS with controllable promises):
  - `play requests the current sentence and the next three, and plays the first clip when it arrives`.
  - `the first sentence after play is requested as its first clips; later sentences whole`.
  - `ended advances to the next sentence, reports its index and keeps the window at three ahead`.
  - `waiting for audio shows buffering; before the voice is ready it shows loading-voice`.
  - `late audio from a superseded generation is dropped and its URL revoked` (seek twice quickly, then resolve the first generation's promises).
  - `changing speed or voice cancels the old generation and re-synthesises from the current sentence`.
  - `skip uses the timeline target and keeps playing`.
  - `the last sentence ending gives finished; play from finished restarts at 0`.
  - `every URL made is revoked after it plays or is discarded` (count make/revoke at dispose).
  - `a restart of the voice engine resumes the current sentence when ready`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/player/engine.test.ts` → FAIL.
- [ ] **Step 3: Implement** `PlayerEngine` and `HtmlAudioSink`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `feat(player): PlayerEngine with prefetch, generations and gap-free sentence playback`.

### Task 5: Main and preload: voice settings, flush, coalesced broadcasts, playing blocker, status, relaunch

**Files:**
- Create: `src/main/playing.ts`, `tests/unit/playing.test.ts`
- Modify: `src/shared/library/types.ts`, `src/main/library/{schema,library,ipc}.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`
- Test: `tests/unit/library/{library,ipc,store}.test.ts`, `tests/unit/ipc.test.ts`

**Interfaces:**
- Produces: `LibrarySettings` gains `voice: string` (default `DEFAULT_VOICE`; an unknown id parses to the default) and `speed: number` (one of `SPEEDS`, else 1). `LibraryUi` gains `tipsSeen: string[]` (default `[]`). `schemaVersion` stays 1 (the fields are additive, with defaults).
- Produces (`window.tide`):
  ```ts
  tts: {
    synthesize(text: string, o: { voice: string; speed: number; priority?: 'live' | 'preview'; gen?: string }): Promise<TtsAudio>
    cancel(gen: string): Promise<void>
    status(): Promise<TtsStatus>
    onStatus(cb: (s: TtsStatus) => void): () => void
  }
  app: { setPlaying(on: boolean): void; relaunch(): void }
  library: { …existing, setVoice(voice: string, speed: number): Promise<void>; flush(): Promise<void>; tipSeen(key: string): Promise<void> }
  ```
- Produces (`playing.ts`): `class PlayingBlocker { constructor(b: { start(type: 'prevent-app-suspension'): number; stop(id: number): void; isStarted(id: number): boolean }); set(on: boolean): void; dispose(): void }`.

- [ ] **Step 1: Write the failing tests:**
  - `PlayingBlocker starts once while playing and stops on pause and dispose`.
  - `settings.voice and speed default, validate and persist`; `tipsSeen defaults to empty and records a key once`.
  - `library:voice rejects an unknown voice or a speed outside SPEEDS`.
  - `position-only updates are broadcast at most once every 3 s, trailing; other changes are broadcast at once and carry the latest position` (fake timers).
  - `library:flush resolves after the store flush`.
  - `tts status changes are forwarded to the window on tts:status`.
- [ ] **Step 2: Run** `npx vitest run tests/unit` → FAIL.
- [ ] **Step 3: Implement.** `app:playing` drives one `PlayingBlocker` created in `index.ts`. `app:relaunch` calls `app.relaunch()` and then `app.quit()`, so the quit flush runs. Status is pushed through the same window send used for `library:changed`. Position-only coalescing lives in `registerLibraryIpc`'s `onChange` forwarding: a change whose only difference is a `position` field is scheduled; anything else flushes the schedule and sends now.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat(main): voice settings, flush and tip IPC, coalesced position broadcasts, playing power blocker, voice status`.

### Task 6: Player bar, PlayerProvider, keys, hands-off scroll, PdfPage memo

**Files:**
- Create: `src/renderer/src/player/PlayerContext.tsx`, `src/renderer/src/player/PlayerBar.tsx`, `src/renderer/src/shell/Toast.tsx`, `tests/renderer/player.test.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/reader/PdfPage.tsx`, `src/renderer/src/assets/main.css`, `tests/renderer/setup.ts` (fakeTide gains `tts`, `app` and the new library calls)
- Delete: `src/renderer/src/shell/PlayerBarPlaceholder.tsx` (and update `tests/renderer/app-shell.test.tsx`)

**Interfaces:**
- Consumes: Tasks 3–5; `useReaderState()` (`sentences`, `current`, `setCurrent`, `page`, `numPages`).
- Produces:
  ```ts
  export function PlayerProvider(props: { reading: ReadingView | null; courseName: string | null; snapshot: LibrarySnapshot | null; onPlayNext(id: ReadingId): void; children: ReactNode }): JSX.Element
  export function usePlayer(): {
    snapshot: PlayerSnapshot
    play(): void; pause(): void; toggle(): void; skip(deltaSec: number): void
    readFrom(index: number): void          // M5 "Read from here": seek + play
    setVoice(id: string): void; setSpeed(s: number): void
    preview(id: string): void              // Task 7
    sleep: SleepState; setSleep(o: SleepOption): void   // Task 8
    finished: { next: ReadingView | null } | null       // Task 9
    estimateSec(fromIndex: number, toIndex: number): number   // M5 Save panel
  }
  export const HANDS_OFF_MS = 5000
  ```
  `PlayerProvider` sits inside `ReaderStateProvider` and wraps `AppShell` in `App.tsx`; `player={<PlayerBar />}`. It creates one engine with an `HtmlAudioSink` over a hidden `<audio>` it renders, and binds it in both directions: engine index → `setCurrent`; a user `setCurrent` (click) → `engine.setIndex`, guarded against echo. `reading.id` changes → `setSentences([], null)`, then the new list. Pause or reading change → `tide().library.flush()`. Phase `playing` ↔ `tide().app.setPlaying`. Voice or speed changes persist through `library.setVoice`.
  Bar layout (mockup screen 1): Back 15s · Play/Pause (primary pill, icon plus the word) · Forward 15s · wave with the label row `Page n of N` on the left and `About N min left` on the right · voice & speed (`Emma · 1×`) · Sleep. Under `loading-voice` the play button shows a soft spinner, and "Getting the voice ready…" replaces the left label. Under `buffering` the play button pulses (no animation under `prefers-reduced-motion`). Under `error` the status line reads "The voice isn't working right now." The voice & speed and Sleep buttons are placeholders until Tasks 7 and 8 (they render and are disabled). Until a reading with sentences is open, the controls render disabled.
  Keys: move M3's ←/→ handler out of `ReaderView` into `PlayerProvider`, with the same guards. ← / → call `skip(∓15)`. Space calls `toggle()`, except when focus is on a button, link or field (their own Space handles it).
  ReaderView: a `userScrollAt` ref is set on `wheel`, `touchmove`, scroll keys (PageUp, PageDown, Home, End, ArrowUp, ArrowDown) and pointer-down on the scrollbar (target === scroller). The highlight effect skips its scroll when `!force && Date.now() - userScrollAt < HANDS_OFF_MS`. `PdfPage` is wrapped in `memo`; `onPick` and `onSettled` are stable (`useCallback` over refs), and `highlight` is a memoised per-page value, so stepping re-renders only the old and new highlighted pages.

- [ ] **Step 1: Write the failing tests** in `tests/renderer/player.test.tsx` (fake sink injected through a `PlayerDeps` context, or by `HTMLMediaElement` stubs; fake tts):
  - `shows exactly five controls, all with visible words` (Back 15s, Play, Forward 15s, the voice label, Sleep).
  - `opening a reading does not start playback`.
  - `Play speaks from the current sentence and the highlight follows the engine`.
  - `Space toggles play and pause; arrows skip 15 s; both ignored inside a dialog or field`.
  - `clicking a sentence while playing continues from that sentence`.
  - `pause flushes the position`.
  - `switching readings while playing stops audio, flushes the old place and does not autoplay`.
  - `shows Getting the voice ready… while the voice loads`.
  - `does not auto-scroll within 5 s of her own scroll, and does again after` (fake timers; spy on `scrollIntoView`).
  - `stepping one sentence re-renders only the pages whose highlight changed` (a render counter in a mocked `PdfPage` module, or React Profiler).
  Update `tests/renderer/highlight-resume.test.tsx`, whose arrow-key tests now expect ±15 s through the player.
- [ ] **Step 2: Run** `npx vitest run tests/renderer` → FAIL.
- [ ] **Step 3: Implement** the provider, bar, Toast host (`useToast(): { show(t: { text: string; actions?: { label: string; onClick(): void }[]; ms?: number }): void }`, bottom-centre above the player, as in the mockup), the ReaderView changes and the `PdfPage` memo.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5: Commit.** `feat(player): player bar with five controls, playback bound to the highlight, ±15 s keys, hands-off scroll, memoised pages`.

### Task 7: Voice & speed popover with instant previews

**Files:**
- Create: `src/renderer/src/player/VoicePopover.tsx`, `tests/renderer/voice-popover.test.tsx`
- Modify: `package.json` (add `@radix-ui/react-popover`, exact pin), `src/renderer/src/player/PlayerBar.tsx`, `src/renderer/src/player/PlayerContext.tsx`

**Interfaces:**
- Consumes: `VOICES`, `SPEEDS`, `speedLabel`, `voiceName`; `usePlayer().setVoice/setSpeed/preview`.
- Produces: `preview(id)` pauses the main reading if it is playing (and leaves it paused, per §5.3). It plays `./voice-previews/<id>.mp3` through a second, preview-only `Audio` element; a new preview stops the previous one.
  Popover content (mockup screen 6): heading "Choose a voice"; one row per voice: name, description (`· default` appended for bf_emma), the row selects the voice (`aria-pressed`), and a **Listen** button. Then "Speed": a five-step segmented control (`role="radiogroup"`, steps labelled `0.8×`…`2×`).

- [ ] **Step 1: Write the failing tests:** `lists the ten voices with names, descriptions and a Listen button each`; `choosing a voice and a speed updates the player label and persists`; `Listen pauses the reading and plays the bundled preview`; `the reading stays paused after a preview`; `Listen on a second voice stops the first preview`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/renderer` → PASS.
- [ ] **Step 5: Commit.** `feat(player): voice and speed popover with instant bundled previews`.

### Task 8: Sleep timer

**Files:**
- Create: `src/renderer/src/player/sleep.ts`, `src/renderer/src/player/SleepPopover.tsx`, `tests/unit/player/sleep.test.ts`, `tests/renderer/sleep.test.tsx`
- Modify: `PlayerContext.tsx`, `PlayerBar.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type SleepOption = 'off' | 10 | 20 | 30 | 45 | 'page' | 'reading'
  export type SleepState = { option: SleepOption; remainingSec: number | null }   // null for page/reading/off
  export class SleepTimer {
    constructor(onFade: (volume: number) => void, onStop: () => void)
    set(o: SleepOption, page: number): void
    tick(elapsedSec: number, playing: boolean): void     // the provider calls it every 250 ms with real elapsed time
    sentenceEnding(index: number, sentencePage: (i: number) => number, remainingInSentenceSec: number): void
    get state(): SleepState
  }
  export function sleepLabel(s: SleepState): string    // 'Sleep' | 'Sleep 19:42' | 'Sleep · page' | 'Sleep · end'
  ```
  Minutes count down only while playing. During the last 5 s, `onFade` gets the volume falling linearly from 1 to 0. At 0, `onStop` runs; the provider pauses, restores the volume to 1, flushes the position and the option resets to `off`. `'page'` stops when the sentence that is ending is the last one whose first span is on the page the timer was set on, fading over the last 5 s of that sentence (or all of it, if shorter). `'reading'` lets the reading finish (Task 9) and turns itself off.
  Popover (mockup screen 7): heading "Stop reading after…", options Off, 10 minutes, 20 minutes, 30 minutes, 45 minutes, End of this page, End of this reading, with a ✓ on the current one.

- [ ] **Step 1: Write the failing tests:** `counts down only while playing`; `fades over the last five seconds then stops`; `page option stops after the last sentence of the page it was set on`; `setting Off cancels a fade in progress and restores volume`; `the bar shows the countdown and a stop pauses, restores volume and flushes the position` (renderer test).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `feat(player): sleep timer with countdown, page and reading options, and a five-second fade`.

### Task 9: Media Session, background playback, Finished and Next, crash toasts

**Files:**
- Create: `src/renderer/src/player/media-session.ts`, `tests/unit/player/media-session.test.ts`
- Modify: `src/shared/library/shelf.ts` (+ `nextReading`), `tests/unit/library/shelf.test.ts`, `PlayerContext.tsx`, `PlayerBar.tsx`, `App.tsx`, `tests/renderer/player.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function bindMediaSession(
    ms: MediaSession | undefined,
    meta: { title: string; artist: string } | null,
    h: { play(): void; pause(): void; back(): void; forward(): void }
  ): () => void
  // shelf.ts
  export function nextReading(s: LibrarySnapshot, currentId: ReadingId): ReadingView | null
  ```
  `bindMediaSession` sets `MediaMetadata` (title = reading title, artist = course name, or "Tide" when there is none). It maps play, pause, seekbackward and previoustrack → back, and seekforward and nexttrack → forward. The provider keeps `playbackState` in step with the phase. The cleanup function clears the handlers and the metadata.
  `nextReading`: the first unfinished reading after `currentId` in its `groupShelf` group's `active` order, else the first unfinished one before it; null if there is none.
  Finished: on phase `finished` the provider calls `library.update(id, { finished: true })` and flushes. The bar replaces its controls' status line with "Finished ✓ · Next: <title>" and two buttons, **Play next** and **Dismiss**. With no next reading, it shows only "Finished ✓" and **Dismiss**. Play next calls `onPlayNext(id)`. `App` opens that reading, and the provider plays once the new reading's sentences arrive (a one-shot `autoplayFor` id).
  Crash: on status `restarting`, show the toast "The voice stopped unexpectedly. Restarting…". On `failed`, show the toast "The voice stopped unexpectedly." with the action **Restart Tide** (`tide().app.relaunch()`), which stays until it is clicked.
  Background: no new code beyond Task 5's blocker. macOS close-to-hide and Dock re-show already exist (`index.ts`). The e2e in Task 10 proves playback continues while minimised and hidden.

- [ ] **Step 1: Write the failing tests:** `binds metadata and the four actions, and clears them on cleanup`; `nextReading picks the next unfinished reading in the same course, wrapping to earlier ones`; `nextReading is null when every other reading in the course is finished`; `reaching the end marks the reading finished and offers Play next`; `Play next opens the next reading and starts playing it`; `a voice restart shows the restarting toast; a failure offers Restart Tide`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit.** `feat(player): media keys and Now Playing, finished state with the next reading, voice crash toasts`.

### Task 10: M4 end-to-end, CI baseline, docs: **STOP for Yasin's listening check**

**Files:**
- Create: `tests/e2e/player.spec.ts`
- Modify: `tests/e2e/reader.spec.ts` (← / → now skip 15 s), `scripts/make-fixtures.ts` (if needed: a short 2-page `listen.pdf` of ~12 invented sentences, one with a clause comma near the start), `.github/workflows/ci.yml`, `docs/spikes/m0-results.md`, `docs/superpowers/specs/2026-11-16-tide-design.md` §12

- [ ] **Step 1: Write the e2e tests** in `tests/e2e/player.spec.ts` (fixture reading added through the existing helpers):
  - `Play speaks and the highlight advances to the next sentence` (poll highlight ids. A hidden `<audio>` gets `data-phase` from the provider when `window.tideTest` exists; assert it reaches `playing`).
  - `Space pauses and the position is flushed: a restart opens at the same sentence`.
  - `→ skips forward and ← goes back`.
  - `playback continues while the window is minimised` (`BrowserWindow.minimize()` through `app.evaluate`, then the highlight still advances; on macOS also `hide()`).
  - `Now Playing metadata names the reading and course` (`navigator.mediaSession.metadata.title`).
  - `changing speed re-synthesises and keeps playing` (open the popover, click `1.5×`, the label changes and the highlight keeps advancing).
  - `reaching the end offers the next reading` (a 2-sentence fixture, plus a second reading in the same course).
  If the highlight never advances on a CI runner without a sound device, record that in the task report. Then add a test-only `TIDE_FAKE_AUDIO=1` (honoured only under `TIDE_E2E`) that swaps `HtmlAudioSink` for a timer sink firing `ended` after each clip's duration, and run the player spec with it on that runner only. Do not weaken the assertions.
- [ ] **Step 2: Run** `npm run build && npx playwright test` → all pass. Then `npm run package && TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test` → all pass. Note the installer size.
- [ ] **Step 3: CI.** Rebase the installer baseline in `ci.yml` to the fp32 build: put the sizes from this branch's first green CI run in the script, with a comment `fp32 model, M4 (+~233 MB vs q8)`. Push the branch (a feature branch push is allowed; `main` is not) and confirm both OSes are green.
- [ ] **Step 4: Docs.** In `m0-results.md`, record the M4 first-audio latency (the time from Play to `playing`, measured in the e2e and logged) on Windows dev and on both CI runners, the fp32 RTF, and the installer sizes. In spec §12, record the M4 rulings made so far (the ledger has them).
- [ ] **Step 5: Commit.** `test(e2e): M4 player end-to-end; CI baseline for the fp32 installer; M4 results`.
- [ ] **Step 6: STOP.** Report to Yasin: what to listen for (voice quality at 1× and 2×, gaps between sentences, the highlight in sync, the sleep fade, media keys, close-to-hide on Mac via CI only), the installer path, and the open questions. Do not start Task 11 until he says so.

---

## M4 follow-ups from Yasin's listening check (2026-11-22): before M5

Findings: (1) audio takes "a while" to start after a voice change or a jump to another paragraph; (2) ProQuest ebook stamps are read aloud (the header "Ebook pages 376-427 | Printed page 2 of 43", the footer citation "<Author>, et al. <Title>, <Publisher>, <year>. ProQuest Ebook Central, http://…. Created from <institution> on <date> <time>."); (3) new feature: finish a reading within a chosen time. His decisions for (3): speed up only (every sentence is still read); computed once for the **whole reading**; set from the reading's **More** menu; if even 2× can't make it, say so and play at 2×.

### Task 10a: Faster restarts after a jump or a voice change

**Files:** Modify `src/renderer/src/player/engine.ts`, `src/tts/worker.ts`, `src/tts/protocol.ts` (if needed), `src/renderer/src/player/clips.ts`; Test `tests/unit/player/engine.test.ts`, `tests/unit/player/clips.test.ts`, `tests/unit/tts-queue.test.ts`.

**Interfaces:** `PlayerEngine` keeps its public API. New internal behaviour:
- **Audio cache:** audio already made for (index, voice, speed) survives a seek. A seek re-uses cached sentences and only requests the missing ones. The cache keeps at most **8** sentences (current ±), and every evicted URL is revoked. A voice or speed change still discards everything.
- **Prompt cancel:** a seek cancels only jobs outside the new window. The worker checks for cancellation between chunks, and live jobs use a smaller maximum chunk (`LIVE_MAX_TOKENS = 120`) so a cancelled job frees the engine within one short chunk.
- **Short first clip:** the first clip after play, seek or voice change gets an earlier boundary: `firstClips(text, { maxFirstWords: 8 })` splits at the first clause boundary within the first 8 words, falling back to the existing rule.

- [ ] **Step 1: Measure.** Before changing anything, add a temporary timing log (or a unit-level fake-clock trace) and record, in the task report, the time from seek to `playing` and from voice change to `playing` on this machine, using the packaged app or `tideTest`, and where the time goes (waiting for an in-flight job, synthesis of the first clip, other).
- [ ] **Step 2: Failing tests:** `a seek within cached sentences plays at once without new synthesis`; `a seek cancels only jobs outside the new window`; `the cache holds at most 8 sentences and revokes evicted URLs`; `a voice change still discards the cache`; `firstClips with maxFirstWords splits early at a clause boundary`; worker/queue: `live jobs are split into chunks of at most LIVE_MAX_TOKENS so cancel lands within one chunk`.
- [ ] **Step 3: Implement**, then re-measure as in Step 1. Report the before and after numbers. Target: first audio after a seek to an uncached sentence is ≤ 1.5 s on this machine (packaged, fp32), and a seek to a cached one is ≤ 0.3 s.
- [ ] **Step 4: Verify:** `npx vitest run`, typecheck, lint, and `npm run build && npx playwright test tests/e2e/player.spec.ts`.
- [ ] **Step 5: Commit.** `perf(player): keep made audio across seeks, cancel promptly, shorter first clip`.

### Task 10b: Skip ebook vendor stamps

**Files:** Modify `src/shared/text/filters.ts` (header/footer detection), `src/shared/text/pipeline.ts` if needed, `src/shared/text/types.ts` (`PIPELINE_VERSION` → **4**), `scripts/make-fixtures.ts` (new `ebook-stamps.pdf`, invented text); Test `tests/unit/text/filters.test.ts`, `tests/unit/text/pipeline.test.ts`, and a golden in `tests/fixtures/spoken/` written by hand.

**Interfaces:** `isVendorStamp(line: Line): boolean` (exported from filters.ts), applied under `skipHeadersFooters`. It matches, case-insensitive:
- `/\bProQuest Ebook Central\b/`;
- `/\bCreated from \S+ on \d{4}-\d{2}-\d{2}\b/`;
- `/^Ebook pages \d+\s*[-–]\s*\d+\s*\|\s*Printed page \d+ of \d+$/`;
- `/^Copyright ©\s*\d{4}\.?\s.*All rights reserved\.?$/` (only in the top or bottom band of a page);
- the EBSCOhost stamp `/\bEBSCO(host)? ?(Publishing|eBook Collection)\b.*printed on/`;
- the JSTOR stamp `/^This content downloaded from .* on .* UTC$/`.

A stamp line that wraps onto a second line, such as "…detail.action?docID=7210617." continuing with "Created from rochester on…", is dropped as one block: the following line in the same band is dropped when the stamp's text ends mid-citation. Separately, the running header/footer repeat check compares lines with **digits normalised** (`\d+` → `#`), so "Printed page 2 of 43" and "Printed page 10 of 43" count as the same header.

- [ ] **Step 1: Failing tests** (invented author, title and institution in the vendor format; never her readings): `drops ProQuest header and footer stamps on every page`; `drops a stamp that wraps onto two lines`; `drops JSTOR and EBSCO download stamps`; `does not drop a body sentence that merely mentions ProQuest or copyright`; `headers differing only by page numbers repeat-match`; `Read everything keeps the stamps`; plus a pipeline golden for `ebook-stamps.pdf`.
- [ ] **Step 2: Implement.** Bump `PIPELINE_VERSION` to 4.
- [ ] **Step 3: Local check** (only when `local-fixtures/` exists): run `tests/unit/text/local-readings.test.ts` and report only aggregate numbers by reading index (sentences before and after, stamps dropped). No reading text in the report.
- [ ] **Step 4: Verify** `npx vitest run`, typecheck, lint. **Commit.** `feat(text): skip ebook vendor stamps (ProQuest, EBSCO, JSTOR); header repeats ignore page numbers`.

### Task 10c: Finish within a time limit

**Files:** Modify `src/shared/library/types.ts` (Reading `finishIn: number | null`, minutes; ReadingPatch `finishIn?: number | null`), `src/main/library/{schema,library,ipc}.ts` (validate: null or one of `FINISH_IN_CHOICES`), `src/shared/voices.ts` (+ per-voice `charsPerSec` measured from the bundled previews, and `FINISH_IN_CHOICES = [30, 45, 60, 90, 120]`), `scripts/voice-previews.ts` (prints the measured rates), `src/renderer/src/player/finish-in.ts` (new, pure), `src/renderer/src/player/PlayerContext.tsx`, `src/renderer/src/player/PlayerBar.tsx`, `src/renderer/src/App.tsx` (More menu item), `src/renderer/src/reading/ReadingMenu.tsx` (a **Finish in…** submenu). Tests: `tests/unit/player/finish-in.test.ts`, `tests/unit/library/*.test.ts`, `tests/renderer/finish-in.test.tsx`.

**Interfaces:**
```ts
// finish-in.ts
export function readingSeconds(texts: string[], charsPerSec: number): number          // at 1×, whole reading
export function finishInSpeed(totalSec: number, limitMin: number): { speed: number; fits: boolean; neededMinAt2x: number }
// speed = clamp(ceil((totalSec / (limitMin*60)) * 20) / 20, 1, 2): steps of 0.05, never below 1×; fits = speed needed ≤ 2
export function finishInLabel(r: ReturnType<typeof finishInSpeed>, limitMin: number): string
// fits:  'Finishes in about 58 min at 1.3×'   (minutes at the chosen speed, rounded up)
// !fits: 'Needs 1 h 30 min even at 2×'
```
Behaviour:
- **Speed choice:** with `finishIn` set, the reading plays at `max(chosenSpeed, finishInSpeed.speed)`. If her own speed is already faster, it's kept. Computed once, when the limit is set or the reading opens, from the whole reading's text (spec: whole reading) and the current voice's `charsPerSec`.
- **Display:** the player's voice label shows the effective speed (e.g. `Emma · 1.3×`). The status line under the wave shows `finishInLabel` for 5 s after the limit is set, and the More menu item shows the current choice.
- **Menu:** More → **Finish in…** → Off / 30 min / 45 min / 60 min / 90 min / 2 hours, with a ✓ on the current one. The choice is saved per reading (`finishIn`).
- **Voice:** changing voice recomputes with the new voice's `charsPerSec`.
- **Constraints:** `tts:synthesize` already accepts any speed from 0.5 to 2. No new player control (still exactly five).

- [ ] **Step 1: Failing tests:** `readingSeconds sums characters over the voice rate`; `finishInSpeed rounds up to 0.05 and never goes below 1×`; `finishInSpeed reports needed time at 2× when it does not fit`; `finishInLabel wording for fits and does not fit`; library: `finishIn defaults to null, validates choices, persists`; renderer: `choosing Finish in 60 min sets the effective speed and shows the estimate`; `a faster own speed is kept`; `Off restores her chosen speed`; `the More menu shows the current choice`.
- [ ] **Step 2: Measure the voice rates.** Extend `scripts/voice-previews.ts` to print chars/sec for each bundled preview (`PREVIEW_SENTENCE.length / durationSec`), and copy the values into `VOICES[i].charsPerSec`. Add a voices test that every voice has `charsPerSec` between 8 and 25.
- [ ] **Step 3: Implement. Step 4: Verify** `npx vitest run`, typecheck, lint, `npm run build`. **Commit.** `feat(player): finish a reading within a chosen time by raising the speed (max 2×)`.

### Task 10d: Follow-up e2e and installer

- [ ] Add e2e tests: `a jump to another paragraph starts speaking within 3 s` (packaged; logged in the report); `Finish in 60 min shows the estimate and the effective speed`. Run dev and packaged offline e2e and `npm run package`. Push the feature branch (approved by Yasin on 2026-11-22) and confirm CI is green on both OSes. **STOP** for Yasin to try the build again before M5.

---

## M5: Save as audio

### Task 11: Selectable pages: pdf.js text layer and selection → sentences

**Files:**
- Create: `src/shared/text/selection.ts`, `tests/unit/text/selection.test.ts`, `src/renderer/src/reader/selection-dom.ts`
- Modify: `src/renderer/src/reader/pdf.ts` (+ `renderTextLayer`), `src/renderer/src/reader/PdfPage.tsx`, `src/renderer/src/reader/deps.tsx`, `tests/renderer/reader-fakes.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**
- Produces:
  ```ts
  // selection.ts
  export interface Point { page: number; itemIndex: number; offset: number }
  export function selectionSentences(sentences: Sentence[], a: Point, b: Point): [number, number] | null
  // pdf.ts (PdfDoc)
  renderTextLayer(n: number, container: HTMLElement, scale: number, signal: AbortSignal): Promise<void>
  // selection-dom.ts
  export function pointFromDom(node: Node, offset: number): Point | null
  export function currentSelection(root: HTMLElement): { a: Point; b: Point; rect: DOMRect } | null
  ```
  `selectionSentences` orders a and b. It returns the first sentence with a span ending after `a` and the last sentence with a span starting before `b`, or null when no sentence overlaps (skipped text). `renderTextLayer` uses pdf.js `TextLayer`. Each text div gets `data-item-index` = the index of its item in `getTextContent().items`: walk the items in order and assign only to the items `TextLayer` renders a div for (it skips marked-content entries). `pointFromDom` climbs to the nearest `[data-item-index]` and `[data-page]` and counts the character offset within that div.
  PdfPage: the text layer is rendered only for pages in the render window (released outside it, like the canvas). It sits above the canvas and the highlight, with transparent text and `::selection` in the `--hl` token (copy only the pdf.js `.textLayer` rules Tide needs, scaled with `--scale-factor`). A click picks a sentence only when the selection is collapsed (no drag).

- [ ] **Step 1: Write the failing tests:** `a selection inside one sentence maps to that sentence`; `a selection across three sentences on two pages maps to the first and last`; `reversed points give the same result`; `a selection inside skipped text maps to no sentences`; `a selection ending exactly at a sentence start does not include that sentence`. In `tests/renderer/reader.test.tsx`: `a drag-selection does not move the highlight; a plain click still does`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: e2e check.** Add `pages have a text layer whose items match the page text` to `tests/e2e/reader.spec.ts`: for page 1 of `single-column.pdf`, every `[data-item-index]` div's text equals that item's `str` from `pageText`, read through the probe. Run `npm run build && npx playwright test tests/e2e/reader.spec.ts` → PASS.
- [ ] **Step 6: Commit.** `feat(reader): selectable text layer and selection snapped to whole sentences`.

### Task 12: Selection bubble, Read from here, first-time tip

**Files:**
- Create: `src/renderer/src/reader/SelectionBubble.tsx`, `src/renderer/src/reader/SelectTip.tsx`, `tests/renderer/selection-bubble.test.tsx`
- Modify: `ReaderView.tsx`, `App.tsx` (passes the bubble's Save action up to open the Save panel, Task 14)

**Interfaces:**
- Consumes: Task 11; `usePlayer().readFrom`; `tide().library.tipSeen`; `snapshot.ui.tipsSeen`.
- Produces: `SelectionBubble({ rect, onRead(): void, onSave(): void })`, positioned below the selection's last line (above it when there is no room). Two buttons: **Read from here** (primary) and **Save as audio**. ReaderView exposes `onSaveSelection(range: [number, number])` as a prop. The bubble hides when the selection collapses, on Escape, and after either action (which also clears the selection).
  Tip: shown once per install, near the top of the first visible page, when a reading is open with sentences and `'select-text'` is not in `tipsSeen`. Text: "Select any text to read from there or save it as audio." with a **Got it** button. It is marked seen on Got it or on her first selection.

- [ ] **Step 1: Write the failing tests:** `selecting spoken text shows the bubble with Read from here and Save as audio`; `no bubble for a selection with no spoken sentences`; `Read from here plays from the first selected sentence`; `Save as audio reports the snapped sentence range`; `Escape hides the bubble`; `the tip shows once and Got it records it`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `feat(reader): selection bubble with Read from here and Save as audio, one-time tip`.

### Task 13: Export service in main

**Files:**
- Create: `src/main/export/{files,writers,job,ipc}.ts`, `tests/unit/export/{files,job,ipc}.test.ts`, `tests/unit/export/writers.test.ts`
- Modify: `src/main/audio-export.ts` (shares the writers; `exportM4b`/`exportMp3` keep their signatures for the test hook), `src/main/index.ts`, `src/shared/ipc-types.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`

**Interfaces:**
- Produces (`ipc-types.ts`):
  ```ts
  export interface ExportSpec {
    readingId: string
    format: 'mp3' | 'm4b'
    baseName: string                 // no extension; main cleans it
    title: string                    // tag title: reading title + range
    sentences: { text: string; page: number }[]
    voice: string; speed: number
  }
  export type ExportFailure = 'disk-full' | 'no-permission' | 'folder-missing' | 'failed'
  export type ExportEvent =
    | { jobId: string; kind: 'progress'; done: number; total: number }
    | { jobId: string; kind: 'saved'; fileName: string }
    | { jobId: string; kind: 'failed'; reason: ExportFailure }
    | { jobId: string; kind: 'cancelled' }
  ```
  `window.tide.export`: `start(spec: ExportSpec, o?: { chooseFolder?: boolean }): Promise<{ jobId: string } | { busy: true } | { cancelled: true }>`; `cancel(jobId): Promise<void>`; `reveal(jobId): Promise<void>`; `onEvent(cb: (e: ExportEvent) => void): () => void`.
- Produces (`files.ts`): `exportDir(musicDir: string): string`; `safeFileName(s: string): string` (replaces `\ / : * ? " < > |` and control characters with `-`, collapses runs of spaces, trims spaces and dots, caps at 120 characters, `'Tide audio'` if empty); `uniquePath(dir, base, ext, exists: (p: string) => Promise<boolean>): Promise<string>`; `failureReason(err: unknown): ExportFailure` (`ENOSPC` → disk-full; `EACCES`/`EPERM`/`EROFS` → no-permission; `ENOENT` on the folder → folder-missing).
- Produces (`writers.ts`): `interface AudioWriter { write(pcm: Float32Array): Promise<void>; finish(chapters: Chapter[]): Promise<void>; abort(): Promise<void> }`; `createMp3Writer(outPath, meta, signal)` (one ffmpeg, PCM streamed on stdin with backpressure, `-b:a 64k`, ID3 tags, `.part` then rename); `createM4bWriter(outPath, meta, signal)` (pass 1 streams to a temp `.m4a` in `os.tmpdir()`; `finish(chapters)` remuxes with `-c copy` plus FFMETADATA chapters into `.part`, patches the chapter language to `eng`, renames, and deletes the temp file).
- Produces (`job.ts`): `runExport(spec, deps: { synthesize(text: string, o: SynthesizeOptions & { priority: 'export'; gen: string }): Promise<TtsAudio>; writer: AudioWriter }, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<void>`. Sentences are synthesised one at a time with `gen = export-<jobId>`. A chapter `Page N` starts at the first sentence of each new page. Abort cancels the gen and aborts the writer.
  ipc: one job at a time (`{ busy: true }` otherwise). The folder is `exportDir(TIDE_E2E && TIDE_MUSIC_DIR || app.getPath('music'))`, created with `mkdir -p`; `chooseFolder` shows main's own folder dialog (for this save only; the setting comes in M6). Album = the reading's course name from the library, else `Tide`. Artist = `Tide · ${voiceName(voice)}`. Validation: format, voice ∈ `VOICE_IDS`, speed ∈ `SPEEDS`, 1 ≤ sentences ≤ 20,000, each text ≤ 5,000 characters, page a positive integer, baseName and title strings ≤ 200 characters. `reveal` → `shell.showItemInFolder` on that job's saved path. On failure or cancel, no `.part` or temp file remains.

- [ ] **Step 1: Write the failing tests:**
  - `safeFileName replaces characters illegal on Windows or macOS and trims dots and spaces`.
  - `uniquePath adds (2), then (3)`.
  - `failureReason maps ENOSPC, EACCES, EPERM and ENOENT`.
  - `runExport synthesises at export priority and makes one chapter per page with text`.
  - `cancelling mid-export cancels the generation and aborts the writer`.
  - `the MP3 writer streams PCM and leaves only the final file` and `the M4B writer remuxes chapters and leaves no temp or part file` (real bundled ffmpeg, 3 short sine-wave PCM buffers; then `ffmpeg -i` shows `Chapter #0:2` for the m4b and a non-zero duration for both).
  - `an aborted writer deletes its part file`.
  - `export:start rejects a bad spec and returns busy while a job runs`.
  - `TIDE_MUSIC_DIR is ignored without TIDE_E2E`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/export tests/unit/audio-export.test.ts` → FAIL.
- [ ] **Step 3: Implement**, keeping `audio-export.test.ts` and the smoke `exportM4b` hook green.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat(export): streaming MP3 and chaptered M4B export jobs at export priority, safe names, no partial files`.

### Task 14: Save panel, progress card, toasts, More menu item

**Files:**
- Create: `src/renderer/src/save/{SavePanel,ExportProgress}.tsx`, `src/renderer/src/save/useExport.ts`, `src/renderer/src/save/names.ts`, `tests/renderer/save-panel.test.tsx`, `tests/unit/save-names.test.ts`
- Modify: `App.tsx` (`ReadingMenu` `extraItems` gains **Save as audio…**; the bubble's Save opens the panel), `tests/renderer/setup.ts`

**Interfaces:**
- Consumes: Task 12's `[first, last]` range; `usePlayer().estimateSec`; `useReaderState().sentences/numPages/page`; `tide().export`; `useToast`.
- Produces (`names.ts`): `defaultBaseName(o: { course: string | null; title: string; scope: { kind: 'selection'; page: number } | { kind: 'pages'; from: number; to: number } | { kind: 'whole' } }): string` → `PSYC 201 – Ch 2 Memory – p31`, `… – p31–40` (`p31` when from = to), `… ` with no suffix for whole, and no `COURSE – ` when there is no course; `durationLabel(sec: number): string` → `'under a minute'` or `'about N min'`.
  Panel (mockup screen 4, worded for her): title "Save as audio"; sub "An audio file you can play on your phone, at the gym or anywhere."; "What to save": **The text I selected** (only when opened from a selection), **Pages [from] to [to]** (number fields, default = the current page to the current page), **The whole reading**, each with its `durationLabel`. Default scope: the selection when there is one, else the whole reading. Whole reading adds the audiobook line (Global Constraints) and a link button **Save as MP3 instead** (toggles to MP3; it then reads **Save as audiobook instead**). "File name": a text field with the `defaultBaseName` value and the extension shown after it. Line: "Voice: Emma · 1×" and "Saves to Music › Tide". Buttons **Cancel** and **Save audio** (primary). Pages are validated as 1 ≤ from ≤ to ≤ numPages and must contain spoken sentences, else the inline message "Nothing to read on those pages." and Save is disabled.
  While a job runs: an `ExportProgress` card above the player ("Making your audio…", `<scope label> · NN%`, a bar, "You can keep reading while this finishes.", **Cancel**). While busy, the More menu item and the bubble's Save show the message "Tide is still making your last audio." instead of opening the panel. Events: saved → toast `✓ Saved “<fileName>”` with **Show in Finder** / **Show in folder** (`tide().platform`); failed → toast "Couldn't save the audio: <reason>." (disk-full: "your disk is full"; no-permission: "Tide isn't allowed to save there"; folder-missing: "the folder is missing"; failed: "something went wrong") with **Try again** and **Choose another folder**; cancelled → toast "Audio not saved."

- [ ] **Step 1: Write the failing tests:** `defaultBaseName forms for selection, pages, whole and no course`; `durationLabel wording`; `from a selection the panel picks The text I selected`; `from the More menu it picks the whole reading and says it saves an audiobook`; `Save as MP3 instead switches the format`; `page fields reject an empty or reversed range`; `Save sends the snapped sentences with the voice, speed and file name`; `progress shows, Cancel cancels, and the cancelled toast says Audio not saved.`; `a saved toast offers Show in folder on Windows and Show in Finder on macOS`; `a failure toast offers Try again and Choose another folder`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5: Commit.** `feat(save): Save as audio panel with scope estimates, audiobook default, progress and toasts`.

### Task 15: M5 end-to-end, docs and rulings

**Files:**
- Create: `tests/e2e/save-audio.spec.ts`, `docs/superpowers/decisions/2026-11-19-m4-m5-rulings.md` (or the date of completion)
- Modify: `.github/workflows/ci.yml` (macOS job: also run `check-chapters.swift` on the e2e's whole-reading `.m4b`), `docs/spikes/m0-results.md`, spec §12

- [ ] **Step 1: Write the e2e tests** (each launch sets `TIDE_MUSIC_DIR` to a fresh temp dir):
  - `select text, Save as audio, saves an MP3 with tags`: drag across two sentences of page 1, then bubble → Save as audio → Save audio; the toast says Saved; the dir has exactly one `.mp3` and no `.part`; `ffmpeg -i` shows a duration > 1 s, `title` and `artist: Tide · Emma`.
  - `the whole reading saves an audiobook with one chapter per page with text`: More → Save as audio… → Save audio; the `.m4b` has as many chapters as the fixture has pages with sentences; copy it to `test-results/whole.m4b` for the macOS chapter check.
  - `cancelling leaves no file`: start a whole-reading export of the longest fixture, click Cancel at once; the toast says "Audio not saved." and the dir is empty.
  - `exporting while playing keeps playback going`: start playback, then a page-range export; the highlight keeps advancing until the export finishes.
  - `Read from here starts at the selected sentence`.
- [ ] **Step 2: Run** dev and packaged e2e (with `TIDE_OFFLINE_GUARD=1`) → all pass. Push the feature branch; CI is green on both OSes, including the macOS chapter check.
- [ ] **Step 3: Docs.** In `m0-results.md`, record export timings (seconds of audio per second of export, with and without live playback) and the M5 installer sizes. In spec §12, record the M5 rulings. Write the rulings doc from the ledger: the rulings, the results, the deferred minors and the owner checks (listen to an exported MP3 on a phone; AirDrop the `.m4b` to an iPhone in M7).
- [ ] **Step 4: Commit.** `test(e2e): M5 save as audio end-to-end; record M4+M5 rulings and results`.
- [ ] **Step 5: Report** to Yasin and ask before any push to `main`, PR or tag.

---

## Known limits carried forward (not in scope)

- Chapter titles use `Page N`. Naming a chapter after a section heading needs a heading flag from the pipeline (deferred; the run-in bold heading work is in the M3 deferred list).
- The export folder setting, pronunciation fixes and themes are M6. Apple Books on a real iPhone and the GPL source offer for ffmpeg are M7.
