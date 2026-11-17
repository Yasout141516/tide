# Tide M2 + M3: Library and Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After M2 she can add readings (button, ⌘O or Open With), tag them by course, see a tidy shelf that survives restarts, and re-find a moved file. After M3 she can open a reading, see its real pages, see the current sentence highlighted (moved by clicking a sentence or with ← / →; the voice is M4), cleaner text on more layouts, and reopening puts her back on the same sentence.

**Architecture:** Main owns `library.json` (a small hand-rolled atomic JSON store with a rolling backup) and every file path. The sandboxed renderer only ever asks for a reading's bytes by id. pdf.js runs **in the renderer** (its own Web Worker parses; the page canvas and highlight overlay live there), and the existing pure text pipeline runs in a second renderer Web Worker over the same `getTextContent` items, so highlight spans and rendered glyphs come from one parse. Main never imports pdf.js.

**Tech Stack:** Electron 45, electron-vite 6, React 19 + TypeScript (strict), Tailwind CSS 4 (tokens as CSS variables), Radix UI (Dialog, DropdownMenu), @fontsource (Nunito Sans, Fraunces), pdfjs-dist 6.5.438 (modern build in the renderer, legacy build in Node tests/CLI), vite-plugin-static-copy, Vitest (+ jsdom and Testing Library for renderer components), Playwright `_electron`.

**Spec:** [`docs/superpowers/specs/2026-11-16-tide-design.md`](../specs/2026-11-16-tide-design.md). Read §5 (layout, simplicity rules, adding PDFs, shelf, window and keyboard), §5.1 screens 1-3 and 8, §5.2 tokens, §5.3 states, §6.2 security, §6.3 pipeline, §6.4 Resume, §6.6 Library and files, §6.11 tests. Mockups: [`docs/design/screens-sky-sea.html`](../../design/screens-sky-sea.html). Previous plan (interfaces this one builds on): [`2026-11-16-tide-m0-m1-foundation.md`](2026-11-16-tide-m0-m1-foundation.md). Open text issues: [`docs/spikes/m0-results.md`](../../spikes/m0-results.md) "Follow-ups for M2+".

## Global Constraints

- Window: minimum 900×600 (already set). Below **1100 px** wide the shelf collapses behind a **"Shelf"** button; it slides over the page and closes when she picks a reading.
- Simplicity: one primary **"Add reading"** button; clicking a reading opens it at her place; **no autoplay**; every control labelled in words (icon-only buttons are not allowed; the "…" menu button reads **"More"**).
- Shortcuts (Windows uses Ctrl): **⌘O** Add reading, **⌘+ / ⌘−** text size (page zoom **80–200%**, step 10%). Space and ← / → belong to M4's player; in M3 only, **← / →** step one sentence back / forward.
- Tokens: Sky & Sea and Deep Sea colour values **verbatim from spec §5.2** (the Task 1 test lists them), as CSS custom properties on `:root[data-theme=…]`; `<html data-theme="sky-sea">` is the only theme used until M6. Components use tokens only, never raw colours.
- Type: Fraunces 700 for wordmark (21 px), dialog titles (20 px) and empty-state headline (24 px); Nunito Sans 13–15 px / 600–800 for UI; section/course labels 11 px / 800 uppercase, +1 px tracking; reader meta line 10.5 px / 800 uppercase. Fonts bundled (@fontsource), never fetched.
- Shape: 4 px grid; radii 8 (chips), 10–12 (buttons, rows, fields), 16–18 (dialogs, popovers), 999 (pills); every click target ≥ 36 px tall; shadow `rgba(11,88,132,.16)`; motion 150–250 ms ease-out and none under `prefers-reduced-motion`.
- Renderer security unchanged: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP stays exactly `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. pdf.js gets `isEvalSupported: false`. **The renderer never sends a file path to main**; main only opens paths that came from its own dialog, Open With / argv, or `library.json`.
- No network at runtime. pdf.js cMaps, standard fonts, ICC profiles and wasm are bundled same-origin assets.
- `library.json` lives in `app.getPath('userData')`, `schemaVersion: 1`, written atomically (`library.json.tmp` then rename), the previous good file kept as `library.backup.json`. A corrupt file is renamed aside, **never deleted or overwritten with an empty shelf**.
- Library stores **references, not copies**. Fingerprint = file size + SHA-256 of the first **256 KB**, stored as `"<size>:<sha256 hex>"`.
- Resume anchor = `{page, textItemIndex, charOffset}` of the current sentence's first span (spec §6.4). Position writes reach disk **at most every 3 s**, plus a flush on quit.
- Copyright: nothing derived from `local-fixtures/` (her readings) goes into code, tests, fixtures, docs or commit messages. Local-reading checks are reported as **aggregate numbers only** (readings by index, pages, sentences, changed lines). Test PDFs come from `scripts/make-fixtures.ts` with invented text.
- No Pokémon / Nintendo / Sanrio IP anywhere.
- Text pipeline: `PIPELINE_VERSION` goes to **3** (once, Task 11). Golden files in `tests/fixtures/spoken/` are written or changed **by hand** from the sidecar, never generated from the implementation; every changed golden line is explained in the commit message.
- Test-only surface stays behind `TIDE_E2E=1` (accepted risk, `src/main/index.ts`). New in this plan, same gate: `TIDE_USER_DATA` (per-test userData dir) and `window.__tidePdfProbe` (Task 5). Dialog and Open With are stubbed from Playwright's main-process `app.evaluate`, which needs no production hook.
- `pdfjs-dist` stays exact-pinned at 6.5.438 and stays in `devDependencies`: the renderer is Vite-bundled (as React already is), so a `dependencies` entry would ship a second, unused copy in the asar and undo the M0/M1 trim. Installer sizes are measured in CI against the M1 baseline (dmg 246.3 MiB, exe 241.2 MiB).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The same PDF added twice** (Add reading again, or Open With on a copy she moved) must open the existing reading with its place, heal the stored path, and never create a duplicate row. *(Task 3 test `adding a file already on the shelf returns the existing reading and heals its path`.)*
2. **Paths with spaces and non-ASCII characters** (`Wéek 4 – Institutions (final).pdf` in `my readings ü/`), common in student downloads and iCloud/OneDrive folders, must add, fingerprint, read and title correctly. *(Task 3 test `adds, reads and names a file whose path has spaces and non-ASCII characters`; Task 7 e2e uses such a name.)*
3. **A saved place whose sentence no longer exists** (she was inside References with "Read everything" on, then turned it off; or the pipeline changed) must open at the next sentence, or the last one, never at the start and never crash. *(Task 10 tests `falls forward when the anchored text is now skipped` and `an anchor past the last sentence resolves to the last sentence`.)*
4. **A file deleted or moved while Tide is running** must turn into "File moved · Find it" when she clicks it or comes back to the window, not an error. *(Task 3 test `read of a file deleted after launch reports missing and marks the reading missing`; Task 4 test `re-checks missing files when the window gains focus`.)*
5. **A chosen file that is not a PDF, or is empty** (a renamed `.docx`, a 0-byte failed download) shows "Tide can't open this PDF. It may be damaged." and is not added. *(Task 5 test `classifies a non-PDF and an empty file as damaged`; Task 7 test `a file that is not a PDF shows the damaged message and is not added`.)*

---

## File Structure

```
src/shared/library/types.ts        Course, Reading, LibraryFile, snapshot/view, IPC payload types
src/shared/library/shelf.ts        groupShelf, rowLabel (pure)
src/shared/library/title.ts        readingTitle (pure)
src/shared/text/page-text.ts       pageTextFromContent: pdf.js text items → PageText (pure; Node + renderer)
src/shared/text/pdf-errors.ts      classifyPdfError
src/shared/text/anchor.ts          Anchor, anchorOf, resolveAnchor
src/shared/text/highlight.ts       spanRects, sentenceAt (pure geometry)
src/shared/text/{lines,filters,spoken,sentences,pipeline,extract}.ts   modified (Tasks 5, 11-13)
src/main/library/schema.ts         SCHEMA_VERSION, emptyLibrary, parseLibrary (validate + migrate)
src/main/library/store.ts          LibraryStore: load with backup fallback, debounced atomic writes
src/main/library/fingerprint.ts    fingerprint(path)
src/main/library/library.ts        Library: picks, add, read, relink, update, remove, missing checks
src/main/library/ipc.ts            registerLibraryIpc + payload validation
src/main/open-with.ts              filesFromArgv, OpenWithQueue
src/main/menu.ts                   buildMenu (File: Add reading; View: text size; Edit/Window roles; Help)
src/main/index.ts                  wiring: userData hook, single-instance lock, open-file, quit flush
src/preload/index.ts, index.d.ts   window.tide.library / onCommand / ready / platform
src/renderer/index.html            data-theme="sky-sea"
src/renderer/src/assets/tokens.css Sky & Sea + Deep Sea tokens; main.css maps them into Tailwind @theme
src/renderer/src/lib/tide.ts       typed access to window.tide (swappable in tests)
src/renderer/src/state/useLibrary.ts   snapshot subscription
src/renderer/src/shell/            AppShell, Wordmark, PlayerBarPlaceholder, useMediaQuery
src/renderer/src/shelf/            Shelf, ShelfRow, EmptyState
src/renderer/src/add/              useAddReading, CoursePicker, MessageDialog
src/renderer/src/reading/          ReaderHeader, ReadingMenu, FileMovedDialog, RenameDialog
src/renderer/src/reader/           pdf.ts, pipeline-client.ts, pipeline.worker.ts, ReaderView, PdfPage,
                                   HighlightLayer, PasswordDialog, deps.tsx (ReaderDeps context), renderWindow.ts
