# Tide M6: Settings & Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This milestone adds the Settings screen (with Look, Reading and Pronunciation tabs, plus the export folder and "Copy diagnostic info"). It also adds five themes (Sky & Sea, Deep Sea, Pixel Quest, Kitty and Match my Mac), dark pages, pronunciation fixes that apply to playback and exports, and a rotating error log. It begins by splitting the player context.

**Architecture:**
- **Settings storage.** Settings live in `library.json` → `settings` and are owned by main's `Library`.
- **Parsing.** Each new field parses leniently: a bad value falls back to its default, and no schema bump is needed.
- **Snapshots.** The renderer reads settings from the library snapshot and changes them through narrow, validated IPC. It never receives or sends a file path.
- **Themes.** A theme is the `data-theme` attribute on `<html>`, plus token blocks in `tokens.css`. Small theme-aware components (`useTheme()`) add the mascots and decorations.
- **Pronunciation.** Rules are applied in main, in one place that both the live player and exports pass through. The renderer's audio cache is emptied whenever the rules change.

**Tech Stack:** Electron 45, React 19, TS, Tailwind 4, Radix (Dialog, Tabs or plain buttons, Switch), @fontsource (bundled fonts), vitest + jsdom, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-16-tide-design.md`, in particular §5, §5.1 screens 9–10, §5.2, §6.3 step 9, §6.5, §6.8, §6.9, §7 M6 and §12. Mockups: `docs/design/screens-sky-sea.html` (screens 9–10), `docs/design/pixel-quest-reference.html`, `docs/design/kitty-theme.html`.

**Scope confirmed with Yasin (2026-11-24):**
- All five themes, with Kitty and Pixel Quest last, so they are the first to cut.
- "Copy diagnostic info" and the rotating log are in M6.
- The player-context split is in M6 (Task 1).

## Global Constraints

- Machine quirks: run `unset ELECTRON_RUN_AS_NODE` before npm, vitest, electron or playwright. Work in `cd /d/pdf-narrator && …`.
- Installs use `NODE_EXTRA_CA_CERTS=D:/pdf-narrator/.superpowers/roots.pem` and **exact version pins** (no `^`).
- There is no network at runtime. Fonts, mascots and images are bundled and served same-origin. The CSP is `style-src 'self' 'unsafe-inline'`. The `TIDE_OFFLINE_GUARD=1` e2e must stay green.
- The renderer never sends or receives a file path. Main opens every folder dialog.
- Library parsing is lenient per field: one bad value resets only that field (the e961d3e pattern). Never return null for the whole library because of a new settings field. `schemaVersion` stays 1.
- Changing a reading filter must keep her place (R8: the rebuild continues playback). This already works through `filtersKey` in `ReaderView.tsx:292`, so don't break it.
- Copy rules (§5): controls are labelled in words. Kitty's playful copy never replaces the plain meaning, and every accessible name stays plain.
- IP: **no Nintendo IP** (Pixel Quest uses an *original* sprout-critter mascot) and **no Sanrio/Hello Kitty IP** (no bow on one ear, no mouthless white cat). Mochi is a ginger tabby.
- Under `prefers-reduced-motion: reduce`, nothing animates: no blinking cursor, no animated waves, no Mochi animation, and no 150–250 ms transitions.
- Tokens: every colour a component uses is a CSS custom property. New theme blocks define **every** token that `:root[data-theme='sky-sea']` defines.
- Contrast: every new text/background pair must be ≥ 4.5:1. The spec's Pixel Quest and Kitty values are already checked; check any pair you invent.
- Nothing from `local-fixtures/` may reach code, tests, logs or commits.
- Commit after each task. Feature-branch pushes are allowed. Never push to `main`.

## Review Focus

1. **Pronunciation edge words.** These must be tested in Task 6:
   - Words with regex characters (`C++`, `(n)`), non-ASCII letters (`Šabić`, `Bourdieu's`) and a word inside a longer word (`schema` in `schematic`) are replaced only as whole words.
   - A multi-word entry (`New York`) beats a shorter overlapping one (`York`).
   - A respelling that contains another rule's word is not replaced again (one pass).
