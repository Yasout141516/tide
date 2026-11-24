# Tide — offline PDF read-aloud app (PRD + design)

*Name: **Tide**. Date: 2026-11-16. Owner: Yasin. Status: draft for approval.*

---

## 1. Why this exists

A friend of Yasin's (a university student, **not technical**, Mac laptop) has a heavy load of
assigned course readings as PDFs. She wants them **read aloud in a calm, comforting voice
she chooses**, so she can:

- **follow along at her laptop**, with the current sentence highlighted on the page, and
- **take passages with her** as audio files to play while walking, at the gym, cooking or lying down.

It must be **free**, work **fully offline**, keep playing **in the background**, and be
**plug and play**: download, double-click, use. No setup, no accounts, no internet.

**Success looks like:** she adds this week's readings, presses play, and listens to a whole
chapter without the app reading junk (page numbers, headers, footnotes), losing her place,
or her ever opening a terminal. She also makes MP3s of passages and plays them on her phone.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
1. Natural, comforting offline voices, several to choose from, with preview.
2. Live read-aloud with the current sentence highlighted on the real PDF page.
3. Select passages, a page range, or a whole reading and save them as MP3.
4. Clean reading: skip page numbers, running headers/footers, footnotes, cover/copyright pages,
   figure/table captions and table text; stop at the References/Bibliography section; optionally
   skip citations. Each of these can be switched off in Settings, and any single reading can be set
   to **"Read everything"**.
5. A library ("shelf") grouped by course, which remembers her place in every reading.
6. Background playback, sleep timer, speed control, and Mac media keys / Now Playing.
7. Calm light and dark themes (Sky & Sea, Deep Sea) plus two playful alternatives (Pixel Quest, Kitty).
8. A downloadable Mac app (primary) and Windows app (secondary), built by GitHub Actions.