electron.vite.config.ts            static-copy of pdf.js assets; renderer worker format
electron-builder.yml               mac.fileAssociations
scripts/make-fixtures.ts           + locked.pdf, not-a-pdf.pdf, layout.pdf, tables-lists.pdf, sentence-edges.pdf
tests/unit/library/*.test.ts       store, library, ipc
tests/unit/text/*.test.ts          + page-text, anchor, highlight; existing suites extended
tests/renderer/*.test.tsx          jsdom component tests; setup.ts with fakeTide()
tests/e2e/library.spec.ts          M2 happy path, Open With, File moved
tests/e2e/reader.spec.ts           M3 happy path, restart restores place
```

---

## M2: Library

### Task 1: Tokens, fonts, app shell and component-test setup

**Files:**
- Create: `src/renderer/src/assets/tokens.css`, `src/renderer/src/shell/AppShell.tsx`, `src/renderer/src/shell/Wordmark.tsx`, `src/renderer/src/shell/PlayerBarPlaceholder.tsx`, `src/renderer/src/shell/useMediaQuery.ts`, `tests/unit/tokens.test.ts`, `tests/renderer/setup.ts`, `tests/renderer/app-shell.test.tsx`
- Modify: `src/renderer/index.html` (`<html data-theme="sky-sea">`), `src/renderer/src/assets/main.css`, `src/renderer/src/main.tsx` (font imports), `src/renderer/src/App.tsx`, `vitest.config.ts` (include `tests/renderer/**/*.test.tsx`, `setupFiles` for those), `tsconfig.web.json` (include `tests/renderer/**/*`), `tests/e2e/smoke.spec.ts`, `package.json`

**Interfaces:**
- Produces: tokens as CSS variables (names as spec §5.2 without change, plus mockup-only `--primary-deep`, `--page-meta`, `--scrim`, `--shadow`) and Tailwind colour utilities generated from them through `@theme inline { --color-bg: var(--bg); … }` (so `bg-surface`, `text-ink`, `border-border`, …).
- Produces: `AppShell(props: { shelf: ReactNode; stage: ReactNode; player: ReactNode }): JSX.Element` and `useMediaQuery(query: string): boolean`. Narrow = `(max-width: 1099px)`.
- Produces (tests): `tests/renderer/setup.ts` with jsdom stubs for `matchMedia` (driven by a `setNarrow(on: boolean)` helper) and `ResizeObserver`. Task 4 adds `fakeTide()` to it.

- [ ] **Step 1: Add dev dependencies** (exact-pin the versions npm resolves): `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@fontsource/nunito-sans`, `@fontsource/fraunces`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`. All are renderer build-time deps, so all go in `devDependencies`.
- [ ] **Step 2: Write the failing tests.**

```ts
// tests/unit/tokens.test.ts  (node env: parses tokens.css text)
const SKY = { bg:'#F2F9FF', 'shelf-a':'#DDEFFC', 'shelf-b':'#EAF5FE', surface:'#FFFFFF', ink:'#12324A',
  muted:'#4F6A82', primary:'#0F6FA8', 'on-primary':'#FFFFFF', soft:'#E3F2FD', 'soft-ink':'#0B5884',
  border:'#C9E6FA', 'stage-a':'#CFE8FA', 'stage-b':'#E6F3FD', 'stage-c':'#F2F9FF', page:'#FFFFFF',
  'page-ink':'#1D2B36', hl:'#CDEBFF', 'hl-line':'#1E88C7', sel:'rgba(91,182,236,.28)', 'wave-off':'#C9E6FA',
  'wave-on':'#1E88C7', warn:'#B4532A', 'warn-soft':'#FDEEE6', ok:'#1B7F5B', bubble:'#0A2E45',
  'primary-deep':'#0B5884', 'page-meta':'#0F6FA8', scrim:'rgba(10,46,69,.32)', shadow:'rgba(11,88,132,.16)' }
const DEEP = { bg:'#0B1D2C', 'shelf-a':'#0A1826', 'shelf-b':'#0D2134', surface:'#11293D', ink:'#E4F1FA',
  muted:'#8EA9BF', primary:'#4FB0E8', 'on-primary':'#06192A', soft:'#163650', 'soft-ink':'#A9DAF7',
  border:'#1C3A54', 'stage-a':'#0E2A40', 'stage-b':'#0C2236', 'stage-c':'#0B1D2C', page:'#132B3E',
  'page-ink':'#D7E4EE', hl:'rgba(79,176,232,.30)', 'hl-line':'#6CC3F2', sel:'rgba(108,195,242,.22)',
  'wave-off':'#1C3A54', 'wave-on':'#6CC3F2', warn:'#F0A07A', 'warn-soft':'#3A2620', ok:'#5FD3A3',
  bubble:'#E4F1FA', 'primary-deep':'#2E8FC8', 'page-meta':'#6CC3F2', scrim:'rgba(2,10,18,.55)', shadow:'rgba(0,0,0,.45)' }
// block(theme): parses the `:root[data-theme='<theme>'] { … }` rule of tokens.css into { name: value }, lowercased, spaces stripped
it('Sky & Sea tokens match spec 5.2', () => expect(block("sky-sea")).toEqual(SKY))   // SKY/DEEP values lowercased the same way
it('Deep Sea tokens match spec 5.2', () => expect(block("deep-sea")).toEqual(DEEP))
```

```tsx
// tests/renderer/app-shell.test.tsx   (// @vitest-environment jsdom)
it('wide window: shelf is visible beside the stage, no Shelf button')            // matchMedia → false
it('narrow window: shelf hides behind a "Shelf" button that opens it over the page')
it('narrow window: the overlay closes on Escape and when the shelf calls onPicked') // AppShell passes onPicked to shelf
it('the wordmark is a level-1 heading "Tide"')
```

- [ ] **Step 3: Run** `npx vitest run tests/unit/tokens.test.ts tests/renderer` and see them FAIL.
- [ ] **Step 4: Implement.**
  - `tokens.css`: the two blocks; `body` uses `--bg`/`--ink`, Nunito Sans, and `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { transition:none!important; animation:none!important } }`.
  - `AppShell`: CSS grid `240px 1fr` / `1fr auto` like the mockup's `.app`. Shelf column has the `--shelf-a → --shelf-b` gradient and a right border. The stage has the `--stage-a/b/c` gradient. The player row spans the stage column only.
  - Narrow mode: the shelf is a Radix `Dialog` sliding from the left (250 ms, none under reduced motion), triggered by a soft button labelled "Shelf" at the stage's top-left.
  - `Wordmark`: the mockup's wave-and-sun SVG plus "Tide" in an `<h1>` (Fraunces 21 px, `--primary-deep`).
  - `PlayerBarPlaceholder`: a `<footer aria-label="Player">` on `--surface` with a top border, holding the mockup's wave line (off colour only) and a label slot. No buttons until M4.
  - `smoke.spec.ts` "window opens titled Tide" now asserts `getByRole('heading', { level: 1, name: 'Tide' })`; plain `getByText('Tide')` would match several elements.
- [ ] **Step 5: Verify.** `npm run typecheck && npm test` should PASS, and `npm run build && npm run e2e -- -g "titled Tide"` should PASS.
- [ ] **Step 6: Commit.** `feat(ui): Sky & Sea tokens, bundled fonts and the classic app shell`.

---

### Task 2: library.json store with atomic writes and backup

**Files:**
- Create: `src/shared/library/types.ts`, `src/main/library/schema.ts`, `src/main/library/store.ts`, `tests/unit/library/store.test.ts`

**Interfaces:**
- Produces (`src/shared/library/types.ts`):
  ```ts
  import type { Anchor } from '../text/anchor'            // type defined in Task 10; create anchor.ts now with only the type
  import type { ReadingFilters } from '../text/types'
  export type ReadingId = string; export type CourseId = string
  export const OTHER = 'other'                            // shelf group key for readings without a course
  export interface Course { id: CourseId; name: string }
  export interface Reading { id: ReadingId; title: string; courseId: CourseId | null; path: string; fingerprint: string
    pageCount: number | null; position: Anchor | null; addedAt: number; lastOpenedAt: number | null
    finished: boolean; readEverything: boolean }
  export interface LibrarySettings { reading: ReadingFilters; zoom: number }      // zoom 0.8–2.0, default 1
  export interface LibraryUi { collapsed: string[] }                               // CourseIds and/or OTHER
  export interface LibraryFile { schemaVersion: 1; courses: Course[]; readings: Reading[]; settings: LibrarySettings; ui: LibraryUi }
  export interface ReadingView extends Omit<Reading, 'path' | 'fingerprint'> { fileName: string; missing: boolean }
  export interface LibrarySnapshot { courses: Course[]; readings: ReadingView[]; settings: LibrarySettings; ui: LibraryUi }
  export type PickResult = { kind: 'cancelled' } | { kind: 'existing'; readingId: ReadingId } | { kind: 'new'; pickId: string; fileName: string }
  export type PdfRef = { readingId: ReadingId } | { pickId: string }
  export type ReadPdfResult = { ok: true; data: Uint8Array } | { ok: false; reason: 'missing' | 'unreadable' }
  export interface AddReadingInput { pickId: string; title: string; pageCount: number | null
    course: { id: CourseId } | { newName: string } | null }
  export interface ReadingPatch { title?: string; position?: Anchor; readEverything?: boolean; opened?: true; pageCount?: number; finished?: boolean }
  export type RelinkResult = { kind: 'cancelled' } | { kind: 'relinked' } | { kind: 'different'; pickId: string; fileName: string }
  ```
- Produces (`schema.ts`): `SCHEMA_VERSION = 1`, `emptyLibrary(): LibraryFile` (settings `{ reading: DEFAULT_FILTERS, zoom: 1 }`), `parseLibrary(raw: unknown): LibraryFile | null`. It validates every field's type, fills defaults for optional fields missing in older v1 files (`settings`, `ui`, `readEverything: false`, `finished: false`), runs `MIGRATIONS[v]` for `v < SCHEMA_VERSION` (empty today), and returns `null` for invalid input **or a newer `schemaVersion`**.
- Produces (`store.ts`): `class LibraryStore { static open(dir: string, opts?: { debounceMs?: number }): Promise<LibraryStore>; readonly loadedFrom: 'library' | 'backup' | 'new'; data(): LibraryFile; update(mutate: (d: LibraryFile) => void, opts?: { urgent?: boolean }): void; flush(): Promise<void> }`. Default `debounceMs` 3000.