2. **Changing a rule mid-sentence while playing.** Audio already made with the old rule must not keep playing for the next sentences. The cache is emptied and the current sentence restarts (Task 6).
3. **Export folder gone.** If the chosen folder is deleted, or its drive is removed between choosing it and saving, the save fails with the existing `folder-missing` toast. It never silently falls back to a different folder, and Settings still shows the folder (Task 5).
4. **Match my Mac flipping while the app is open.** The OS switching light/dark at night must re-theme live, with no reload. Dark pages must follow (Tasks 3 and 8).
5. **Hand-edited or downgraded library.json.** An unknown theme id, a non-boolean `darkPages`, a pronunciation list holding a non-object, or an export folder that isn't a string each reset only that field (Task 2).

---

## File map

| File | Responsibility |
|---|---|
| `src/renderer/src/player/PlayerContext.tsx` (modify) | split into actions, state and sleep contexts (Task 1) |
| `src/shared/library/types.ts` (modify) | `ThemeId`, `Pronunciation`, new `LibrarySettings` fields, `SettingsPatch`, snapshot `exportFolder` |
| `src/main/library/schema.ts`, `library.ts`, `ipc.ts` (modify) | parse, setters and IPC for the new settings |
| `src/preload/index.ts`, `index.d.ts` (modify) | bridge for the new channels |
| `src/renderer/src/theme/theme.ts` (create) | `resolveTheme`, `isDarkTheme`, `useTheme()` |
| `src/renderer/src/theme/ThemeRoot.tsx` (create) | applies `data-theme` and `data-dark-pages` on `<html>` |
| `src/renderer/src/theme/copy.ts` (create) | per-theme playful copy table |
| `src/renderer/src/assets/tokens.css` (modify) | Pixel Quest and Kitty token blocks, reduced motion |
| `src/renderer/src/settings/SettingsDialog.tsx` (create) | dialog, tab nav, diagnostic button |
| `src/renderer/src/settings/LookTab.tsx`, `ReadingTab.tsx`, `PronunciationTab.tsx` (create) | the three tabs |
| `src/renderer/src/lib/useZoom.ts` (create) | zoom stepping shared by the menu and Settings (moved out of `App.tsx`) |
| `src/shared/text/pronounce.ts` (create) | pure `applyPronunciations` |
| `src/main/speak.ts` (create) | `makeSpeak(host, rules)`: the one synthesis entry that applies the rules |
| `src/main/log.ts` (create) | rotating log and diagnostic text |
| `src/renderer/src/theme/mascots/*.tsx` (create) | the Sprout and Mochi SVG components |
| `tests/e2e/settings.spec.ts` (create) | Settings e2e |

---

### Task 1: Split the player context

The parked /simplify item. Today `PlayerValue` mixes stable actions with state that ticks about once a second during a sleep timer, so every `usePlayer()` consumer re-renders every second. This task is behaviour-neutral.

**Files:**
- Modify: `src/renderer/src/player/PlayerContext.tsx`, `PlayerBar.tsx`, `SleepPopover.tsx`, `VoicePopover.tsx`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/save/SavePanel.tsx`
- Test: `tests/renderer/player-contexts.test.tsx` (create)

**Interfaces:**
- Produces:
  - `usePlayerActions(): PlayerActions`. Its fields are `play`, `pause`, `toggle`, `skip`, `readFrom`, `setVoice`, `setSpeed`, `preview`, `stopPreview`, `setSleep`, `playNext`, `dismissFinished` and `refreshAudio` (added in Task 6). The object identity is stable for an engine's lifetime: its memo depends only on `engine`, and it reads everything else through refs.
  - `usePlayerState(): PlayerStateValue`. Its fields are `snapshot`, `chosenSpeed`, `finishNote`, `finished` and `estimateSec`.
  - `useSleep(): SleepState`.
  - `usePlayer()` is deleted, and every consumer moves to the narrowest hook it needs.

- [ ] **Step 1: Write the failing test.** Render `PlayerProvider` with `fakeDeps` (from `tests/renderer/reader-fakes.tsx`) and a child that calls only `usePlayerActions()` and counts its renders. Set a 10-minute sleep timer and advance fake timers by 5 s.

```ts
it('an actions-only consumer does not re-render while the sleep timer counts down', ...)
  expect(rendersAfterTimer - rendersBefore).toBe(0)