**Non-goals (v1)**
- Scanned / image-only PDFs (no OCR). Her PDFs have real text.
- Languages other than English.
- Notes, annotations, flashcards or summaries.
- Accounts, sync, cloud or mobile app. Saved MP3s are the "mobile" story.
- Auto-update (an unsigned Mac app can't use the standard updater). New versions are re-downloaded manually.
- Mac App Store or Microsoft Store distribution, and paid code signing.

**Anti-goals: fail even if it "works"**
- She ever has to use Terminal, install Python/Node, or download a model.
- The voice sounds robotic, or reads "Page 31 · Chapter 2 · Introduction to Psychology" every page.
- She loses her place, or a moved file wipes her progress.
- Any feature needs internet.
- The UI feels busy or technical. Every control is labelled in words.
- Real Pokémon names, characters, sprites or logos anywhere (Nintendo IP; the repo is public).

## 3. Users and platforms

- **Primary user:** the student, on a **MacBook Air M5** (Apple chip, macOS 26 "Tahoe" or later).
  The Mac build is **Apple chip (arm64) only**. No Intel build: nobody needs it, and it halves Mac CI
  time. An M5 runs Kokoro many times faster than real time, so a second "fast voice" engine is not needed.
- **Secondary:** anyone Yasin shares it with, on Windows 10/11 x64.
- **Builder:** Yasin, on Windows, with **no Mac at all**. He is new to Electron. All Mac builds and Mac
  automated tests run on GitHub Actions `macos` (Apple-chip) runners. The first test on a real Mac
  happens at hand-off on her laptop (see §9, §12).
- **No deadline.** Full v1 scope stays. If scope ever has to shrink, cut in this order: Kitty and Pixel Quest →
  pronunciation fixes → Windows polish. Never cut the reader, voice, resume or Save as audio.

## 4. Approaches considered (decided: Electron)

| Approach | Trade-offs | Verdict |
|---|---|---|
| **Electron** + web UI + Kokoro in a Node process | Same Chromium engine on Mac and Windows, so what Yasin tests on Windows behaves the same on her Mac. Mature packaging. Large download (~250–350 MB). | **Chosen** |
| Tauri | Tiny shell, but uses Safari's engine on Mac vs Edge's on Windows (untestable differences for Yasin). Bundling the voice engine is awkward and needs some Rust. | Rejected |
| Python desktop app (Qt + PyInstaller) | Kokoro's reference code is Python, but packaging PyTorch as a double-click Mac app is fragile and >1 GB. | Rejected |

## 5. Product decisions (agreed with Yasin)

- **Layout:** "Classic". The shelf is on the left, the real PDF page in the middle, and the player bar along the bottom.
- **Themes:** **Sky & Sea** (light, default) and **Deep Sea** (dark), mostly sky- and sea-blue.
  **Pixel Quest** is an alternative theme only, never the default. It is a seaside retro-RPG look with
  an *original* sprout-critter mascot. **Kitty** is a second alternative: a pastel kitten theme with an
  original kitten, Mochi (§6.8). Settings also offer "Match my Mac".
- **Simplicity rules:** one primary button ("Add reading"). Clicking a reading resumes it.
  Selecting text shows a bubble with **Read from here** / **Save as audio**. The player has only five
  controls: back 15s, play/pause, forward 15s, voice & speed, sleep. All labelled in words.
- **Adding PDFs:** the **Add reading** button (file picker) and **Finder → Open With → Tide**.
  No drag-and-drop in v1.
- **Library stores references, not copies.** Tide remembers each PDF's location. If the file moves,
  the reading shows **"File moved · Find it"**. Her saved place is kept, and she re-points it once.
- **Course tags:** an optional course picker when adding (existing courses, "New course", or Skip → "Other").
- **A tidy shelf as it grows:** each course group can be collapsed (remembered). Finished readings fold
  into a "Finished (N)" row under their course. Within a course, the most recently opened comes first.
  No search box in v1.
- **Right after adding a reading:** it opens at page 1 with the play button ready (no autoplay). The
  first time only, a tip appears near the page: *"Select any text to read from there or save it as
  audio."* **"Save as audio…"** is also always in the reading's **"…" menu** (pages or whole reading),
  so the feature doesn't depend on discovering text selection.
- **Window and keyboard:** minimum window 900×600. Below 1100 px wide, the shelf collapses behind a
  **"Shelf"** button (it slides over the page and closes on pick). Shortcuts (Windows uses Ctrl instead of ⌘):
  Space play/pause, ← / → back/forward 15 s, ⌘O add reading, ⌘, settings, ⌘+ / ⌘− text size.
  These are listed in the Help menu.
- **Unsigned Mac app:** no $99/yr Apple fee. She does a one-time **System Settings → Privacy & Security →
  Open Anyway**. Yasin gives her a screenshot guide (§10.4).
- **Repo:** **public** on GitHub (Yasin's). Mac builds are free on public repos, and she downloads from
  a plain Releases link with no GitHub account. She only ever downloads the built app. Her readings are never in the repo.
- **Save as audio formats:** MP3 for selections and page ranges, and an **audiobook (`.m4b`)** with per-page
  chapters for whole readings, so Apple Books on her iPhone remembers her place (§6.5).

### 5.1 Screens (approved mockups)

Interactive mockups with a light/dark switch: [`docs/design/screens-sky-sea.html`](../../design/screens-sky-sea.html).
Pixel Quest visual reference ("Coast route" card): [`docs/design/pixel-quest-reference.html`](../../design/pixel-quest-reference.html).
Kitty theme: [`docs/design/kitty-theme.html`](../../design/kitty-theme.html).

1. **Reading:** shelf, PDF page with sentence highlight, selection bubble, player bar. In dark
   themes the PDF page is darkened by default (toggle in Settings for chart-heavy readings).
2. **First launch:** empty shelf, "Add your first reading", and a tip about Open With.
3. **Add reading:** a course picker sheet.
4. **Save as audio:** what to save (selection / pages X–Y / whole reading, each with an estimated
   duration), file name (pre-filled `COURSE – Reading title – pNN.mp3`), and voice. Saves to `Music › Tide`.
5. **Saving progress + done toast:** runs in the background while she keeps listening. The toast
   offers "Show in Finder".
6. **Voice & speed:** a popover with a curated voice list, a **Listen** preview per voice, and speed steps
   0.8× / 1× / 1.25× / 1.5× / 2×.
7. **Sleep timer:** Off / 10 / 20 / 30 / 45 min / end of page / end of reading. The button shows a
   countdown and the audio fades out at the end.
8. **File moved:** "Where did this one go?" offers Find the file / Remove from shelf. The resume page is kept.
9. **Settings:** three tabs. **Look** (theme, text size, dark pages), **Reading** (skip headers &
   page numbers, skip footnotes, stop at References, skip captions & table text, skip cover/copyright
   pages, read citations aloud), **Pronunciation**.
10. **Pronunciation fixes:** word → "sounds like" respelling, with Listen and an Add a word button.

### 5.2 Design tokens (source of truth: these values, as approved in the mockups)

**Colour** (CSS custom properties on `:root[data-theme]`):

| Token | Sky & Sea (light, default) | Deep Sea (dark) | Used for |
|---|---|---|---|
| `--bg` | `#F2F9FF` | `#0B1D2C` | app background, fields |
| `--shelf-a` → `--shelf-b` | `#DDEFFC` → `#EAF5FE` | `#0A1826` → `#0D2134` | shelf / settings-nav gradient |
| `--surface` | `#FFFFFF` | `#11293D` | player bar, dialogs, popovers, active shelf row |
| `--ink` | `#12324A` | `#E4F1FA` | primary text |
| `--muted` | `#4F6A82` | `#8EA9BF` | secondary text, course labels |
| `--primary` | `#0F6FA8` | `#4FB0E8` | Add reading, play, primary buttons, selected states |
| `--on-primary` | `#FFFFFF` | `#06192A` | text/icons on primary |
| `--soft` / `--soft-ink` | `#E3F2FD` / `#0B5884` | `#163650` / `#A9DAF7` | secondary buttons (Voice, Sleep, skip) |
| `--border` | `#C9E6FA` | `#1C3A54` | dividers, outlines, unselected chips |
| `--stage-a/b/c` | `#CFE8FA` / `#E6F3FD` / `#F2F9FF` | `#0E2A40` / `#0C2236` / `#0B1D2C` | "sky" gradient behind the PDF page |
| `--page` / `--page-ink` | `#FFFFFF` / `#1D2B36` | `#132B3E` / `#D7E4EE` | PDF page (dark = filtered page) |
| `--hl` / `--hl-line` | `#CDEBFF` / `#1E88C7` | `rgba(79,176,232,.30)` / `#6CC3F2` | current-sentence wash + 2px underline |
| `--sel` | `rgba(91,182,236,.28)` | `rgba(108,195,242,.22)` | text selection |
| `--wave-off` / `--wave-on` | `#C9E6FA` / `#1E88C7` | `#1C3A54` / `#6CC3F2` | wave progress line |
| `--warn` / `--warn-soft` | `#B4532A` / `#FDEEE6` | `#F0A07A` / `#3A2620` | File moved, errors |
| `--ok` | `#1B7F5B` | `#5FD3A3` | Saved ✓ |
| `--bubble` | `#0A2E45` | `#E4F1FA` | selection bubble and toasts (text uses `--bg`) |

**Pixel Quest** (alternative theme): bg `#12304A`, shelf `#0C2236`, outline `#071624`, ink `#FDF3DC`,
dialogue box `#FDF3DC` on `#22223A` text, accent/title `#FFD66B`, play/Add `#C8432B`, progress
`#4FC3D1`/`#3AA9B8`, sentence highlight `#FFE27A`, course badges `#B83D73` / `#2B6FA8` / `#8C6420` /
`#3A7D30` / `#C8432B` (white text on every badge, all ≥ 5:1). Square corners, 3px "pixel" double borders, 3px offset hard shadows.

**Kitty** (alternative theme): bg `#FFF7F2`, shelf `#FCE9EC` → `#FFF3EE`, surface `#FFFFFF`, ink `#4A3236`,
muted `#7A5A60`, primary (rose) `#B8456A` with white text (5.1:1), pressed `#8E2F52`, soft `#FBE1E8` with
`#8E2F52` text, pink `#F6B9C8`, peach `#FFD9C2`, ginger `#F2A65A`, lavender `#ECE6FB`/`#4B3F7A` (finished),
border `#F3D3DA`, highlight `#FFD6E0` + `#B8456A` underline. Radii are larger (14–24 px). All text pairs checked ≥ 4.5:1.

**Type** (all bundled locally):

| Role | Font | Size / weight |
|---|---|---|
| Wordmark, dialog titles, empty-state headline | Fraunces | 20–24 px / 700 |
| UI text, buttons, labels | Nunito Sans | 13–15 px / 600–800; section labels 11 px / 800 uppercase, +1 px tracking |
| Reader meta line | Nunito Sans | 10.5 px / 800 uppercase |
| Pixel Quest labels only | Press Start 2P | 7–11 px; never for reading text |

The PDF page renders the PDF's own fonts. Text size in Settings scales the page zoom (80–200%).

**Shape and spacing:** 4 px spacing grid (4/8/12/16/20/24/32). Radii: 8 px (small chips), 10–12 px
(buttons, shelf rows, fields), 16–18 px (popovers, dialogs), 999 px (pills). The play button is 52 px,
skip buttons 38 px, and every click target at least 36 px tall. Shadows are tinted with sea blue
(`rgba(11,88,132,.16)` light, `rgba(0,0,0,.45)` dark). Motion: 150–250 ms ease-out, and nothing
animates under `prefers-reduced-motion`.

**Contrast (checked 2026-11-16):** `--ink`, `--muted` and `--primary`/`--on-primary` pairs above meet WCAG AA 4.5:1 on their
backgrounds in both themes. Re-check any new pair with a contrast checker before use.

### 5.3 States: what she sees in every in-between moment

Every message is plain language with one clear action. No error codes on screen (they go to a log file).

| Moment | What she sees | Action |
|---|---|---|
| First play after launch (voice loading) | The play button shows a soft spinner with *"Getting the voice ready…"* beneath the wave | none; plays automatically when ready |
| Waiting for the next sentence's audio (rare) | The play button pulses. The highlight stays on the upcoming sentence | none |
| PDF won't open (corrupt / not a PDF) | Dialog: *"Tide can't open this PDF. It may be damaged."* | Remove from shelf / Keep |
| Password-protected PDF | Dialog: *"This PDF is locked with a password."* with a password field | Open / Cancel (password not stored) |
| Page with no readable text | A thin banner on that page: *"No readable text on this page, skipping."* | auto-skip |
| Whole reading has no text | Reading view: *"Tide couldn't find any text in this PDF. It may be a scanned copy."* | Remove from shelf |
| File moved | Shelf row *"File moved · Find it"* plus the dialog in §5.1 #8 | Find the file / Remove |
| Export failed (disk full, folder missing, no permission) | Toast: *"Couldn't save the audio: your disk is full."* (or the specific plain reason) | Try again / Choose another folder |
| Export cancelled | The partial file is deleted. Toast *"Audio not saved."* | none |
| Voice engine crashed | Toast *"The voice stopped unexpectedly. Restarting…"*. The TTS process restarts and resumes at the current sentence | auto; after 2 failures: *"Restart Tide"* button |
| Reached end of reading | The reading is marked finished and the player shows *"Finished ✓ · Next: Ch 3 · Learning ▶"* (next unfinished reading in the same course) | Play next / dismiss |
| Voice preview while playing | The main reading pauses, the preview plays, and the main reading stays paused | press play to resume |
| Empty course (all readings removed) | The course disappears from the shelf | — |

## 6. How it will be built

### 6.1 Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | **Electron** (current stable) + **electron-vite** + **TypeScript** | Standard, well-documented setup with fast dev reload. |
| UI | **React** + **Tailwind CSS** + **Radix UI** primitives (Dialog, Popover, Switch, RadioGroup) | Accessible popovers and dialogs for free. Themes are CSS variables. |
| PDF | **pdfjs-dist** | Renders pages and gives positioned text for extraction and highlighting. |
| Voice | **kokoro-js** (Kokoro-82M ONNX, Apache-2.0) on **onnxruntime-node**, CPU | The most natural free offline voice. Runs in Node, no Python. |
| Audio export | **ffmpeg-static** (AAC `.m4b` with chapters, and MP3 via libmp3lame) | Only proven route to Apple-readable audiobook chapters (§6.5). |
| Storage | **electron-store** (JSON in `app.getPath('userData')`, atomic writes, schema + migrations), plus a rolling `library.backup.json` | Data is tiny, so no database. A corrupted file must never wipe her shelf. |
| Fonts | Bundled locally (Literata, Nunito Sans, Fraunces, Press Start 2P via @fontsource) | Offline: no Google Fonts at runtime. |
| Packaging | **electron-builder**: Mac `.dmg` (**arm64 only**, matching her M5; onnxruntime-node ships per-arch binaries), Windows NSIS `.exe` (x64). `onnxruntime-node` and the model go in `asarUnpack`/`extraResources` | Uses `mac.identity: "-"` (ad-hoc signature) so macOS offers Open Anyway instead of "damaged". |
| CI/CD | **GitHub Actions** matrix (`macos-latest`, `windows-latest`). Pushing a `v*` tag publishes a GitHub Release. | Yasin has no Mac. |
| Tests | **Vitest** (text pipeline, storage), **Playwright for Electron** (smoke test on both OSes in CI) | See §6.11 |

### 6.2 Process architecture

```
┌──────────────────────── Electron main process ────────────────────────┐
│ window, menus, file dialogs, Open-With handling, library.json,        │
│ powerSaveBlocker while playing, IPC router                            │
└───────┬───────────────────────────────────────────────┬───────────────┘
        │ IPC (typed, via preload contextBridge)        │ MessagePort
┌───────▼────────────────────────┐        ┌─────────────▼──────────────────┐
│ Renderer (React UI)            │        │ TTS utilityProcess (Node)      │
│ • pdf.js render + text layer   │◄──────►│ • kokoro-js + onnxruntime-node │
│ • text pipeline → sentences    │  PCM   │ • priority queue:              │
│ • player: Web Audio, highlight │ chunks │   live playback > preview >    │
│ • Media Session (media keys)   │        │   export                       │
│ • MP3 encode (Web Worker)      │        │ • model loaded once from app   │
└────────────────────────────────┘        │   resources (no network)       │
                                          └────────────────────────────────┘
```

- Renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a narrow
  preload API. Set `backgroundThrottling: false` so playback timers keep running when hidden.
- TTS runs in an Electron **utilityProcess**, so synthesis never freezes the UI.
- The model is bundled via `extraResources`. transformers.js is configured with `allowRemoteModels = false`
  and a local model path, so the app **cannot** reach the network for models.

### 6.3 Text pipeline (the heart of "doesn't read junk")

Runs in a Web Worker, page by page, so opening a 300-page PDF never freezes the UI. Header/footer
detection uses statistics from a sample of up to 20 pages, gathered first. Results are cached in
`userData/cache/` keyed by **fingerprint + pipeline version + reading-settings hash**, so changing a
setting or improving the pipeline never serves stale text.

1. **Extract:** `page.getTextContent()` gives items with position, width, and font height.
2. **Lines:** group items into lines by baseline. Detect two-column pages by an x-gap clustering
   heuristic, and order left column then right column.
3. **Headers/footers/page numbers:** drop lines in the top/bottom ~8% of the page whose
   digit-normalised text repeats on ≥ 3 pages, and lone numbers / "Page N" / roman numerals.
4. **Footnotes:** drop lines in the bottom zone whose font height is < 0.85 × the page's median body
   height. Drop inline superscript reference markers (small, raised digits).
5. **De-hyphenate:** join a line ending in `-` with a next line starting lowercase.
6. **Structural junk** (each is a Reading setting, all **on** by default; a per-reading
   **"Read everything"** in the "…" menu turns every filter off for that reading only):
   - **Stop at References:** speech stops at a heading line matching *References, Bibliography, Works
     Cited, Reference List, Notes* (case-insensitive, standalone heading-sized line) in the last 40% of
     the document. The page view still shows those pages. Playback ends with the normal "Finished" state.
   - **Skip captions and table text:** drop lines starting with *Figure/Fig./Table/Exhibit N* (and their
     continuation lines at the same smaller font size), and text inside detected table regions (dense
     grids of short, column-aligned items).
   - **Skip cover/copyright pages:** pages in the first 3 with ≤ 2 sentences of body text, or containing
     ©/"copyright"/"all rights reserved"/ISBN/"course pack" markers, are skipped.
7. **Citations (setting, default off = skip):** remove parenthetical author-year citations, e.g.
   `(Smith, 2019)`, `(Smith & Jones, 2019, p. 4)`, `(e.g., Lee et al., 2020; Kim, 2021)`, and numeric
   brackets like `[12]` / `[3–5]`.
8. **Sentences:** `Intl.Segmenter('en', { granularity: 'sentence' })`, plus merge rules for
   abbreviations (e.g., i.e., et al., p., pp., Fig., vs., Dr.). Each sentence keeps
   **(page, list of text-item ranges)** for highlighting.
9. **Pronunciation fixes:** whole-word, case-insensitive replacement with her respelling, applied
   just before synthesis (display text is unchanged).
10. **Long sentences:** Kokoro accepts at most ~510 phoneme tokens per call. Sentences over ~400 tokens
   are split for *speaking* at `;`, `:`, `,` (then at word boundaries as a last resort) and played back to
   back. The *highlight* still covers the whole sentence.

Pages with no extractable text show "This page has no readable text" and playback skips them.

### 6.4 Playback and highlighting

- **Unit of speech = one sentence.** The renderer asks the TTS process for sentence *n* and prefetches
  *n+1…n+3*. Audio comes back as 24 kHz PCM. The renderer wraps it as a WAV blob URL and plays it
  through **one `<audio>` element**, swapping the source on `ended`. A real media element is what makes
  Chromium's Media Session (media keys, Now Playing) work. Pure Web Audio may not register. Sentences
  already end in a natural pause, so the source swap is inaudible. Blob URLs are revoked once played.
  *(Verify in spike M0a: media keys + Now Playing on macOS.)*
- **Highlight:** while sentence *n* plays, draw translucent rectangles over its text-item ranges
  (overlay layer on the page canvas). The page auto-scrolls to keep it in view, unless she has scrolled
  away in the last few seconds.
- **Speed:** Kokoro's native `speed` parameter (natural, not chipmunk). Changing speed or voice
  discards prefetched audio and re-synthesises from the current sentence.
- **Skip ±15s:** maps to sentence boundaries using measured sentence durations (estimated for
  sentences not yet synthesised).
- **Resume:** the position is anchored to the PDF's own text, not to a sentence number:
  `{page, textItemIndex, charOffset}` of the current sentence's start. Sentence numbers change whenever
  reading settings or the pipeline change, and the PDF's text items don't. On open, the anchor resolves
  to the sentence containing it. Writes are debounced (at most every 3 s) plus on pause, sleep and quit.
  Clicking a reading opens it at that sentence. Press play to continue (no autoplay on open).
- **Background:** keeps playing when minimised or hidden. On Mac, closing the window **hides** it
  (playback lives in the renderer, so the window must not be destroyed), per Mac convention. Clicking
  the Dock icon shows it again, and Quit stops. `powerSaveBlocker('prevent-app-suspension')`
  runs only while playing. The **Media Session API** gives media keys, headphone buttons and
  Control Centre "Now Playing" (title = reading, artist = course).
- **Sleep timer:** fades out over the last ~5 seconds, then pauses and saves position.

### 6.5 Save as audio

- Scope: the current selection (snapped to whole sentences), a page range, or the whole reading.
- The job runs in the TTS process at **lower priority than live playback**. PCM is encoded to MP3
  (mono, 24 kHz, 64–96 kbps) in a Web Worker and streamed to `<name>.mp3.part`, then renamed on
  success. Cancel or failure deletes the `.part`, so a broken file never appears in her Music folder.
  Name collisions get ` (2)`. Progress shows in the panel, and a
  toast with "Show in Finder" appears when done. Cancelable.
- Default folder `~/Music/Tide/` (Windows: `Music\Tide`), changeable in Settings. ID3 tags:
  title = reading + range, album = course, artist = "Tide · <voice>".
- **Two formats, chosen automatically (she has an iPhone):**
  - **Selection or page range → MP3.** Short and plays anywhere.
  - **Whole reading → audiobook (`.m4b`)**, AAC mono ~64 kbps, with **one chapter per PDF page**
    ("Page 31", or the section heading when one starts on that page) and the course as album. She
    AirDrops it to her iPhone and opens it in **Apple Books**, which remembers her place and shows the
    chapters. The Save panel says this in one line: *"Whole readings save as an audiobook. Open it in
    Books on your iPhone and it remembers your place."* A small "Save as MP3 instead" link covers other players.
  - **How (revised 2026-11-16 during planning):** bundle a static **`ffmpeg`** binary (npm
    `ffmpeg-static`, GPL, compatible with Tide's licence; roughly 40–80 MB) and run it from the main process.
    PCM goes in on stdin, and an FFMETADATA file supplies the chapters. Output is AAC-LC mono 64 kbps `.m4b`
    with a QuickTime chapter track, which is the chapter format Apple's AVFoundation (and so Apple Books) reads.
    *Why not WebCodecs:* the only maintained JS MP4 muxer (mediabunny 1.66) has no MP4 chapter writing
    (checked in its source), and hand-writing chapter tracks is risky with no Mac to test on. **Spike M0d**
    proves chapters with an **AVFoundation check on the macOS runner** (`swift` script reading
    `AVAsset.chapterMetadataGroups`). That's the same parser family Apple Books uses, so it's verified without owning a Mac.
  - **MP3:** MP3 also goes through the bundled ffmpeg (libmp3lame), confirmed present on macOS and
    Windows in M0d.
- **Getting files to her iPhone** goes in her guide: Finder → right-click the file → Share → AirDrop →
  her iPhone. `.m4b` opens in Books and `.mp3` opens in Files.

### 6.6 Library and files

- **library.json:** courses, readings `{id, title, course, path, fingerprint, pageCount, position,
  addedAt, lastOpenedAt, finished}`, settings, pronunciations, and the last voice and speed.
- **Fingerprint** = file size + SHA-256 of the first 256 KB. If a PDF she opens via Open With matches
  an existing fingerprint at a new path, update the path silently, so a moved file "heals" on its own.
- **Missing file:** on open, or a cheap existence check on launch, mark it "File moved · Find it".
  Find shows a file picker and checks the fingerprint. If it doesn't match, ask "This looks like a
  different file. Use it anyway?" and reset the position if she says yes.
- **Title:** the PDF's metadata title if it looks sane, otherwise the file name cleaned up (underscores
  become spaces, `.pdf` dropped). She can rename it from the reading's "…" menu.
- **Open With / file association:** electron-builder `fileAssociations` for `.pdf` (role: Viewer,
  *not* default). Handle macOS `open-file` (registered before `ready`, queued until the window
  exists) and Windows `argv` / `second-instance`. Single-instance lock.
- **macOS privacy prompts:** re-opening a file from Downloads/Documents on a later launch may trigger
  a one-time "Tide would like to access files in your Downloads folder" prompt. This is expected and
  documented in her guide.

### 6.7 Voices

- Ship a **curated set of ~6–8 Kokoro voices**. The candidates are af_heart, af_bella, af_nicole,
  bf_emma, bf_isabella, am_michael, bm_george and am_liam. **Yasin picks** the final list and the
  default after a listening test: during M0, a script renders the same paragraph from one of her
  readings in ~12 candidate voices (q8 and fp32) as audio files for him to compare. Each chosen
  voice gets a friendly name and a one-line description ("Warm, gentle").
- **Default: Heart** (af_heart, Kokoro's highest-rated voice) until Yasin chooses otherwise.
- **Preview:** a fixed sample sentence per voice, pre-rendered at build time and bundled, so it
  plays instantly.
- Model precision: start with `q8` (~92 MB). Switch to fp32 (~326 MB) only if the listening test
  finds q8 noticeably worse.
- **Where files come from (verified in kokoro-js 1.2.1 source):**
  - Voice `.bin` files ship *inside* the `kokoro-js` npm package (`node_modules/kokoro-js/voices/`, 28 MB, all
    voices), and in Node they're read from disk relative to the package. So `kokoro-js` must **not** be bundled
    by Vite: it stays an external dependency so that relative path survives packaging. Unused voices can be pruned
    at packaging time.
  - The model and tokenizer load through transformers.js from a pinned local copy: repo
    `onnx-community/Kokoro-82M-v1.0-ONNX` @ revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`.
- **Silent truncation:** kokoro-js tokenizes with `truncation: true`, so over-long input is *silently
  cut off*, not rejected. The long-sentence split (§6.3 #10) is therefore mandatory. A test asserts
  every chunk is ≤ 400 tokens.

### 6.8 Themes

- All colours are CSS custom properties (tokens) on `:root[data-theme=…]`, taken from the
  approved mockup: Sky & Sea, Deep Sea, and Pixel Quest. "Match my Mac" follows
  `nativeTheme.shouldUseDarkColors`.
- **Dark pages:** in dark themes, apply a CSS filter (invert + hue-rotate) to the PDF canvas, with the
  highlight overlay drawn *above* the filter. There's a Settings toggle to turn it off.
- **Pixel Quest:** pixel font for labels/headings only, and reading text stays in a readable font.
  The sentence being read is mirrored in an RPG-style dialogue box above the player. Course "type"
  badges, pixel waves and an original mascot. **No Nintendo IP.**
- **Kitty** (alternative theme, approved 2026-11-16; mockup [`docs/design/kitty-theme.html`](../../design/kitty-theme.html)):
  - **Look:** pastel cream, blush and peach, with an original ginger-tabby kitten mascot, **Mochi**.
  - **Controls:**
    - The play/pause button is a paw pad.
    - The progress bar is a yarn thread unrolling to a yarn ball at the current position.
    - "Add reading" and primary buttons have cat-ear tips, and course labels have paw prints.
    - The sleep timer is labelled **"Nap timer"** with a curled-up kitten.
    - Each voice in the picker gets a differently tinted kitten avatar.
  - **Mochi:** peeks over the player bar while it plays, and sits in a cardboard box on the empty shelf.
  - **Copy:** light, playful and short ("Purring along", "File wandered off · Find it") and never
    replaces the plain meaning.
  - **Fonts:** Fredoka for headings and buttons, Nunito for UI, and the reading text stays the PDF's own.
  - **No Sanrio/Hello Kitty IP:** no bow-on-one-ear, no mouthless white cat.
- Respect `prefers-reduced-motion` (no blinking cursor, animated waves or Mochi animation).

### 6.9 Data, privacy and error logging

Unexpected errors are written to a rotating log file in `userData/logs/` (never shown raw to her; see
§5.3 for what she sees). Settings has a "Copy diagnostic info" item so she can send Yasin the log.


Everything stays on her laptop. No telemetry, no network calls. A test asserts that
transformers.js remote model loading is disabled. The smoke test runs with networking blocked.

### 6.11 Testing strategy

- **Golden "spoken text" snapshots (highest-risk path):** for each fixture PDF, the exact text Tide would
  speak, page by page, is committed as a snapshot. Any pipeline change shows up as a readable diff
  (e.g. "page 12 now reads the running header"). Fixtures cover single column, two column, footnotes,
  a course-pack header and footer, citations, hyphenated line breaks, a password-protected PDF and a no-text PDF.
- **Highlight mapping:** for every sentence in the fixtures, the highlight rectangles are non-empty,
  inside the page, and on the lines that contain the sentence's characters.
- **Resume anchor survival:** save a position, flip "read citations" and bump the pipeline version.
  The resumed sentence still contains the anchor.
- **Long-sentence split:** a 120-word sentence is synthesised without error and its chunks rejoin to the original text.
- **Storage:** a corrupted `library.json` falls back to the backup, and migrations run from v1.
- **Packaged smoke (CI, macOS + Windows):** launch the *packaged* app with networking blocked, add a
  fixture via a test-only IPC hook, synthesise one sentence, export a 1-sentence MP3, and check the file
  decodes. This catches "works in dev, silent when packaged" (asar/native-module issues).

### 6.12 Licensing

- Kokoro model and kokoro-js: Apache-2.0. pdf.js: Apache-2.0. Fonts: OFL. ffmpeg (ffmpeg-static builds): GPL; source offer required before public release (see §12).
- Kokoro's phonemizer relies on **eSpeak NG (GPL-3.0)**. To stay clearly compliant while distributing,
  **the Tide repo is licensed GPL-3.0** (it's free and open anyway). Builder: confirm the actual
  dependency tree's licences during the spike.

## 7. Delivery plan (milestones)

**M0. Spikes (de-risk before building UI)**
- (a) kokoro-js inside an Electron utilityProcess, packaged, on the `macos-latest` and `windows-latest`
  runners. Measure model load time and real-time factor per sentence. Target: first audio < 2 s after
  play, synthesis faster than playback at 1×.
- (b) The ad-hoc signed `.dmg` from CI installs and launches on the `macos` runner, after downloading it
  as a release asset so it carries the quarantine flag, as far as a headless runner can check. **The
  real-Mac Open Anyway check is deferred to hand-off** (Yasin has no Mac; see §12).
- (c) The text pipeline on Yasin's copies of her **real readings** (kept in the git-ignored
  `local-fixtures/`): no headers, page numbers, footnotes, captions or references read; sane sentences.
- (d) **Audiobook export:** on the macOS runner, encode AAC with WebCodecs `AudioEncoder` inside Electron,
  mux a `.m4b` with per-page chapters, and verify the chapters are readable (e.g. `ffprobe`/`mp4info` in CI).
  If it fails, switch to the bundled-ffmpeg fallback (§6.5).
- (e) **Voice samples for Yasin:** a script renders one paragraph from her reading in ~12 candidate
  voices (q8 + fp32) to `local-fixtures/voice-samples/`. Yasin picks the final 6–8 voices and the default.

**M1. Skeleton:** electron-vite + React + TS + Tailwind. The CI matrix produces a `.dmg` and an `.exe` on tag.
Playwright smoke test (app launches, opens a fixture PDF) runs on both OSes.

**M2. Library:** Add reading, Open With, course picker, shelf, file-moved flow, library.json.

**M3. Reader:** pdf.js rendering, text pipeline, sentence model, highlight overlay, resume.

**M4. Voice:** TTS utilityProcess, prefetch queue, player bar, speed, voice popover with previews,
Media Session, background playback, sleep timer.

**M5. Save as audio:** selection bubble, Save panel, MP3 export, `.m4b` audiobook export with chapters, progress, toast.

**M6. Settings & themes:** Sky & Sea, Deep Sea, Pixel Quest, Kitty, Match my Mac, dark pages, reading
toggles, pronunciation fixes.

**M7. Ship:** first-launch screen, app icon, the Open Anyway screenshot guide, README, `v1.0.0` release,
and a hand-off session with her.

## 8. Acceptance criteria (v1)

- She installs from the `.dmg` and opens Tide using only the screenshot guide. No Terminal.
- With Wi-Fi off, she can add a reading, play it, change voice/speed, and save an MP3.
- On her sample readings, ≥ 95% of pages have no header, footer or page number read aloud.
  Footnotes, captions, table text and cover/copyright pages are skipped, and speech stops at References.
  With "Read everything" on, all of it is read.
- The highlighted sentence matches the spoken sentence, and the highlight is on the right lines.
- Quit mid-sentence, reopen, click the reading: it is at the same sentence.
- Playback continues with the window minimised or closed (Mac). Media keys work.
- Move a PDF in Finder: the shelf shows "File moved · Find it", and after Find she resumes at her place.
- A 10-page MP3 export completes while she keeps listening, and plays on her iPhone.
- A whole-reading `.m4b` AirDropped to her iPhone opens in Apple Books, shows page chapters, and resumes
  where she stopped.
- Sky & Sea and Deep Sea body text meets WCAG AA contrast (4.5:1). All controls are keyboard reachable
  with visible focus.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Kokoro too slow | Low risk on her M5. Spike M0a measures it on the Apple-chip runner. Prefetch 3 sentences. Slower Windows laptops can fall back to a smaller dtype (`q8f16`). |
| macOS refuses the ad-hoc app ("damaged", no Open Anyway button) | Can't be proven before hand-off (no Mac). Fallback options, **decision deferred by Yasin** (§12): a guided one-time Terminal command (`xattr -dr com.apple.quarantine /Applications/Tide.app`), or an Apple Developer ID ($99/yr) with notarization in CI. |
| No real Mac until hand-off | CI runs the packaged smoke test on Apple-chip runners. Keep the hand-off session long enough to fix first-run issues live. Optional: rent a cloud Mac for a day before hand-off. |
| Header/footnote heuristics fail on some course packs | Test on her real PDFs. Per-reading "Read everything" escape hatch in the "…" menu. |
| Highlight drifts on complex layouts | Sentence → item ranges come from the same extraction, so drift only happens if reading order is wrong. Test two-column fixtures. |
| Big download (~250–350 MB) | Acceptable for a laptop. Mentioned in the guide. |
| "Stop at References" fires too early (e.g. a "Notes" heading mid-chapter) | Only matches in the last 40% of the document and heading-sized lines. "Read everything" escape hatch. Snapshot tests on her readings. |

## 10. Supporting deliverables

1. **README** for Yasin: dev setup, scripts, release process.
2. **Release workflow:** tag `v*`, CI builds both OSes, then a GitHub Release with `.dmg` (Apple chip) and `.exe`.
3. **Fixture PDFs** (redistributable, e.g. open-access papers) for committed tests. Her real readings
   (supplied by Yasin) live in `local-fixtures/`, which is **git-ignored**. They are likely copyrighted
   course material, so they are never committed or uploaded. Local-only snapshot tests run against them when present.
4. **"Opening Tide the first time" guide:** a one-page PDF/HTML with Mac screenshots:
   open the dmg, drag to Applications, double-click, see the warning, then System Settings → Privacy &
   Security → Open Anyway → Open, then the Downloads-access prompt. Screenshots taken on macOS 26 (Tahoe)
   at hand-off. Plus a second page, "Getting audio onto your iPhone": AirDrop, then `.m4b` opens in Books and `.mp3` in Files.

## 11. Left to the builder

Exact component structure, state management (React state/Zustand), IPC message shapes, the
column-detection algorithm, exact heuristic thresholds (tune on fixtures), MP3 bitrate within
the range, and icon artwork (sky/sea wave mark, as in the mockups).

## 12. Decisions log and open questions

**Answered (2026-11-16)**
- Mac: **MacBook Air M5** (Apple chip). Mac build is arm64 only.
- No real Mac available to Yasin. Her readings: Yasin will supply copies (kept git-ignored).
- No deadline. Cut order if ever needed: Kitty & Pixel Quest → pronunciation → Windows polish.
- Junk: stop at References, skip captions/table text and cover/copyright pages, each switchable, plus per-reading "Read everything".
- Phone: **iPhone**, so whole readings export as `.m4b` audiobooks (Apple Books), and selections and ranges as MP3.
- Repo: **public**. Name: **Tide**. Voices: **Yasin picks** from rendered samples during M0.

**Decided by the M0 spikes (2026-11-17)** (details: `docs/spikes/m0-results.md`)
- Gate passed: macOS runner RTF 0.84-0.85, `.m4b` shows 2 chapters in AVFoundation. M0/M1 done.
- **lamejs dropped.** The bundled ffmpeg has libmp3lame on both OSes, so ffmpeg does `.m4b` and `.mp3`.
- Voice default stays **Heart (af_heart)** until Yasin picks.

**Decided in M2/M3 planning (2026-11-17)**
- The library store is hand-rolled (atomic write, rolling backup, schema version) instead of electron-store.
- pdf.js runs in the renderer; `pdfjs-dist` is a bundled devDependency, and its cMaps, fonts, ICC profiles and wasm are copied into the build and served same-origin.
- Windows file association ("Open With") is deferred to M7. The "Open With" tip is macOS only.
- The text cache is deferred: measured text build time per reading is warm 0.23-0.35 s and cold 1.07 s (Node, 26-43 pages), well under the 2 s threshold.
- Resource lists (further reading, websites, audiovisual) are tied to "Stop at References".
- Courses are listed alphabetically, "Other" last.
- Table-of-contents pages are skipped like cover pages; section headings in the body are still read.
- Left and right arrow keys step by sentence until M4, when they become plus or minus 15 seconds.
- Deferred text items (each keeps its golden stable until reviewed against her readings; "Read everything" is the escape meanwhile): multi-letter initials, country abbreviations and the "No." merge; run-in bold headings (needs font weight from pdf.js); citation shapes (multiple years, possessive "et al.", group authors, page-only locators); figure source notes, DOI lines and URL speech; outline numerals and item-spacing artifacts; superscript exponents; rotated pages, U+2010 de-hyphenation, compound-prefix syllable splits and roman-numeral zone titles.

**Decided by Yasin for M4 (2026-11-19)**
- **Voices (10):** af_kore, af_nicole, af_sarah, am_fenrir, am_michael, am_puck, bf_emma, bf_isabella, bm_fable, bm_george. Every other Kokoro voice is pruned at packaging time. Friendly names and one-line descriptions are proposed in the M4+M5 plan for his review.
- **Default voice: bf_emma** (replaces the af_heart placeholder in 6.7).
- **Model precision: fp32** on both OSes. It is about 2.5x faster than q8 on x86 (fixes Windows RTF > 1); the installer grows by about 233 MB.

**Decided during M4 build (2026-11-19 to 2026-11-22)**
- Voice work is renderer-side: one player engine drives a hidden audio element and the reader's current sentence, both ways. The voice engine stays in the main process; a crash restarts it with a toast, and a second failure offers "Restart Tide".
- First clips are cut at a clause comma or semicolon near the start so audio begins sooner; a comma inside a number or time ("1,000", "12:30") is never a split point.
- Space plays and pauses everywhere except text fields, open dialogs, menus and popovers, and buttons in the player bar (those keep their own Space). Left and right arrows skip 15 seconds (this replaces stepping by sentence); clicking a sentence picks it.
- If the sentence list is rebuilt while she is listening (for example Read everything is toggled), playback carries on from the same place.
- The sleep timer's "end of page" option stops exactly at the sentence boundary, fades over five seconds, and is switched off (volume restored) whenever the reading ends or another reading opens.
- When a reading ends, the player offers the next unfinished reading in the same course (a reading whose file has moved is never offered). "Play next" opens it and plays; opening a reading never starts audio by itself. The sticky "Restart Tide" toast is not replaced by later toasts.
- Previews play on their own audio element, so the reading's audio is untouched; a preview stops when she plays, skips or closes the popover.
- A moved or missing file is never offered as Next, and a Play next that fails to open leaves nothing armed.
- Test hygiene: the jsdom renderer tests have a 15 second limit and wait on conditions rather than fixed delays; no push of the feature branch happens before the listening check.

**Decided during M5 build (2026-11-24)** (details: `docs/superpowers/decisions/2026-11-24-m4-m5-rulings.md`)
- Exports use her chosen speed (one of the five), never the Finish in speed (R26).
- A selection counts only the text it actually covers: a selection over a running header or other skipped text offers nothing (R27).
- The Save panel's duration estimates describe the saved file. "Try again" re-sends the export, "Choose another folder" asks for one and saves straight into it, and a second export while one runs says "Tide is still making your last audio." (R28, R30).
- Exports are mono MP3 at 64 kbps; whole readings are `.m4b` with one chapter per page that has text, named `Page N` (R29).
- The implementer runs everything except the push; the controller pushes the feature branch (R31).
- The CI jump limit is the larger of 6 s and twice the same run's first audio; locally 4.5 s (R32).

**Still open**
- If Open Anyway fails on her Mac: guided Terminal step vs paid Apple Developer ID. *Deferred by Yasin to hand-off.*
- **GPL ffmpeg binaries** ship in the installers: handle the source-offer obligation before any public release.
- **Apple Books on a real iPhone** is untested (only the AVFoundation proxy).

---

## DESIGN REVIEW REPORT

*Plan design review, 2026-11-16. Each fix was approved individually by Yasin.*

| Pass | Before → After | What changed |
|---|---|---|
| Information architecture | 7 → 9 | Collapsible courses, "Finished (N)" fold, recency order within a course (§5) |
| Interaction state coverage | 5 → 9 | Full states table: voice warm-up, buffering, broken/locked PDF, no-text, export failure/cancel, engine crash, end of reading → "Next" (§5.3) |
| User journey & emotional arc | 6 → 9 | A new reading opens immediately, with a one-time tip. "Save as audio…" is also in the "…" menu, and end-of-reading offers the next reading (§5, §5.3) |
| AI-slop risk | 8 → 8 | Already specific (sea palette, wave progress, Pixel Quest). Icon artwork left to the builder |
| Design system alignment | 6 → 9 | Token tables for colour, type, spacing, radii and motion (§5.2). Contrast was checked and four colours darkened to pass AA |
| Window size & accessibility | 6 → 8 | Minimum window 900×600, auto-collapsing shelf below 1100 px, keyboard shortcuts, AA contrast verified. Still unspecified: screen-reader announcements (low priority for this user) |
| Unresolved decisions | 7 → 9 | Name (Tide), voices (Yasin picks), iPhone export format and repo visibility decided. Only the Open Anyway fallback is deferred |

**Verdict:** ready to build against. The UI decisions are specific enough that two builders would produce the same screens.

## ENG REVIEW REPORT

*Plan engineering review, 2026-11-16.*

**Architecture as understood:** Electron main (files, library, OS integration) ↔ sandboxed React renderer
(pdf.js, text-pipeline worker, `<audio>` playback, highlight overlay, MP3/M4B encoding) ↔ TTS
`utilityProcess` (kokoro-js + onnxruntime-node, priority queue). The source of truth for the library is
`library.json` (electron-store) in main. Extracted text is a cache keyed by fingerprint + pipeline version + settings.

| # | Issue | Recommendation (applied) | Effort |
|---|---|---|---|
| 1 | Resume stored as a sentence index breaks when settings or the pipeline change | Anchor to `{page, textItemIndex, charOffset}`, debounced writes (§6.4) | small |
| 2 | Media keys / Now Playing may not register with pure Web Audio | One `<audio>` element fed per-sentence WAV blobs. Verified in spike M0a (§6.4) | small |
| 3 | Kokoro's ~510-token limit vs long academic sentences | Split for speech at clause boundaries, highlight the whole sentence (§6.3 #10) | small |
| 4 | Stale text cache, and UI freeze on large PDFs | Cache key includes pipeline version + settings hash. Extraction in a worker, page by page (§6.3) | small |
| 5 | "Works in dev, silent when packaged" (native module in asar, wrong arch) | `asarUnpack` onnxruntime-node, arm64 Mac build, packaged smoke test that actually synthesises with network blocked (§6.1, §6.11) | small |
| 6 | Half-written exports, a corrupt library file, window close killing audio on Mac | `.part` + rename. electron-store + backup. Hide instead of destroy on close (§6.1, §6.4, §6.5) | trivial |
| 7 | Error handling not named per failure class | States table (§5.3), TTS auto-restart, rotating log + "Copy diagnostic info" (§6.9) | small |
| 8 | `.m4b` export depends on WebCodecs AAC + chapter muxing in Electron (unverified) | Spike M0d, with a bundled-ffmpeg fallback (§6.5, §7) | needs spike |

**Highest-risk untested path:** the text pipeline on her real course packs (headers, footnotes,
References cut-off). Covered by golden spoken-text snapshots on committed fixtures plus local-only
snapshots on her readings (§6.11).

**Still open:** the Open Anyway fallback (Terminal step vs Developer ID), deferred to hand-off. There is no
real Mac before hand-off, partly mitigated by Apple-chip CI runners.

**Verdict:** safe to start building. M0 spikes (a, d) must pass before M4/M5 are built on top of them.