**Load and write rules** (the tests pin them):
- **Load:** try `library.json`, then `library.backup.json`, through `parseLibrary`. If `library.json` exists but is rejected, rename it to `library.corrupt-<Date.now()>.json` first. If both are rejected, start empty (`loadedFrom: 'new'`) and leave the backup untouched.
- **Write:** writes are serialized through one promise chain, debounced by `debounceMs`; `urgent` writes now. Each write:
  1. writes `library.json.tmp` (`writeFile(..., { flush: true })`);
  2. if `library.json` exists, copies it over `library.backup.json`;
  3. renames the tmp file onto `library.json`, retrying `EPERM`/`EBUSY`/`EACCES` up to 5 times, 50 ms apart (Windows antivirus).

- [ ] **Step 1: Write the failing tests** (real temp dirs, `debounceMs: 30`):

```ts
it('starts empty and writes nothing until the first update')                // loadedFrom 'new', no files
it('round-trips a library through disk')
it('keeps the previous good file as library.backup.json')                   // 2 urgent updates → backup = 1st
it('falls back to the backup when library.json is corrupt, and keeps the corrupt file')
  // write '{"schemaVersion":1,"cour' → loadedFrom 'backup', data = backup, a library.corrupt-*.json exists
it('starts empty but deletes nothing when both files are unreadable')
it('fills defaults for fields missing in a v1 file')                        // no settings/ui/readEverything
it('rejects a file written by a newer Tide')                                // schemaVersion 2 → null
it('debounces writes and flush() writes now')                               // 10 updates: disk unchanged; flush → latest
it('urgent writes reach disk without flush')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/library/store.test.ts` and see them FAIL.
- [ ] **Step 3: Implement** `types.ts`, a type-only `src/shared/text/anchor.ts` (`export interface Anchor { page: number; textItemIndex: number; charOffset: number }`), `schema.ts` and `store.ts`.
- [ ] **Step 4: Verify.** The tests PASS, and so does `npm run typecheck`.
- [ ] **Step 5: Commit.** `feat(library): library.json store with atomic writes, backup fallback and schema v1`.

---

### Task 3: Library service: fingerprints, picks, add, read, relink, missing files

**Files:**
- Create: `src/main/library/fingerprint.ts`, `src/main/library/library.ts`, `tests/unit/library/library.test.ts`

**Interfaces:**
- Consumes: `LibraryStore`, the types from Task 2.
- Produces: `fingerprint(path: string): Promise<string>`, which returns `"<size>:<sha256 of bytes 0..min(size, 262144)>"`.
- Produces (no Electron imports, so it unit-tests in Node):
  ```ts
  class Library {
    static open(dir: string, opts?: { now?: () => number; newId?: () => string; debounceMs?: number }): Promise<Library>
    snapshot(): LibrarySnapshot                       // readings carry fileName = basename(path) and missing
    onChange(cb: () => void): () => void
    pick(path: string): Promise<Exclude<PickResult, { kind: 'cancelled' }>>
    read(ref: PdfRef): Promise<ReadPdfResult>
    add(input: AddReadingInput): ReadingId            // throws Error('unknown pick') for a stale pickId
    update(id: ReadingId, patch: ReadingPatch): void
    remove(id: ReadingId): void
    relink(id: ReadingId, path: string): Promise<Exclude<RelinkResult, { kind: 'cancelled' }>>
    useDifferentFile(id: ReadingId, pickId: string): void
    setCollapsed(key: string, collapsed: boolean): void
    setZoom(zoom: number): void
    checkMissing(): Promise<void>
    flush(): Promise<void>
  }
  ```

**Rules:**
- **`pick`:** fingerprints the file. If a reading has that fingerprint, it updates that reading's `path` (urgent write), clears `missing`, and returns `existing`. Otherwise it stores a pending pick `{path, fingerprint}` in memory (at most 20; the oldest is dropped) and returns `new`.
- **`add`:**
  - `course.newName` is trimmed (1–40 chars). It reuses a course whose name matches case-insensitively, else creates one with `newId()`. `null` means Other.
  - The reading gets `addedAt: now()`, `position: null`, `lastOpenedAt: null`, `finished: false` and `readEverything: false`.
  - The write is urgent.
- **`read`:**
  - Returns `missing` for ENOENT (and marks the reading missing, emitting a change), and `unreadable` for any other fs error.
  - Main reads the whole file (`fs.readFile`) and returns it as a `Uint8Array`.
- **`update`:**
  - `opened` sets `lastOpenedAt = now()`. `title` is trimmed and ignored when empty or over 200 chars.
  - Only `position` updates are non-urgent (debounced); everything else is urgent.
  - An unknown id is a no-op.
- **`remove`:** a course left with no readings is deleted, and its id is removed from `ui.collapsed`.
- **`relink`:**
  - A matching fingerprint updates `path` and returns `relinked`; the place is kept.
  - Otherwise it registers a pending pick and returns `different`.
  - `useDifferentFile` then sets `path` and `fingerprint` from the pick, and resets `position: null`, `finished: false`, `pageCount: null`.
- **`checkMissing`:** runs `fs.access` on every path in parallel and emits a change only when the missing set changed.

- [ ] **Step 1: Write the failing tests** (temp dirs; files made from `tests/fixtures/pdfs/single-column.pdf` bytes, plus a 300 KB generated file for the fingerprint test):

```ts
it('fingerprint is size plus sha256 of the first 256 KB')
  // /^\d+:[0-9a-f]{64}$/; a byte changed at 280 KB keeps it; a byte at 100 KB or a different size changes it
it('pick of a new file returns a pick with its file name')
it('adding a file already on the shelf returns the existing reading and heals its path')
  // add from A; set a position; copy to B, delete A; pick(B) → {kind:'existing', id}; store path = B; position kept; 1 reading
it('adds, reads and names a file whose path has spaces and non-ASCII characters')
  // dir 'my readings ü', file 'Wéek 4 – Institutions (final).pdf' → fileName exact, read ok bytes equal
it('add creates a course from a new name, reuses one with the same name ignoring case, and null is Other')
it('read of a file deleted after launch reports missing and marks the reading missing')   // emits onChange
it('checkMissing marks moved files and clears ones that are back')
it('relink with the same file keeps the place; a different file needs useDifferentFile, which resets it')
it('remove deletes the reading, and an emptied course disappears with its collapsed state')
it('update: opened stamps lastOpenedAt, empty titles are ignored, unknown ids are a no-op')
it('add with an unknown pick throws')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/library/library.test.ts` and see them FAIL.
- [ ] **Step 3: Implement** `fingerprint.ts` (stream at most 262144 bytes into `createHash('sha256')`, size from `stat`) and `library.ts`.
- [ ] **Step 4: Verify.** The tests PASS.
- [ ] **Step 5: Commit.** `feat(library): reference-based library with fingerprints, dedupe, relink and missing-file checks`.

---

### Task 4: Library IPC, preload API, userData test hook and quit flush

**Files:**
- Create: `src/main/library/ipc.ts`, `tests/unit/library/ipc.test.ts`, `src/renderer/src/lib/tide.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/shared/ipc-types.ts`, `tests/e2e/launch.ts`

**Interfaces:**
- Produces (`src/shared/ipc-types.ts`): `type AppCommand = { type: 'add-reading' } | { type: 'zoom'; step: 1 | -1 } | { type: 'open-pick'; pick: Exclude<PickResult, { kind: 'cancelled' }> }`.
- Produces (preload, typed in `index.d.ts`, exported as `TideApi`):
  ```ts
  window.tide.platform: string                                // process.platform
  window.tide.ready(): void                                   // renderer mounted; main may now send queued commands
  window.tide.onCommand(cb: (c: AppCommand) => void): () => void
  window.tide.library: { get(): Promise<LibrarySnapshot>; onChanged(cb: (s: LibrarySnapshot) => void): () => void
    pickPdf(): Promise<PickResult>; readPdf(ref: PdfRef): Promise<ReadPdfResult>; add(i: AddReadingInput): Promise<ReadingId>
    update(id: ReadingId, p: ReadingPatch): Promise<void>; remove(id: ReadingId): Promise<void>
    findFile(id: ReadingId): Promise<RelinkResult>; useDifferentFile(id: ReadingId, pickId: string): Promise<void>
    setCollapsed(key: string, collapsed: boolean): Promise<void>; setZoom(zoom: number): Promise<void> }
  ```
  Channels: `library:get|pick|read|add|update|remove|find|use-different|collapse|zoom`, events `library:changed` and `app:command`, plus `app:ready`.
- Produces (main): `registerLibraryIpc(lib: Library, o: { window: () => BrowserWindow | null }): { send(cmd: AppCommand): void }`. `send` queues commands until `app:ready` has arrived.
- Produces (renderer): `tide(): TideApi` and `setTide(api: TideApi)` in `src/renderer/src/lib/tide.ts`. Components never touch `window.tide` directly.
- Produces (tests): `fakeTide(init?: { snapshot?: Partial<LibrarySnapshot>; platform?: string }): TideApi & { emit(c: AppCommand): void; calls: Record<string, unknown[][]> }` in `tests/renderer/setup.ts`. It is an in-memory fake whose `library.*` methods are `vi.fn`s that update the snapshot and fire `onChanged`; tests install it with `setTide()`.

- [ ] **Step 1: Write the failing tests** (mock `electron` the same way `tests/unit/ipc.test.ts` does; `dialog.showOpenDialog` is a `vi.fn`):