it('a useSleep consumer sees secondsLeft fall', ...)
  expect(secondsLeftAfter).toBeLessThan(secondsLeftBefore)
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/player-contexts.test.tsx`. Expected: FAIL, because `usePlayerActions` is not exported.
- [ ] **Step 3: Implement the three contexts and migrate the five consumers.** Keep the single `PlayerProvider` component.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: all green, including the existing player, sleep, finish-in and voice-popover suites with no changes to their assertions.
- [ ] **Step 5: Commit** `refactor: split the player context into actions, state and sleep`.

---

### Task 2: Settings model, parsing and IPC

**Files:**
- Modify: `src/shared/library/types.ts`, `src/main/library/schema.ts`, `src/main/library/library.ts`, `src/main/library/ipc.ts`, `src/main/export/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`
- Test: `tests/unit/library/library.test.ts`, `tests/unit/library/ipc.test.ts`, `tests/unit/export/ipc.test.ts`

**Interfaces:**
- Produces (in `types.ts`):

```ts
export const THEME_IDS = ['sky-sea', 'deep-sea', 'pixel-quest', 'kitty', 'system'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export interface Pronunciation { word: string; sayAs: string }
export const PRONUNCIATION_LIMITS = { words: 200, wordLen: 60, sayAsLen: 120 } as const
// LibrarySettings gains:
//   theme: ThemeId          default 'sky-sea'
//   darkPages: boolean      default true
//   pronunciations: Pronunciation[]  default []
// LibraryFile.settings also gains exportFolder: string | null (null = Music/Tide). It is NOT in
// LibrarySnapshot.settings. Instead, LibrarySnapshot gains:
//   exportFolder: { name: string; custom: boolean }   // name = basename only, "Tide" when default
export interface SettingsPatch { theme?: ThemeId; darkPages?: boolean; reading?: Partial<ReadingFilters> }
```

- Library methods:
  - `setSettings(p: SettingsPatch): void`
  - `setPronunciations(list: Pronunciation[]): void`
  - `exportFolder(): string | null`
  - `setExportFolder(path: string | null): void`
- IPC channels and preload bridge:
  - `library:settings` → `tide().library.setSettings(p)`
  - `library:pronunciations` → `setPronunciations(list)`
  - `library:choose-export-folder` → `chooseExportFolder(): Promise<'chosen' | 'cancelled'>`. Main shows `dialog.showOpenDialog` with `openDirectory` and `createDirectory`.
  - `library:reset-export-folder` → `resetExportFolder()`
- Export: `registerExportIpc` gains `defaultFolder?: () => string | null`. When it returns a path, that folder is used as-is, with no `Tide` subfolder (like R29). When it returns null, `exportDir(musicDir)` is used. Per-save "Choose another folder" is unchanged.

**Validation rules:**
- `setSettings` rejects (BadArgs) a patch with unknown keys, an unknown theme, a non-boolean, or an unknown filter key.
- `setPronunciations` cleans the list before storing it:
  - trims `word` and `sayAs`;
  - drops entries with an empty `word` or empty `sayAs`;
  - caps the lengths at `PRONUNCIATION_LIMITS`;
  - keeps the **last** entry when two words are equal case-insensitively;
  - caps the list at 200 entries.
  - A non-array argument, or a non-object entry, is rejected with BadArgs.
- `parseSettings` is lenient per field: an unknown theme becomes `'sky-sea'` and a non-boolean `darkPages` becomes true. A pronunciations value that is not an array becomes `[]`, and a bad entry is dropped. A non-string `exportFolder` becomes null.

- [ ] **Step 1: Write the failing tests.**

```ts
// schema (library.test.ts or a new schema test block)
it('defaults the new settings for an M5 library.json', () =>
  expect(parseLibrary(m5File)!.settings).toMatchObject({ theme: 'sky-sea', darkPages: true, pronunciations: [] }))
it('resets only a bad theme', () => { /* theme: 'neon' → 'sky-sea'; readings untouched, not null */ })
it('drops a bad pronunciation entry and keeps the good ones', () =>
  /* [{word:'Vygotsky',sayAs:'vih-GOT-skee'}, 42, {word:''}] → one entry */)
it('a non-string exportFolder becomes null', ...)
// library
it('setPronunciations keeps the last of two case-insensitive duplicates', () =>
  /* [{schema,a},{Schema,b}] → [{Schema,b}] */)
it('the snapshot carries only the export folder name, never the path', () =>
  expect(JSON.stringify(lib.snapshot())).not.toContain(tmpDir))
// ipc
it('library:settings rejects an unknown theme and an unknown key', ...)
it('library:settings with reading: { skipFootnotes: false } changes only that filter', ...)
// export ipc
it('saves into the chosen default folder with no Tide subfolder', ...)
it('a deleted default folder fails with folder-missing, not a fallback', ...)
```

  The last test is Review Focus 3. If `mkdir(recursive)` would quietly recreate a deleted folder, check that the folder's **parent** exists first. If the parent is missing, fail with `folder-missing`.

- [ ] **Step 2: Run** `npx vitest run tests/unit/library tests/unit/export/ipc.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the types, parse, setters, IPC, preload, and the `defaultFolder` wiring in `index.ts` (`() => lib.exportFolder()`).
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: settings model for theme, dark pages, pronunciation and export folder`.

---

### Task 3: Theme engine and Match my Mac

**Files:**
- Create: `src/renderer/src/theme/theme.ts`, `src/renderer/src/theme/ThemeRoot.tsx`
- Modify: `src/renderer/src/App.tsx` (mount `ThemeRoot`), `src/renderer/src/assets/tokens.css`, `src/renderer/src/assets/main.css`, `src/main/index.ts`
- Test: `tests/renderer/theme.test.tsx`

**Interfaces:**
- Consumes: `ThemeId` and `LibrarySettings.theme`/`darkPages` (Task 2).
- Produces:
  - `type ResolvedTheme = Exclude<ThemeId, 'system'>`
  - `resolveTheme(id: ThemeId, osDark: boolean): ResolvedTheme`. `'system'` resolves to `'deep-sea'` when `osDark` and to `'sky-sea'` otherwise.
  - `isDarkTheme(t: ResolvedTheme): boolean`. This is true only for `'deep-sea'`: Pixel Quest's page is light cream and Kitty is light.
  - `useTheme(): { id: ThemeId; resolved: ResolvedTheme; dark: boolean }`. It reads `osDark` from `useMediaQuery('(prefers-color-scheme: dark)')`, which Electron drives from `nativeTheme`, so no IPC is needed.
  - `ThemeRoot` sets `document.documentElement.dataset.theme = resolved` and `dataset.darkPages = String(dark && settings.darkPages)`.
- Main: the `BrowserWindow` `backgroundColor` follows the stored theme's `--bg` at creation, so a dark user gets no white flash. It reads the library before the window is created; if that order is awkward, use `nativeTheme.shouldUseDarkColors` for `'system'`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('resolves system to deep-sea when the OS is dark and sky-sea when light', ...)
it('re-themes live when the OS flips', () => {
  // render with theme 'system', mocked matchMedia light → html[data-theme=sky-sea];
  // fire the media change to dark → html[data-theme=deep-sea] without remount
})
it('dark pages flag is set only for a dark resolved theme with darkPages on', ...)
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/theme.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Also add one global block to `main.css`: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green. `index.html` keeps `data-theme="sky-sea"` as the first-paint value.
- [ ] **Step 5: Commit** `feat: theme engine with Match my Mac and reduced motion`.

---

### Task 4: Settings dialog and the Look tab

**Files:**
- Create: `src/renderer/src/settings/SettingsDialog.tsx`, `src/renderer/src/settings/LookTab.tsx`, `src/renderer/src/lib/useZoom.ts`
- Modify: `src/main/menu.ts`, `src/shared/ipc-types.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/shelf/Shelf.tsx`
- Test: `tests/renderer/settings.test.tsx` (create), `tests/unit/menu.test.ts`

**Interfaces:**
- Consumes:
  - `tide().library.setSettings` (Task 2);
  - `useTheme` (Task 3);
  - the zoom logic now in `App.tsx`. Move it, unchanged in behaviour, into `useZoom(snapshot): { zoom: number; step(d: 1 | -1): void }`. The menu command and the A−/A+ buttons both call `step`.
- Produces:
  - `AppCommand` gains `{ type: 'settings' }`.
  - The menu gains **Settings…** with accelerator `CmdOrCtrl+,`. On macOS it goes in the app menu, after About; on Windows and Linux it goes in File. Help gains the line `${mod},  Settings`.
  - `<SettingsDialog open onOpenChange initialTab?: 'look' | 'reading' | 'pronunciation'>` is a Radix Dialog with the title "Settings". Its left nav holds the three tab buttons, which use `aria-current` for the selected tab, and it fills its body with tab components. Later tasks add `ReadingTab`, `PronunciationTab` and the diagnostic button.

**Layout (mockup screen 9):**
- Nav column 180 px, using the shelf gradient.
- Tiles grid: five tiles in the order Sky & Sea, Deep Sea, Pixel Quest, Kitty, Match my Mac. Use `repeat(auto-fill, minmax(110px,1fr))`.
- Each tile is a `radio` in a `radiogroup` labelled "Theme".
- On Windows, the Match my Mac tile reads **"Match my PC"**.
- **"Dark pages in dark themes"** is a Switch with the small line "Turn off for readings with lots of charts or photos."
- **"Text size in the reader"** shows A− / % / A+.
- The shelf footer gets a **"⚙ Settings"** button that opens the dialog.

- [ ] **Step 1: Write the failing tests.**

```ts
it('Ctrl+, (the settings command) opens Settings on the Look tab', ...)
it('picking Deep Sea calls setSettings({ theme: "deep-sea" })', ...)
it('A+ steps zoom by the same step as the menu and shows the new %', ...)
it('the shelf footer Settings button opens the dialog', ...)
// menu.test.ts
it('Settings… has CmdOrCtrl+, and sends { type: "settings" }', ...)
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint`. Expected: green. The existing zoom tests in `app-shell`/`app-library` still pass.
- [ ] **Step 5: Commit** `feat: Settings dialog with the Look tab and Ctrl+,`.

---

### Task 5: Reading tab, with Save audio to

**Files:**
- Create: `src/renderer/src/settings/ReadingTab.tsx`
- Test: `tests/renderer/settings.test.tsx`

**Interfaces:**
- Consumes:
  - `setSettings({ reading: {...} })`, `chooseExportFolder()`, `resetExportFolder()`;
  - `snapshot.exportFolder` (Task 2).

**What the tab shows:**
- Six Switches, in the spec's order, with these exact labels:
  1. "Skip page numbers, headers and footers"
  2. "Skip footnotes"
  3. "Stop at References"
  4. "Skip captions and table text"
  5. "Skip cover and copyright pages"
  6. "Read citations aloud", with the small line "e.g. “(Smith, 2019)”. Off reads more smoothly."
- A note under the switches: "A reading set to Read everything ignores these."
- Then a section **"Save audio to"**:
  - the folder name, shown as `Music › Tide` when it isn't custom, or as the name otherwise;
  - a **"Change folder…"** button;
  - a **"Use Music › Tide"** button, shown only when the folder is custom.

- [ ] **Step 1: Write the failing tests.**

```ts
it('turning off Skip footnotes sends only that filter', () =>
  expect(setSettings).toHaveBeenCalledWith({ reading: { skipFootnotes: false } }))
it('changing a filter while playing keeps the place (R8)', ...)
  // reuse the Read everything rebuild harness from reader.test.tsx: playing sentence index i,
  // flip a filter via the snapshot, expect engine index to resolve to the same anchor and phase 'playing'
it('shows Music › Tide by default and the folder name when custom, with no path', ...)
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: Reading settings tab and export folder setting`.

---

### Task 6: Pronunciation engine for playback and exports

**Files:**
- Create: `src/shared/text/pronounce.ts`, `src/main/speak.ts`
- Modify: `src/main/ipc.ts`, `src/main/index.ts` (route the `tts:synthesize` and export `synthesize` through `speak`), `src/renderer/src/player/engine.ts`, `src/renderer/src/player/PlayerContext.tsx`
- Test: `tests/unit/text/pronounce.test.ts`, `tests/unit/speak.test.ts`, `tests/unit/player/engine.test.ts`

**Interfaces:**
- `applyPronunciations(text: string, rules: readonly Pronunciation[]): string`. It builds **one** alternation regex:
  - longest word first;
  - each word regex-escaped;
  - bounded by `(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])`;
  - flags `giu`.
  
  It replaces in one pass with the matching rule's `sayAs`. Cache the compiled regex per rules array identity.
- `makeSpeak(host: Pick<TtsHost,'synthesize'>, rules: () => readonly Pronunciation[]): TtsHost['synthesize']`. It applies the rules to `text` for every request **except** `priority: 'preview'` requests. Previews are the Listen button, which sends the exact respelling.
- `PlayerEngine.refreshAudio(): void` empties the cache: it cancels in-flight gens, revokes the URLs and clears the entries. It then restarts the current sentence from its start if playing, the same way a voice change does. It is a no-op when nothing is cached.
- `PlayerContext` calls `engine.refreshAudio()` when `JSON.stringify(snapshot.settings.pronunciations)` changes, but not on the first snapshot. It exposes the call as `usePlayerActions().refreshAudio`.

- [ ] **Step 1: Write the failing tests.**

```ts
const R = [{ word: 'schema', sayAs: 'SKEE-muh' }, { word: 'York', sayAs: 'YORK-x' },
           { word: 'New York', sayAs: 'noo-york' }, { word: 'C++', sayAs: 'see plus plus' },
           { word: 'Šabić', sayAs: 'SHAH-bitch' }]