```ts
it('library:pick shows a PDF-only open dialog and returns cancelled when she cancels')
  // filters [{ name: 'PDF', extensions: ['pdf'] }], properties ['openFile']
it('library:pick passes the chosen path to Library.pick')
it('library:find titles the dialog with the reading title and relinks')
it('library:update rejects unknown keys and wrong types')
  // {colour:1}; {position:{page:0,…}}; {position:{page:1.5,…}}; {title: 5}; {pageCount:-1}
it('library:read rejects a ref that is neither {readingId} nor {pickId}')
it('library:zoom rejects values outside 0.8–2')
it('commands sent before app:ready are delivered in order after it')
it('re-checks missing files when the window gains focus, at most every 5 s')
```

- [ ] **Step 2: Run** the tests and see them FAIL.
- [ ] **Step 3: Implement `ipc.ts`.**
  - Every handler validates its arguments and throws `Error('<channel> expects …')` on bad input, like `tts:synthesize`.
  - Call `dialog.showOpenDialog` **through the `dialog` object at call time**, so e2e can replace it from `app.evaluate`.
  - After every mutation, broadcast `library:changed` with `lib.snapshot()` (subscribe once via `lib.onChange`).
  - On `browser-window-focus`, run `lib.checkMissing()`, throttled to once per 5 s.
- [ ] **Step 4: Wire `index.ts`.**
  - The first statements after imports: `if (e2e && process.env.TIDE_USER_DATA) app.setPath('userData', process.env.TIDE_USER_DATA)`.
  - Then `Library.open(app.getPath('userData'))` inside `whenReady`, before the window loads, then `checkMissing()` once.
  - `before-quit`: unless already flushed, `e.preventDefault()`, `await lib.flush()`, set the flag, `app.quit()`.
- [ ] **Step 5: Change `launchTide`** so it defaults `TIDE_USER_DATA` to a fresh `mkdtemp` dir unless the caller passes one. Tests that restart pass the same dir twice.
- [ ] **Step 6: Verify.** `npm test` should PASS, and `npm run build && npm run e2e` should still PASS.
- [ ] **Step 7: Commit.** `feat(library): typed library IPC and preload API, per-test userData and flush on quit`.

---

### Task 5: pdf.js in the renderer: shared page text, error classes, packaged probe

**Files:**
- Create: `src/shared/text/page-text.ts`, `src/shared/text/pdf-errors.ts`, `src/renderer/src/reader/pdf.ts`, `tests/unit/text/page-text.test.ts`, `tests/e2e/pdf-probe.spec.ts`
- Modify: `src/shared/text/extract.ts` (use `pageTextFromContent`; add `password?: string`), `scripts/make-fixtures.ts` (+ `locked.pdf`, `not-a-pdf.pdf`, both without sidecars), `electron.vite.config.ts`, `src/renderer/src/main.tsx` (probe), `package.json` (`vite-plugin-static-copy`)

**Interfaces:**
- Produces: `interface RawTextItem { str?: string; transform: number[]; width: number; height: number }` and `pageTextFromContent(page: number, view: number[], items: RawTextItem[]): PageText`. This is exactly the per-item mapping `extractPages` does today (skip `str === ''`, keep `index`, top-origin `y`, `fontSize = hypot(c, d) || height`), moved so Node and the renderer share it.
- Produces: `type PdfOpenFailure = 'needs-password' | 'wrong-password' | 'damaged'` and `classifyPdfError(err: unknown): PdfOpenFailure`. A pdf.js `PasswordException` with `code` 1 is `needs-password` and code 2 is `wrong-password`; everything else is `damaged`.
- Produces: `extractPages(data: Uint8Array, password?: string): Promise<PageText[]>` (Node, unchanged otherwise).
- Produces (renderer `reader/pdf.ts`):
  ```ts
  export interface PdfDoc { numPages: number; metaTitle: string | undefined
    pageSize(n: number): Promise<{ width: number; height: number }>          // PDF points, rotation ignored
    pageText(n: number): Promise<PageText>                                  // getTextContent({ disableNormalization: true }) → pageTextFromContent
    render(n: number, canvas: HTMLCanvasElement, scale: number, signal: AbortSignal): Promise<void>
    destroy(): Promise<void> }
  export type OpenPdfResult = { kind: 'ok'; doc: PdfDoc } | { kind: PdfOpenFailure }
  export function openPdf(data: Uint8Array, password?: string): Promise<OpenPdfResult>
  ```
  `GlobalWorkerOptions.workerSrc` is `pdfjs-dist/build/pdf.worker.min.mjs?url`. `getDocument` gets `{ data, password, isEvalSupported: false, cMapUrl, cMapPacked: true, standardFontDataUrl, iccUrl, wasmUrl }`, each URL being `new URL('pdfjs/<dir>/', document.baseURI).href`.

- [ ] **Step 1: Write the fixture generators.**
  - **`not-a-pdf.pdf`** holds the bytes of the sentence "This file is not a PDF."
  - **`locked.pdf`** is a hand-built one-page PDF: Helvetica, content "Locked fixture text.", Standard Security Handler **V1 R2 (RC4 40-bit)**, user password `tide`, owner password `owner`.
  - Build it with PDF 1.7 §7.6.3.3 Algorithms 2 (key), 3 (O), 4 (U) and §7.6.2 Algorithm 1 (per-object key). That is MD5 from `node:crypto` plus a 15-line RC4 in the script, because OpenSSL 3 dropped `rc4`.
  - Encrypt only the content stream; names, `/O` and `/U` stay plain. pdf-lib cannot encrypt, which is why this one is hand-built.
- [ ] **Step 2: Write the failing tests.**

```ts
it('pageTextFromContent maps pdf.js items to top-origin points and skips empty strings', () => {
  const p = pageTextFromContent(2, [0, 0, 612, 792], [
    { str: '', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
    { str: 'Hi', transform: [9, 0, 0, 9, 72, 752], width: 10, height: 9 }])
  expect(p).toEqual({ page: 2, width: 612, height: 792,
    items: [{ page: 2, index: 1, str: 'Hi', x: 72, y: 40, width: 10, fontSize: 9 }] })
})
// (the existing extract and golden suites, unchanged, prove extractPages still returns the same PageText)
it('a locked PDF needs a password and opens with the right one', async () => {
  await expect(extractPages(readFixture('locked.pdf'))).rejects.toThrow('PDF is password-protected')
  const [p] = await extractPages(readFixture('locked.pdf'), 'tide')
  expect(p.items.map(i => i.str).join('')).toBe('Locked fixture text.')
})
it('classifies a missing and a wrong password')            // catch the cause → 'needs-password'; password 'nope' → 'wrong-password'
it('classifies a non-PDF and an empty file as damaged')     // not-a-pdf.pdf and new Uint8Array(0)
```

- [ ] **Step 3: Run** the tests and see them FAIL. Then implement `page-text.ts`, `pdf-errors.ts` and the `extract.ts` changes, and run the whole `npm test`: every golden must be unchanged.
- [ ] **Step 4: Bundle the pdf.js assets** with `vite-plugin-static-copy` in the renderer config:
  - copy to `pdfjs/`: `cmaps/*`, `standard_fonts/*`, `iccs/*`, and `wasm/{openjpeg.wasm,jbig2.wasm,qcms_bg.wasm,openjpeg_nowasm_fallback.js,jbig2_nowasm_fallback.js,LICENSE_*}`;
  - `quickjs-*` is **not** copied, because Tide never runs PDF JavaScript;
  - the CSP stays unchanged; wasm decoders fall back to their JS versions if wasm compile is refused.
- [ ] **Step 5: Implement `openPdf`.** Map failures with `classifyPdfError`, and destroy the loading task on failure.
- [ ] **Step 6: Add the probe.** In `main.tsx`, only when `window.tideTest` exists (TIDE_E2E=1), define `window.__tidePdfProbe(bytes: number[]) → { kind, numPages, firstPageText }`. Then write `tests/e2e/pdf-probe.spec.ts`:

```ts
test('the renderer opens a PDF with the pdf.js worker under the CSP', async () => {
  // collect console messages; bytes of single-column.pdf; probe → kind 'ok', numPages 4, text contains 'PSYC 201'
  // locked.pdf → kind 'needs-password'; not-a-pdf.pdf → 'damaged'
  // no console message matches /Content Security Policy|Refused to/
})
```