expect(applyPronunciations('Schema and schemata; schematic.', R)).toBe('SKEE-muh and schemata; schematic.')
expect(applyPronunciations('New York, York.', R)).toBe('noo-york, YORK-x.')
expect(applyPronunciations('I like C++ a lot', R)).toBe('I like see plus plus a lot')
expect(applyPronunciations('Šabić’s view', R)).toBe('SHAH-bitch’s view')
expect(applyPronunciations('x', [{ word: 'x', sayAs: 'schema' }, ...R])).toBe('schema') // one pass
expect(applyPronunciations('unchanged', [])).toBe('unchanged')
// speak.test.ts
it('live and export requests get the rules; preview requests do not', ...)
// engine.test.ts
it('refreshAudio cancels cached gens and re-requests the current sentence while playing', ...)
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, then wire `speak` in `index.ts`, so both `registerIpc` and `registerExportIpc` receive it in place of the raw host.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: pronunciation fixes applied before synthesis, in playback and exports`.

---

### Task 7: Pronunciation tab

**Files:**
- Create: `src/renderer/src/settings/PronunciationTab.tsx`
- Test: `tests/renderer/settings.test.tsx`

**Interfaces:**
- Consumes:
  - `setPronunciations` (Task 2);
  - `tide().tts.synthesize(sayAs, { voice, speed: 1, priority: 'preview' })` for Listen, in her current voice;
  - `usePlayerActions().stopPreview`/the preview pause pattern from VoicePopover. Listen pauses the reading the same way voice previews do.

**Behaviour:**
- Each row (mockup screen 10) shows: **word**, then "says", then the respelling field, then **"▶ Listen"**, then **"Remove"**. The fields have the accessible names "Word" and "Sounds like".
- **"＋ Add a word"** appends an empty row and focuses its Word field.
- Edits save on blur or Enter. Rows with an empty word or empty respelling aren't sent; they stay as drafts until filled.
- Listen is disabled while the respelling is empty.
- The intro line reads: "For words the voice gets wrong. Type how it should sound, then Listen to check."
- The tab shows a hint when the list reaches 200: "That's the most Tide can keep."

- [ ] **Step 1: Write the failing tests.**

```ts
it('Add a word, type Vygotsky / vih-GOT-skee, blur → setPronunciations([{word:"Vygotsky",sayAs:"vih-GOT-skee"}])', ...)
it('Listen synthesizes the respelling with priority preview in her voice', ...)
it('Remove drops the row and saves', ...)
it('a draft with an empty respelling is not saved', ...)
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Play the returned audio through the same preview `<audio>` path that VoicePopover uses. Reuse the existing helper; don't add a second audio element.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: Pronunciation settings tab with Listen`.