- [ ] **Step 7: Verify in both builds.** Run `npm run build && npm run e2e -- pdf-probe`, then `npm run package` and `TIDE_PACKAGED=1 npx playwright test pdf-probe`; **both must PASS** (file:// worker and asset loading in the packaged app).
  - If the packaged worker fails to load, stop and fix the cause: check that `workerSrc` resolves next to `index.html`, and that worker output format is `es`.
  - Do not fall back to a main-thread "fake worker".
- [ ] **Step 8: Commit.** `feat(reader): pdf.js in the renderer with bundled assets, shared page-text mapping, password and damaged fixtures`.

---

### Task 6: The shelf

**Files:**
- Create: `src/shared/library/shelf.ts`, `src/renderer/src/state/useLibrary.ts`, `src/renderer/src/shelf/Shelf.tsx`, `src/renderer/src/shelf/ShelfRow.tsx`, `src/renderer/src/shelf/EmptyState.tsx`, `tests/unit/library/shelf.test.ts`, `tests/renderer/shelf.test.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `interface ShelfGroup { key: string; name: string; collapsed: boolean; active: ReadingView[]; finished: ReadingView[] }`, `groupShelf(s: LibrarySnapshot): ShelfGroup[]` and `rowLabel(r: ReadingView): string`.
- Produces: `useLibrary(): LibrarySnapshot | null`, a `useSyncExternalStore` over `tide().library.get()` + `onChanged`.
- Produces: `Shelf(props: { snapshot: LibrarySnapshot; selectedId: ReadingId | null; onOpen(id: ReadingId): void; onAdd(): void; onPicked?(): void })` and `EmptyState(props: { onAdd(): void; platform: string })`.

**Rules:**
- **Grouping:** courses sort by name (`localeCompare`, base sensitivity); `Other` (key `OTHER`, name "Other") comes last; empty groups are omitted.
- **Within a group:** readings sort by `lastOpenedAt ?? addedAt`, newest first. Finished readings go to `finished`.
- **`rowLabel`**, in order:
  - missing → `File moved · Find it`
  - finished → `Finished`
  - no position → `New`
  - pageCount known → `Page {position.page} of {pageCount}`
  - otherwise `Page {position.page}`

  (M4 adds "Playing · ".)
- **UI:**
  - The course header is a button (11 px / 800 uppercase, `--muted`) that toggles `setCollapsed`.
  - A "Finished (N)" row is collapsed by default; this state is local, not saved.
  - The selected row uses `--surface` + shadow and its label is `--primary` / 700. A missing row's label is `--warn` / 700.
  - The "Add reading" primary button sits under the wordmark.
- **Empty stage** (no readings), copy exactly:
  - heading "Your shelf is empty"
  - body "Add a PDF from your course and Tide will read it to you in a calm voice."
  - button "＋ Add your first reading"
  - on `darwin` only, a tip box: "**Tip:** you can also right-click any PDF in Finder and choose **Open With → Tide**." (Windows Open With registration is deferred, Task 8.)
  - With readings but nothing open, the stage says "Pick a reading from your shelf to carry on." Nothing auto-opens at launch.

- [ ] **Step 1: Write the failing tests.**

```ts
it('groups by course name with Other last and drops empty courses')
it('orders readings by last opened, then added, newest first')
it('folds finished readings into their course')
it('row labels: File moved · Find it / Finished / New / Page 4 of 22 / Page 4')
```
```tsx
it('clicking a course header collapses it and remembers it via setCollapsed')
it('a "Finished (2)" row expands to show finished readings')
it('clicking a reading calls onOpen with its id and onPicked')
it('the empty shelf shows the headline, the add button, and the Finder tip only on macOS')
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** In `App.tsx`, keep `selectedId` in state; selecting calls `tide().library.update(id, { opened: true })`. Until Task 9 the stage shows the selected reading's title.
- [ ] **Step 4: Verify.** `npm test` and `npm run typecheck` should PASS.
- [ ] **Step 5: Commit.** `feat(shelf): course-grouped shelf with collapse, finished fold, row states and empty state`.

---

### Task 7: Add reading: file picker, course picker, ⌘O

**Files:**
- Create: `src/shared/library/title.ts`, `src/renderer/src/add/useAddReading.ts`, `src/renderer/src/add/CoursePicker.tsx`, `src/renderer/src/add/MessageDialog.tsx`, `src/main/menu.ts`, `tests/unit/library/title.test.ts`, `tests/renderer/add-reading.test.tsx`, `tests/e2e/library.spec.ts`
- Modify: `src/renderer/src/App.tsx`, `src/main/index.ts` (`Menu.setApplicationMenu(buildMenu(send))`)

**Interfaces:**
- Produces: `readingTitle(metaTitle: string | undefined, fileName: string): string`.
  - **Metadata title:** used when, trimmed, it is 4–120 chars, has ≥ 2 letters, and does not match `/^(untitled|document\d*|microsoft (word|powerpoint)\b|title|slide \d+)|\.(docx?|pptx?|pdf|indd|tex|qxd)\b/i`.
  - **Otherwise the file name:** drop a final `.pdf` (any case), turn `_` into spaces, collapse whitespace, trim. If that leaves nothing, use `Untitled reading`.
- Produces: `useAddReading(onAdded: (id: ReadingId) => void): { start(): void; handlePick(p: PickResult): void; ui: ReactNode }`. Task 8 calls `handlePick` for Open With.
- Produces: `buildMenu(send: (c: AppCommand) => void): Menu`, with these menus:
  - macOS `appMenu` role;
  - File → "Add reading…" (`CmdOrCtrl+O` → `{type:'add-reading'}`);
  - Edit role menu (copy/paste in fields);
  - View → "Larger text" (`CmdOrCtrl+=`, also `CmdOrCtrl+Plus`) and "Smaller text" (`CmdOrCtrl+-`), sending `zoom` ±1;
  - Window role;
  - Help → disabled items listing "⌘O  Add reading", "⌘+ / ⌘−  Text size", "← / →  Previous / next sentence" (Ctrl on Windows).

**Flow** (`start()` = `pickPdf()`, then `handlePick`):
- `existing` calls `onAdded(id)`; `cancelled` does nothing.
- `new`:
  1. `readPdf({pickId})`, then `openPdf`.
  2. `ok`: title = `readingTitle(doc.metaTitle, fileName)`, pageCount = `numPages`.
  3. `needs-password`: title from the file name, pageCount `null`; the password is asked when the reading opens.
  4. `damaged` or `ok:false`: a `MessageDialog` "Tide can't open this PDF. It may be damaged." with one button "OK", and nothing is added.
  5. Otherwise the **CoursePicker** opens, then `add(...)`, then `onAdded(newId)`.
- **CoursePicker** (copy from mockup screen 3):
  - title "Which course is this for?", sub "Optional. It just keeps your shelf tidy.";
  - a file row with the file name (bold) and "{n} pages" (hidden when null);
  - chips: existing courses (same order as the shelf, single-select), then a dashed "＋ New course" chip that turns into a text field (placeholder "Course name, e.g. PSYC 201", max 40);
  - actions "Skip" (ghost) → Other, and "Add to shelf" (primary) → the chosen course, or Other if none;
  - Escape / close cancels and adds nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
it.each([
  ['Memory and Attention', 'x.pdf', 'Memory and Attention'],
  ['Microsoft Word - ch2.docx', 'Week_4_Institutions.pdf', 'Week 4 Institutions'],
  [undefined, 'ch2.PDF', 'ch2'], ['  ', '__.pdf', 'Untitled reading'], ['Untitled', 'a_b.pdf', 'a b'],
])('readingTitle(%j, %j) → %j', (m, f, want) => expect(readingTitle(m, f)).toBe(want))
```
```tsx
it('a new file shows the course picker with its name and page count, and Add to shelf adds it')
it('Skip adds it to Other; a typed new course is passed as newName')
it('a file already on the shelf opens it without the picker')
it('a file that is not a PDF shows the damaged message and is not added')   // fake openPdf → {kind:'damaged'}
it('a locked PDF is added with its file name as title and no page count')
it('Escape closes the picker and adds nothing')
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** In `App.tsx`, `onCommand` routes `add-reading` to `start()`. After `onAdded` the new reading is selected (opened at page 1 in M3; no autoplay). The first-time selection tip is deferred to M5, which builds text selection.
- [ ] **Step 4: Write the e2e** in `tests/e2e/library.spec.ts`:

```ts
test('adds a reading under a new course and keeps it after a restart', async () => {
  // userData = mkdtemp; pdf = copy of single-column.pdf to '<tmp>/my readings ü/Wéek 4 – Memory_and_Attention.pdf'
  // app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, pdf)
  // click 'Add reading' → picker shows 'Wéek 4 – Memory_and_Attention.pdf' and '4 pages'
  // '＋ New course' → type 'PSYC 201' → 'Add to shelf'
  // shelf shows course 'PSYC 201' and a row whose label is 'New'
  // close; relaunch with the same TIDE_USER_DATA → same course and row
})
```

- [ ] **Step 5: Verify.** `npm test` should PASS, and `npm run build && npm run e2e` should PASS.
- [ ] **Step 6: Commit.** `feat(library): Add reading with course picker, sane titles, damaged-PDF message and ⌘O menu`.

---

### Task 8: Open With, single instance, second launch

**Files:**
- Create: `src/main/open-with.ts`, `tests/unit/open-with.test.ts`
- Modify: `src/main/index.ts`, `electron-builder.yml`, `src/renderer/src/App.tsx`, `tests/e2e/launch.ts` (`spawnSecond(args: string[], env)`), `tests/e2e/library.spec.ts`

**Interfaces:**
- Produces: `filesFromArgv(argv: string[], cwd: string): string[]`. It keeps args that end in `.pdf` (any case), are not flags, and exist; relative paths resolve against `cwd`. The executable and the `out/main/index.js` script are never returned.
- Produces: `class OpenWithQueue { push(path: string): void; attach(handle: (path: string) => Promise<void>): void }`, which buffers paths until `attach`, then drains them in order.
- Consumes: `Library.pick`, and `send({ type: 'open-pick', pick })` from Task 4 (queued until the renderer is ready).

**Wiring in `index.ts`:**
- `open-file` is registered at module top level (before `ready`) and calls `e.preventDefault()` then `queue.push(path)`.
- `requestSingleInstanceLock()` runs after the `TIDE_USER_DATA` hook; if it returns false, `app.quit()`.
- `second-instance` shows and focuses the window, then pushes `filesFromArgv(argv, workingDirectory)`.
- Initial `process.argv` files are pushed after ready.
- The queue handler is `async (p) => send({ type: 'open-pick', pick: await lib.pick(p) })`.
- In the renderer, `open-pick` calls `useAddReading().handlePick(pick)`, so a new file shows the course picker and a known one opens.

**Packaging:**
- `mac.fileAssociations: [{ ext: pdf, name: PDF document, role: Viewer, rank: Alternate }]` is **mac only**. electron-builder's NSIS association can claim the `.pdf` default on Windows, which spec §6.6 forbids.
- On Windows, "Open with → Choose another app → Tide" works through argv.
- Registering Tide in the Windows "Open with" list without becoming the default is deferred to M7. Windows is secondary, and that needs a custom NSIS script.

- [ ] **Step 1: Write the failing tests.**

```ts
it('filesFromArgv keeps existing pdf paths only', /* ['Tide.exe','--flag','a.PDF','missing.pdf','notes.txt'] → [abs a.PDF] */)
it('filesFromArgv resolves relative paths against the second instance cwd')
it('OpenWithQueue buffers paths until attached, then drains in order')
```
```ts
// tests/e2e/library.spec.ts
test('Open With on a new file shows the course picker; on a known file opens it', async () => {
  // app.evaluate(({ app }, p) => app.emit('open-file', { preventDefault() {} }, p), pdf) → picker; Skip → row under 'Other'
  // emit again with a copy of the same file at a new path → no picker, still one row, row selected
})
test('a second launch with a PDF hands it to the running Tide', async () => {
  // spawnSecond([pdf2], { TIDE_E2E:'1', TIDE_USER_DATA: same }) exits 0 → first window shows the picker for pdf2
})
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** **Step 4: Verify.** `npm test` should PASS, and `npm run build && npm run e2e` should PASS.
- [ ] **Step 5: Manual check on Windows** (`npm run package`, install `release/Tide Setup *.exe`): the default PDF app is unchanged, and "Open with → Choose another app → Tide.exe" adds the reading. Note the result in the PR description.
- [ ] **Step 6: Commit.** `feat(library): Open With and second-launch hand-off with a single-instance lock (mac file association)`.

---

### Task 9: File moved flow, the reading's "More" menu, M2 complete

**Files:**
- Create: `src/renderer/src/reading/ReaderHeader.tsx`, `src/renderer/src/reading/ReadingMenu.tsx`, `src/renderer/src/reading/FileMovedDialog.tsx`, `src/renderer/src/reading/RenameDialog.tsx`, `tests/renderer/reading.test.tsx`
- Modify: `src/renderer/src/App.tsx`, `tests/e2e/library.spec.ts`

**Interfaces:**
- Produces: `ReaderHeader(props: { reading: ReadingView; courseName: string | null; page: number | null; menu: ReactNode })`. The meta line is "{COURSE or OTHER} · PAGE {n}" (10.5 px / 800 uppercase, `--page-meta`, page part omitted when null), with the title (15 px / 800) beside it and the menu on the right.
- Produces: `ReadingMenu(props: { reading: ReadingView; onRename(): void; onRemove(): void; extraItems?: ReactNode })`, a Radix DropdownMenu whose trigger is a soft button "More" (`aria-label="More options for {title}"`). Items: "Rename…" and "Remove from shelf…". Task 14 adds "Read everything" via `extraItems`.
- Produces: `FileMovedDialog(props: { reading: ReadingView; onDone(opened: boolean): void })`.

**Dialogs:**
- **File moved** (mockup screen 8):
  - warn-soft "?" tile; title "Where did this one go?";
  - sub "We can't find **{title}**. It may have been moved, renamed or deleted. Point us to it and you'll carry on from **page {n}**." When there is no position the last sentence reads "Point us to it and it will open from the start.";
  - actions "Remove from shelf" (ghost, left) and "Find the file" (primary).
  - Find calls `findFile(id)`:
    - `relinked` closes the dialog and opens the reading;
    - `different` swaps the dialog to "This looks like a different file. Use it anyway?", sub "Your place in this reading will start again from the beginning.", actions "Cancel" / "Use it anyway" (→ `useDifferentFile`, then open);
    - `cancelled` keeps the dialog open.
- **Remove** confirms with "Remove “{title}” from your shelf?", sub "The PDF file itself stays where it is.", actions "Keep" / "Remove".
- **Rename** is a field prefilled with the title, with actions "Cancel" / "Save".
- Clicking a **missing** row opens the File moved dialog instead of the reading.

- [ ] **Step 1: Write the failing tests.**

```tsx
it('clicking a missing reading shows "Where did this one go?" with its title and page')
it('the sentence says "it will open from the start" when there is no saved place')
it('Find the file → relinked opens the reading')
it('a different file asks "Use it anyway?" and only then calls useDifferentFile')
it('Remove from shelf asks first; Keep does nothing')
it('Rename saves a trimmed title and Cancel keeps the old one')
it('the More button is labelled in words')       // getByRole('button', { name: /More options for/ }) has text 'More'
```
```ts
// tests/e2e/library.spec.ts
test('a moved file shows "File moved · Find it" and Find the file re-links it', async () => {
  // add pdf (stubbed dialog) → close app → rename the file on disk → relaunch same userData
  // row label 'File moved · Find it' → click → dialog 'Where did this one go?'
  // stub showOpenDialog to the new path → 'Find the file' → row label no longer 'File moved · Find it'
})
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** **Step 4: Verify.** `npm test` should PASS, and `npm run build && npm run e2e` should PASS. Then `npm run package && TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test` should PASS on Windows.
- [ ] **Step 5: Push the branch** and confirm CI is green on macOS and Windows (packaged e2e includes `library.spec.ts`). **M2 is done:** she can add, tag, see, reopen and re-find readings.
- [ ] **Step 6: Commit.** `feat(library): File moved flow with Find it, rename and remove from the More menu`.

---

## M3: Reader

### Task 10: Sentence model helpers: resume anchor and highlight geometry

**Files:**
- Create: `src/shared/text/highlight.ts`, `tests/unit/text/anchor.test.ts`, `tests/unit/text/highlight.test.ts`
- Modify: `src/shared/text/anchor.ts` (add the functions)

**Interfaces:**
- Produces (`anchor.ts`): `anchorOf(s: Sentence): Anchor`, the first span's `{page, itemIndex → textItemIndex, start → charOffset}`, and `resolveAnchor(sentences: Sentence[], a: Anchor): number`. Resolution, in order:
  1. the first sentence with a span on `(a.page, a.textItemIndex)` where `start ≤ a.charOffset < end`;
  2. else the first sentence whose first span comes after the anchor in `(page, itemIndex, start)` order;
  3. else the last sentence;
  4. `-1` only when `sentences` is empty.
- Produces (`highlight.ts`):
  ```ts
  export interface Rect { page: number; x: number; y: number; w: number; h: number }   // PDF points, top-left origin
  export type ItemLookup = (page: number, itemIndex: number) => TextItem | undefined
  export function spanRects(spans: Span[], item: ItemLookup, pageSize: (page: number) => { width: number; height: number }): Rect[]
  export function sentenceAt(rectsBySentence: Rect[][], page: number, x: number, y: number): number | null
  ```
  - **Span to rect:** `x0 = item.x + item.width × start / str.length`, `x1 = item.x + item.width × end / str.length`, `y = item.y − 0.85 × fontSize`, `h = 1.1 × fontSize`.
  - **Merging:** rects on the same page whose vertical overlap is > 50% and whose horizontal gap is < 0.5 × fontSize become one.
  - **Clamping:** everything is clamped to the page box.
  - **`sentenceAt`:** returns the sentence whose rect contains the point, or else the sentence with the nearest rect on that page within 1 line height (12 pt); otherwise `null`.

- [ ] **Step 1: Write the failing tests** (fixtures through `extractPages` + `buildSentences`):

```ts
it('every fixture sentence has highlight rects inside its page and on the lines holding its characters')
  // spec 6.11: for each sentence, rects.length > 0; 0 ≤ x, x+w ≤ width, 0 ≤ y, y+h ≤ height;
  // each rect contains the baseline y of at least one item in the sentence's spans
it('anchor survives flipping "read citations"')     // citations.pdf: anchor of sentence k (default) resolves under
  // {...DEFAULT_FILTERS, readCitations:true} to a sentence whose spans contain the anchor
it('anchor survives Read everything on and off')    // cover-refs.pdf, sentence on page 4
it('falls forward when the anchored text is now skipped')
  // anchor on a page-1 cover sentence (READ_EVERYTHING) → DEFAULT resolves to the first sentence after it
it('an anchor past the last sentence resolves to the last sentence')
  // anchor inside References (READ_EVERYTHING) → DEFAULT: index = sentences.length - 1
it('resolveAnchor of an empty list is -1')
it('sentenceAt finds the sentence under a point and null far from text')
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** **Step 4: Verify.** The tests PASS.
- [ ] **Step 5: Commit.** `feat(text): resume anchors that survive setting changes, and highlight rectangles from spans`.

---

### Task 11: Text quality A: two-column bands and footnote starts

**Files:**
- Modify: `src/shared/text/lines.ts`, `src/shared/text/filters.ts`, `src/shared/text/types.ts` (`PIPELINE_VERSION = 3`), `scripts/make-fixtures.ts` (+ `layout`), `tests/unit/text/lines.test.ts`, `tests/unit/text/filters.test.ts`, `tests/unit/text/pipeline.test.ts` (add `layout` to `GOLDEN`), `tests/unit/text/local-readings.test.ts`
- Create: `tests/fixtures/pdfs/layout.{pdf,json}`, `tests/fixtures/spoken/layout.txt`

**Rules:**
- **Bands** (in `buildLines`):
  - A **separator row** is a row with an item crossing x = 0.5 × page width that is at least 0.5 × the page's text width wide.
  - Separator rows cut the page into bands. Each band of non-separator rows runs the existing `findGutter` on its own items.
  - A band is two-column only when each side has ≥ 2 lines and the median words per line on each side is ≥ 5 (so a table band is not split into columns).
  - Output order: bands top to bottom, each band left column then right column, with separator rows in y order between bands.
  - A page with no separator is one band: today's behaviour.
- **Footnote start** (in `dropFootnotes`):
  - A candidate still needs today's conditions (bottom 35%, < 0.85 × body, starts with a digit, `*`, `†` or a superscript).
  - It must **also** have ≥ 3 words containing letters (so axis labels like "0 10 20 30" are out), and **no line of ≥ 0.85 × body may lie below it in the same column**.
  - Every qualifying candidate cuts its own column, so footnotes at the bottom of both columns both go.
  - Superscript exponents (m², 10³) are not changed here (see Deferred).
- **Local check:** `local-readings.test.ts` also logs one line per reading: `{ reading: <1-based index in sorted order>, pages, sentences, changedLines }`, where `changedLines` is the size of the symmetric line difference against the approved `.txt` (or `null` when none is approved). It never logs file names or text.

- [ ] **Step 1: Generate `layout.pdf`** (invented text, 3 pages, with the sidecar listing what is spoken):
  - **p1:** full-width title; a two-column band A; a full-width pull-quote line mid-page; a two-column band B. Markers: `A-LEFT-END`, `A-RIGHT-START`, `MID-FULL`, `B-LEFT-START`, `B-RIGHT-START`.
  - **p2:** a small-font chart axis line "0 10 20 30 40" at 70% height with body paragraphs below it, then a real footnote.
  - **p3:** two columns, each ending in its own 7 pt footnote.
- [ ] **Step 2: Write the failing tests.**

```ts
it('reads band A left, band A right, the full-width line, then band B left and right')  // marker index order
it('does not split a table band between full-width paragraphs into columns')            // synthetic page()
it('keeps body text below small chart axis labels')
it('drops a footnote at the bottom of each column')
it('golden spoken text: layout')                                                       // hand-written layout.txt
```

- [ ] **Step 3: Run** the tests and see them FAIL. **Step 4: Implement.**
- [ ] **Step 5: Verify.** `npm test` should PASS with **all existing goldens unchanged**; any change must be justified line by line in the commit. Then run `npx vitest run tests/unit/text/local-readings.test.ts` before and after the change, and record the aggregate lines (numbers only) in the commit body.
- [ ] **Step 6: Commit.** `feat(text): two-column bands around full-width lines; footnote starts need words and nothing body-sized below`.

---

### Task 12: Text quality B: multi-word tables and end-of-chapter resource lists

**Files:**
- Modify: `src/shared/text/filters.ts`, `src/shared/text/pipeline.ts`, `scripts/make-fixtures.ts` (+ `tables-lists`), `tests/unit/text/filters.test.ts`, `tests/unit/text/pipeline.test.ts`
- Create: `tests/fixtures/pdfs/tables-lists.{pdf,json}`, `tests/fixtures/spoken/tables-lists.txt`

**Interfaces / rules:**
- **Tables** (`dropCaptionsAndTables`), in addition to today's rule:
  - A **grid row** has ≥ 2 cells (items split by x-gaps > 2 × fontSize), and its first cell is **not** a list marker (`/^(\d{1,2}[.)]|[•●▪◦–-]|[a-z][.)])$/`).
  - A run of ≥ 3 grid rows whose cell left edges share ≥ 2 column x positions (±0.5 × fontSize) is a table, whatever the words per cell.
  - The run may include up to 2 consecutive single-cell rows that start at one of its column x's (wrapped cells).
- **Resource sections:** `resourceSections(pages: Line[][], body: number): Array<{ page: number; lineIndex: number; endPage: number; endLine: number }>`.
  - **Start:** a standalone line with `fontSize ≥ body`, on a page with `(page − 1) / pageCount ≥ 0.6`, matching `/^(?:(?:suggested|further|recommended|additional|selected|key)\s+(?:readings?|resources|websites|viewing)|(?:useful\s+|relevant\s+)?(?:websites|web\s+sites|web\s+links)|(?:audio-?visual|online|internet|web)\s+(?:resources|materials))$/i`.
  - **End:** just before the next heading line (fontSize > 1.15 × body) that does not itself match; otherwise the end of the document.
  - The pipeline drops these lines when `stopAtReferences` is on (no new setting: spec §6.3 has a fixed list), and adds `SkippedPage.reason: 'resources'`.

- [ ] **Step 1: Generate `tables-lists.pdf`** (invented text, 4 pages; sidecar):
  - **p1:** a 2-column table with multi-word cells ("Factor" / "Effect on recall over a week"), 4 rows plus 1 wrapped cell, between body paragraphs.
  - **p2:** a numbered list with a hanging indent (must be kept).
  - **p3:** a chapter end with "Suggested readings" and "Websites" sections (invented titles, example.org URLs).
  - **p4:** a "Next chapter" heading at 1.4 × body followed by body text (must be kept).
- [ ] **Step 2: Write the failing tests.**

```ts
it('drops a table with multi-word cells and its wrapped cell, keeps the paragraphs around it')
it('keeps a numbered list with a hanging indent')
it('skips Suggested readings and Websites sections until the next heading')
it('a "Websites" heading in the first 60% is read')
it('Read everything reads the resource sections')
it('golden spoken text: tables-lists')
```

- [ ] **Step 3: Run** the tests and see them FAIL. **Step 4: Implement.** **Step 5: Verify** exactly as in Task 11 Step 5 (goldens and aggregate numbers). **Step 6: Commit.** `feat(text): aligned multi-word tables and end-of-chapter resource lists are skipped`.

---

### Task 13: Text quality C: block quotes, table-of-contents leaders, initials

**Files:**
- Modify: `src/shared/text/pipeline.ts` (`appendPage`), `src/shared/text/spoken.ts` (if needed for leader removal), `src/shared/text/sentences.ts`, `scripts/make-fixtures.ts` (+ `sentence-edges`), `tests/unit/text/pipeline.test.ts`, `tests/fixtures/spoken/cover-refs.txt` (re-baselined)
- Create: `tests/fixtures/pdfs/sentence-edges.{pdf,json}`, `tests/fixtures/spoken/sentence-edges.txt`

**Rules:**
- **Block quote:** the gap break between two non-heading lines is **suppressed** when the previous line does not end in `/[.!?:;]["'”’)\]]*$/` and the next line starts with `/^["'“‘(]?[a-z]/`.
- **TOC entry:** a line matching `/^(.*\S)\s*(?:\.\s*){4,}\s*(\d{1,4}|[ivxlc]{1,6})$/i`. **Owner decision (2026-11-17): table-of-contents pages are skipped like cover pages.** With the "Skip cover and copyright pages" setting on (the default), TOC entry lines are dropped, together with a standalone `Contents` / `Table of contents` heading line on the same page; a page left with no text this way is reported in `skippedPages` with reason `'contents'`. With that setting off (or "Read everything"), each TOC entry is a block of its own (a hard break before and after), its leader and page number are not spoken, and its spans cover the title characters only.
- **Initials:** the single-capital-initial merge in `continues()` is skipped when the next segment starts with one of `The This These That Those It Its In On At A An As However We They He She There But And For When While Although If Our Their Such Some Many Most Each One`. Abbreviation merges are unchanged.

- [ ] **Step 1: Generate `sentence-edges.pdf`** (invented text; sidecar):
  - a sentence that runs into an indented block quote after a gap ("…the tutor argued that" / "the mind keeps few items at once.");
  - a 4-entry TOC with dot leaders;
  - "Take vitamin C. The body needs it." and "J. K. Rowan wrote this." and "Barlow, T. M. (2019) disagreed."
- [ ] **Step 2: Write the failing tests.**

```ts
it('a block quote that continues a sentence after a gap stays one sentence')
it('a gap after a full stop still breaks')
it('table-of-contents entries and the Contents heading are skipped by default; a page left empty is skippedPages reason "contents"')
it('with cover skipping off, table-of-contents entries are spoken as their titles without leaders or page numbers')
  // spans of 'Introduction' map only to the title characters
it('"vitamin C. The" is two sentences; "J. K. Rowan" and "Barlow, T. M." are not split')
it('golden spoken text: sentence-edges')
it('golden spoken text: cover-refs')     // re-baselined: the TOC entry lines (and its Contents heading) are no longer spoken; the "Read everything" golden render, if the test has one, shows them as 'Introduction', 'Notes', 'Results', 'Discussion', 'References'
```

- [ ] **Step 3: Run** the tests and see them FAIL. **Step 4: Implement**, then edit `cover-refs.txt` **by hand** to drop the TOC lines (the only change expected in existing goldens). `SkippedPage.reason` gains `'contents'`. **Step 5: Verify** exactly as in Task 11 Step 5. **Step 6: Commit.** `feat(text): block quotes continue across gaps, TOC leaders are dropped, initials no longer swallow sentence ends`.

**Deferred text items** (not in M3, so each keeps its golden stable until someone can review it against her readings; "Read everything" is the escape meanwhile):
- **multi-letter initials, country abbreviations and the "No." merge:** need an abbreviation list tuned on more readings;
- **run-in bold headings:** need `fontName`/weight from pdf.js, an extraction change;
- **citation shapes** (multiple years, possessive "et al.", group authors, page-only locators): a citations pass of its own;
- **figure source notes, DOI lines, URL speech:** need a spoken-form design;
- **outline numerals and item-spacing artifacts:** need item-level fixes with no fixture yet;
- **superscript exponents (m², 10³):** rare in her subjects;
- **rotated pages, U+2010 de-hyphenation, COMPOUND_PREFIXES syllable splits, roman-numeral zone titles:** none seen in her readings;
- **the /simplify refactors:** no user-visible change;
- **the text cache in `userData/cache/`** (spec §6.3): see Task 14.

---

### Task 14: Reader view: pages, text in a worker, states, Read everything, text size

**Files:**
- Create: `src/renderer/src/reader/pipeline.worker.ts`, `src/renderer/src/reader/pipeline-client.ts`, `src/renderer/src/reader/deps.tsx`, `src/renderer/src/reader/renderWindow.ts`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/reader/PdfPage.tsx`, `src/renderer/src/reader/PasswordDialog.tsx`, `tests/unit/reader/render-window.test.ts`, `tests/renderer/reader.test.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/reading/ReadingMenu.tsx` (extra item), `src/main/menu.ts` (zoom items active), `electron.vite.config.ts` (`renderer.worker.format: 'es'`)

**Interfaces:**
- Consumes: `openPdf`/`PdfDoc` (Task 5), `buildSentences`/`BuildResult` (M1), `ReaderHeader`/`ReadingMenu` (Task 9), `tide().library` (Task 4).
- Produces: `buildSentencesInWorker(pages: PageText[], filters: ReadingFilters): Promise<BuildResult>`. One worker per call, terminated after; a stale result is ignored by request id.
- Produces: `filtersFor(r: ReadingView, s: LibrarySettings): ReadingFilters`, which is `READ_EVERYTHING` when `r.readEverything`, else `s.reading`.
- Produces: `renderWindow(firstVisible: number, lastVisible: number, total: number, margin = 1): number[]`, the 1-based pages to keep rendered.
- Produces: `ReaderDeps` context `{ openPdf; buildSentences: typeof buildSentencesInWorker }` with real defaults, so tests inject fakes.
- Produces: `ReaderView(props: { reading: ReadingView; snapshot: LibrarySnapshot })`, exposing `{ sentences, current, setCurrent }` to Task 15 through a `ReaderState` context.

**Behaviour:**
1. **Open:** `readPdf({readingId})`.
   - `missing` shows the File moved dialog (Task 9).
   - `unreadable` / `damaged` shows a dialog "Tide can't open this PDF. It may be damaged." with "Remove from shelf" / "Keep" (Keep returns to the empty stage).
   - `needs-password` / `wrong-password` shows **PasswordDialog**: "This PDF is locked with a password.", a field labelled "Password", "Cancel" / "Open". A wrong password adds "That password didn't work. Try again." The password is never stored or sent to main.
2. **Pages:** a scrolling column of page placeholders sized `pageSize(n) × scale`.
   - `scale = min(stageWidth − 56, 820) × zoom / pageWidthPt`. Canvases are rendered at `devicePixelRatio`.
   - Only `renderWindow(...)` pages (from an IntersectionObserver) hold a canvas; the others release theirs, and in-flight renders are aborted.
   - The page holding the resume anchor (`position.page`, else 1) is scrolled to and rendered **before** text extraction starts.
   - Each page is `--page` with the spec shadow, on the stage gradient.
3. **Text:**
   - `pageText(n)` for every page, in order, then `buildSentencesInWorker(pages, filtersFor(...))`.
   - `pageCount` is sent with `update` if it differs from `numPages`.
   - While text is pending the page is visible and no highlight is shown.
4. **States** (spec §5.3):
   - Every page in `textlessPages` shows a thin banner "No readable text on this page, skipping.".
   - If every page is textless, the stage shows "Tide couldn't find any text in this PDF. It may be a scanned copy." with "Remove from shelf".
   - If there are zero sentences but some text, it shows "Tide skipped everything in this reading." with a button "Read everything" (→ `update(id, { readEverything: true })`).
5. **Read everything:** a `DropdownMenu.CheckboxItem` "Read everything" in ReadingMenu. Toggling it re-runs only step 3 with the new filters, keeping the current anchor (Task 15 resolves it).
6. **Text size:** the `zoom` command sets `clamp(zoom ± 0.1, 0.8, 2.0)` through `setZoom`, and pages re-scale while keeping the current page in view. The player placeholder label shows "Page {n} of {numPages}" for the page of the current sentence, or else the top visible page.
7. **Text cache:** the `userData/cache/` text cache (spec §6.3) is **deferred**. Step 7 measures open-to-sentences time; add the cache in M4 only if her longest reading exceeds 2 s.

- [ ] **Step 1: Write the failing tests.**

```ts
it('renderWindow keeps the visible pages plus one either side', () => {
  expect(renderWindow(5, 6, 300)).toEqual([4, 5, 6, 7]); expect(renderWindow(1, 1, 300)).toEqual([1, 2])
  expect(renderWindow(300, 300, 300)).toEqual([299, 300])
})
it('filtersFor: Read everything wins over settings')
```
```tsx
// fake ReaderDeps: openPdf returns a fake PdfDoc built from synthetic PageText; buildSentences runs the real pipeline inline
it('a damaged PDF shows "Tide can\'t open this PDF. It may be damaged." with Remove from shelf and Keep')
it('a locked PDF asks for the password; a wrong one says "That password didn\'t work. Try again."')
it('a reading with no text at all shows the scanned-copy message')
it('a textless page shows "No readable text on this page, skipping."')
it('when filters skip everything, "Read everything" turns it on for this reading')
it('the More menu toggles Read everything and the sentences are rebuilt')
it('a zoom command changes the page scale within 80–200%')
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.**
- [ ] **Step 4: Verify.** `npm test` and `npm run typecheck` should PASS.
- [ ] **Step 5: Manual check** with `npm run dev`:
  - add `tests/fixtures/pdfs/two-column.pdf` and `layout.pdf`: pages render crisply, scrolling a long PDF stays smooth, and ⌘+ / ⌘− work;
  - add `locked.pdf` with password `tide`: it opens.
- [ ] **Step 6: Commit.** `feat(reader): pdf.js pages with lazy canvases, text pipeline in a worker, reader states, Read everything and text size`.
- [ ] **Step 7: Measure** open-to-sentences time on each local reading in `npm run dev`. Report the numbers only, by reading index, in the PR description.

---

### Task 15: Sentence highlight, manual stepping, resume

**Files:**
- Create: `src/renderer/src/reader/HighlightLayer.tsx`, `tests/renderer/highlight-resume.test.tsx`
- Modify: `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/reader/PdfPage.tsx`

**Interfaces:**
- Consumes: `spanRects`, `sentenceAt`, `anchorOf`, `resolveAnchor` (Task 10); `ReaderState` (Task 14).
- Produces: `HighlightLayer(props: { rects: Rect[]; scale: number; sentenceId: number })`. It renders one absolutely positioned `<div data-testid="sentence-highlight" data-sentence-id={id}>` per rect over that page's canvas:
  - background `var(--hl)` with `mix-blend-mode: multiply`, so the PDF's ink stays readable through the wash;
  - `box-shadow: inset 0 -2px 0 var(--hl-line)`, radius 3 px;
  - `pointer-events: none`.

**Behaviour:**
- **When text is ready:** `current = position ? resolveAnchor(sentences, position) : 0`, and its page is scrolled into view.
- **Clicking the page** converts the point to PDF points (`/ scale`), and `sentenceAt` sets `current` when it finds a sentence.
- **← / → keys** (reader focused, no dialog open, not typing in a field) move `current` by one sentence, clamped.
- **Scrolling:** on change, the first rect scrolls into view with `block: 'center'` if it is outside the scroller (`behavior: 'auto'` under reduced motion).
- **Saving the place:** every change of `current` calls `update(id, { position: anchorOf(sentences[current]) })`; main debounces the disk writes (Task 3). Opening calls `update(id, { opened: true })` once.
- **Read everything** toggles keep `anchorOf(old current)` and resolve it in the new sentences.

- [ ] **Step 1: Write the failing tests** (fake deps as in Task 14):

```tsx
it('opens at the first sentence when there is no saved place')
it('opens at the saved place', /* position = anchorOf(s[2]) → highlights carry data-sentence-id="2" */)
it('→ moves to the next sentence and saves its anchor; ← goes back; both stop at the ends')
it('clicking on a sentence selects it')
it('arrow keys do nothing while typing in a dialog field')
it('turning on Read everything keeps the place')
```

- [ ] **Step 2: Run** the tests and see them FAIL. **Step 3: Implement.** **Step 4: Verify.** `npm test` should PASS. Then, in `npm run dev` on `two-column.pdf`, stepping with → follows reading order down the left column and then the right.
- [ ] **Step 5: Commit.** `feat(reader): current-sentence highlight from spans, click and arrow-key stepping, resume at her place`.

---

### Task 16: M3 end-to-end, CI size budget, decisions recorded

**Files:**
- Create: `tests/e2e/reader.spec.ts`
- Modify: `.github/workflows/ci.yml` (installer budget in the existing M0d summary step), `docs/superpowers/specs/2026-11-16-tide-design.md` (§12 decisions), `docs/spikes/m0-results.md` (follow-ups: tick the M3 items done, keep the deferred ones)

- [ ] **Step 1: Write the e2e:**

```ts
test('opens a reading, shows a rendered page and a highlight, and restores the place after a restart', async () => {
  // add single-column.pdf via the stubbed dialog (Skip → Other); the reading opens
  // the first page canvas has non-white pixels (evaluate getImageData, count > 1000)
  // [data-testid=sentence-highlight][data-sentence-id="0"] visible, each box inside the canvas box
  // press ArrowRight twice → data-sentence-id="2"; shelf row label 'Page 1 of 4'
  // app.close(); relaunch with the same TIDE_USER_DATA; click the row → data-sentence-id="2" highlighted
})
test('Read everything is remembered per reading', /* toggle on, restart, menu item still checked */)
```

- [ ] **Step 2: Verify locally.** `npm run build && npm run e2e` should PASS. Then `npm run package && TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test` should PASS.
- [ ] **Step 3: Add the installer budget.** In the M0d summary node script, for each installer print `Installer <name>: X MiB (Δ vs M1 baseline: +Y MiB)`, with baselines `dmg 246.3`, `exe 241.2`. Emit `::warning::Installer grew by more than 15 MiB` when Δ > 15.
- [ ] **Step 4: Run the local readings check** with `npx vitest run tests/unit/text/local-readings.test.ts` and keep the aggregate lines. Then open each of her readings in the packaged app on Windows and check:
  - it renders;
  - stepping highlights the right lines;
  - quit and reopen lands on the same sentence.

  Record pass/fail counts by reading index, never text.
- [ ] **Step 5: Record decisions in spec §12** ("Decided in M2/M3 planning"):
  - the hand-rolled library store instead of electron-store;
  - pdf.js in the renderer, with pdfjs-dist as a bundled devDependency;
  - Windows file association deferred;
  - the text cache deferred;
  - resource lists tied to "Stop at References";
  - ← / → step sentences until M4.
- [ ] **Step 6: Push and confirm CI is green** on both OSes, with the summary showing the installer deltas. **M3 is done.**
- [ ] **Step 7: Commit.** `test(e2e): reader happy path and restart restores place; CI installer budget; record M2/M3 decisions`.

---

## Next plans (not in scope here)

- **M4 Voice:** TTS protocol cancel/recycle first, then prefetch, player bar (replaces `PlayerBarPlaceholder`; ← / → become ±15 s), Media Session, sleep timer, and the "Finished" state with Next. Also the text cache if Task 14 Step 7 says so.
- **M5 Save as audio:** text layer and selection bubble, the first-time tip.
- **M6 Settings & themes:** Settings screen with Reading toggles over `settings.reading`, Deep Sea switch, Pixel Quest, Kitty.
- **M7 Ship:** Windows Open With registration, onboarding guide, release hardening.