---

### Task 8: Dark pages

**Files:**
- Modify: `src/renderer/src/assets/main.css`, `src/renderer/src/reader/PdfPage.tsx` (the canvas gets `data-pdf-canvas`)
- Test: `tests/renderer/reader.test.tsx`, `tests/e2e/settings.spec.ts` (create)

**Interfaces:**
- Consumes: `html[data-dark-pages="true"]` (Task 3).
- CSS: `html[data-dark-pages='true'] canvas[data-pdf-canvas] { filter: invert(1) hue-rotate(180deg); }`. The filter goes **only** on the canvas, so the text layer, the highlight layer and the selection, which are siblings above it, are unfiltered and keep their token colours.

- [ ] **Step 1: Write the failing tests.**
  - renderer: `it('the PDF canvas is marked data-pdf-canvas and the highlight layer is not inside it')`.
  - e2e (`settings.spec.ts`, dev build):
    1. Open the fixture reading.
    2. Open Settings, pick Deep Sea, and close Settings.
    3. Assert that `getComputedStyle(canvas).filter` contains `invert`, and that the highlight layer's computed `filter` is `none`.
    4. Turn Dark pages off, and assert the canvas filter is `none`.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/reader.test.tsx`, then `npx playwright test tests/e2e/settings.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS. Also confirm `boxesInsideCanvas` (`tests/e2e/helpers.ts`) still holds in Deep Sea.
- [ ] **Step 5: Commit** `feat: dark pages filter for dark themes`.

---

### Task 9: Rotating error log and Copy diagnostic info

**Files:**
- Create: `src/main/log.ts`
- Modify: `src/main/index.ts`, `src/main/ipc.ts`, the `console.error('[tide] …')` call sites in main (route them through the log), `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/main.tsx` (renderer error hooks), `src/renderer/src/settings/SettingsDialog.tsx`
- Test: `tests/unit/log.test.ts`

**Interfaces:**
- `createLog(dir: string, o?: { maxBytes?: number; home?: string }): Log`. The default `maxBytes` is 512 KiB.
- `Log.error(scope: string, err: unknown): void`. It appends `ISO-time [scope] message\nstack` to `dir/tide.log`.
  - It replaces every occurrence of `home` (`os.homedir()`) with `~`.
  - When the file would pass `maxBytes`, it renames it to `tide.1.log`, replacing the old one, and starts afresh.
  - It never throws, and it also writes to `console.error`.
- `Log.diagnostics(info: Record<string, string>): Promise<string>`. It returns a plain-text block:
  - `Tide <app version>`, Electron, OS and release, arch, and the voice engine status;
  - theme and dark pages, and the reading filters;
  - the **count** of pronunciation fixes (never the words);
  - the last 200 lines of `tide.1.log` + `tide.log`.
- IPC:
  - `app:log` (renderer → main). Arguments: `scope` is `'renderer'`, and `message` is a string capped at 4000 characters. Main ignores anything else.
  - `app:copy-diagnostics`. Main writes the text with `clipboard.writeText` and resolves `true`.
- Process hooks: `process.on('uncaughtException' | 'unhandledRejection')` in main. In the renderer, `window.addEventListener('error' | 'unhandledrejection')` calls `tide().app.log`.
- UI: a **"Copy diagnostic info"** button at the bottom of the Settings nav. On success it shows the toast **"Copied. Paste it into a message to whoever helps you with Tide."**

- [ ] **Step 1: Write the failing tests.**

```ts
it('appends with time and scope and replaces the home dir with ~', ...)
it('rotates to tide.1.log past maxBytes, keeping one old file', ...)
it('never throws when the folder cannot be written', ...)
it('diagnostics lists the pronunciation count but not the words', ...)
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/log.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and wire.** The log directory is `join(app.getPath('userData'), 'logs')`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: rotating error log and Copy diagnostic info`.

---

### Task 10: Pixel Quest theme

Read `docs/design/pixel-quest-reference.html` ("Coast route") first.

**Files:**
- Modify: `tokens.css` (`:root[data-theme='pixel-quest']`), `main.css` (theme-scoped rules), `package.json` (`@fontsource/press-start-2p`, exact pin), `src/renderer/src/main.tsx`, `PlayerBar.tsx`, `ShelfRow.tsx`/`Shelf.tsx`, `EmptyState.tsx`
- Create: `src/renderer/src/theme/mascots/Sprout.tsx`, `src/renderer/src/player/DialogueBox.tsx`
- Test: `tests/renderer/themes.test.tsx` (create), `tests/unit/tokens.test.ts`

**Theme requirements:**
- **Tokens:** use the spec §5.2 Pixel Quest values, mapped onto every Sky & Sea token name. Square corners, 3 px double "pixel" borders and 3 px offset hard shadows come from `--radius-*`/`--shadow-*` tokens or theme-scoped rules. Don't fork components.
- **Fonts:** Press Start 2P is for labels and headings only, at 7–11 px, and never for reading text or the PDF.
- **`DialogueBox`:** rendered above the player only when `resolved === 'pixel-quest'` and a sentence is current. It mirrors the current sentence's text, with `aria-hidden="true"` because it duplicates the page. The cursor blinks, except under reduced motion.
- **Course badges:** use the five badge colours in course order, cycling, with white text.
- **Decoration:** pixel waves are a CSS/SVG strip.
- **Mascot:** Sprout is an *original* sprout critter on the empty shelf. **No Nintendo IP.**

- [ ] **Step 1: Write the failing tests.**
  - In `tokens.test.ts`, every token in the sky-sea block is defined in the pixel-quest block, and every text pair the spec lists for it is ≥ 4.5:1. Extend the existing parser.
  - In `themes.test.tsx`, the dialogue box shows the current sentence under pixel-quest and is absent under sky-sea, and badge colours cycle.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Install the font with `NODE_EXTRA_CA_CERTS=… npm i -E @fontsource/press-start-2p@<current>`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint`. Expected: green. Then run the dev e2e with `TIDE_OFFLINE_GUARD=1 npx playwright test tests/e2e/smoke.spec.ts tests/e2e/settings.spec.ts`. Expected: green, with no network requests.
- [ ] **Step 5: Commit** `feat: Pixel Quest theme`.

---

### Task 11: Kitty theme

Read `docs/design/kitty-theme.html` first. The mockup's SVGs (Mochi, paw, yarn ball, sleepy kitten) are the source art; port them as React components.

**Files:**
- Modify: `tokens.css` (`:root[data-theme='kitty']`), `main.css`, `package.json` (`@fontsource/fredoka`, `@fontsource/nunito`, exact pins), `main.tsx`, `PlayerBar.tsx`, `SleepPopover.tsx`, `VoicePopover.tsx`, `Shelf.tsx`/`ShelfRow.tsx`, `EmptyState.tsx`, `Toast.tsx`
- Create: `src/renderer/src/theme/mascots/Mochi.tsx` (head, peeking pose, box pose, sleepy pose), `src/renderer/src/theme/copy.ts`
- Test: `tests/renderer/themes.test.tsx`, `tests/unit/tokens.test.ts`

**Interfaces:**
- `themeCopy(resolved: ResolvedTheme, key: CopyKey): string | null` holds the extra playful line for Kitty and returns null elsewhere. Kitty's lines are: `playing` → "Purring along", `moved` → "File wandered off · Find it", `sleep` → "Nap timer", `emptyShelf` → "Mochi is waiting for a story".
- Every accessible name stays plain: the Sleep button's accessible name stays as it is today, and "Nap timer" is the visible label only. "File moved" stays in the accessible name.

**Theme requirements:**
- **Tokens:** use the spec §5.2 Kitty values, with larger radii of 14–24 px.
- **Fonts:** Fredoka for headings and buttons, Nunito for UI. The PDF keeps its own fonts.
- **Controls:**
  - the play/pause button is a paw pad;
  - the progress bar is a yarn thread with a yarn ball at the current position;
  - Add reading and primary buttons get cat-ear tips;
  - course labels get paw prints;
  - "Nap timer" shows a curled-up kitten;
  - each voice in the picker gets a differently tinted kitten avatar.
- **Mochi:** peeks over the player bar while playing, with no animation under reduced motion, and sits in a box on the empty shelf.
- **No Sanrio IP.**

- [ ] **Step 1: Write the failing tests.**
  - In `tokens.test.ts`, the kitty block is complete and its pairs are ≥ 4.5:1.
  - In `themes.test.tsx`:
    - under kitty, the sleep button's visible text is "Nap timer" and its accessible name is unchanged;
    - Mochi peeks only while playing;
    - each voice row has a distinct avatar tint;
    - the "File moved" row keeps "Find it" in its accessible name.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint`, then the offline-guard e2e as in Task 10. Expected: green.
- [ ] **Step 5: Commit** `feat: Kitty theme with Mochi`.

---

### Task 12: Settings e2e and packaged check

**Files:**
- Modify: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Write the e2e tests.**

```ts
test('the theme persists across a relaunch', ...)          // pick Kitty, close, relaunch → html[data-theme=kitty]
test('Ctrl+, opens Settings', ...)
test('a pronunciation fix changes the synthesized text', ...)
  // add {word:'attention', sayAs:'uh-TEN-shun'}; use the e2e hook to read the last text main sent to the
  // worker. Add a test-only `tideTest.recentSynthTexts()` in preload behind --tide-e2e, recorded in makeSpeak.
test('turning off Skip footnotes rebuilds and keeps playing', ...)
```

- [ ] **Step 2: Run** `npx playwright test tests/e2e/settings.spec.ts`. Expected: PASS.
- [ ] **Step 3: Run the full packaged suite.**

```
npm run package
TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test
```

  Expected: all green, apart from the known flaky uncached jump test (local limit 4.5 s). Re-run that test alone if it misses.
- [ ] **Step 4: Commit** `test: Settings e2e and packaged run for M6`, then push the branch and confirm CI is green on both OSes.
