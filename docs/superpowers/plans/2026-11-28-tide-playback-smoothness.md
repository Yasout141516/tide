# Tide: Playback smoothness and table-text fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- Playback starts quickly and never leaves a long silent hole after Play, a seek, or a change of voice, speed, pronunciation or filter.
- Sentence hand-offs are tight.
- Table and number text can never stall or kill the voice.
- Speed gets its own player button.

**Architecture:** The renderer's player engine (`src/renderer/src/player/engine.ts`) drives clip requests and an `<audio>` element. The voice runs in a utilityProcess (`src/tts/*`), reached through main (`src/main/tts-host.ts`). The text pipeline (`src/shared/text/*`) builds sentences. This plan's fixes sit at those three layers.

**Evidence and root causes:** `.superpowers/sdd/2026-11-27-tide-m7-ship/playback-bug-report.md` holds the measured numbers. Implementers read the section for their task. The harness scripts are in the scratchpad `dbg/` folder named in the report.

**Spec:** `docs/superpowers/specs/2026-11-16-tide-design.md`, sections §5 (player controls), §6.3 (text pipeline), §6.4 (playback and highlighting) and §8.

## Global Constraints
- These are the same machine quirks and constraints as M7: `.superpowers/sdd/2026-11-27-tide-m7-ship/common-context.md`.
- No paper or course-reading text in tests. Build synthetic fixtures. Nothing from `local-fixtures/`.
- The highlight must stay in sync with the spoken sentence (§8). The place must be kept across a rebuild (R8).
- Exports are unchanged in output, apart from Task 2's text changes: they still use Kokoro's native speed (R26) and the chosen voice.

## Rulings (Yasin asked for smooth playback; recorded 2026-11-28)
- **RS-1: speed via `playbackRate` for live playback.** Live playback is synthesised at 1× and played at the chosen speed with `preservesPitch`. A speed change is then instant, with no re-synthesis. Timeline and estimate maths use the effective rate. Exports still synthesise at the chosen speed. Finish-in still works, because its effective speed becomes the playbackRate.
- **RS-2: voice change applies from the next sentence.** The current sentence finishes in the old voice, and audio prefetched beyond it is dropped and re-requested in the new voice. The voice popover's Listen preview still pauses the reading, then resumes it when the preview ends or stops, if it was playing before.
- **RS-3: a sentence that fails or times out is skipped,** not retried forever. The player moves to the next sentence, shows a plain toast once ("Tide skipped a passage it couldn't read aloud."), and logs it. The worker restart stays as it is.
- **RS-4: the speed control becomes its own player button "1× ▾",** next to the voice button "Emma". This replaces "Emma · 1×". Yasin chose this on 2026-11-28, and it changes §5's five-control list to six.

---

### Task 1: Progressive first clips (no silent hole)
**Files:** `src/renderer/src/player/clips.ts`, `src/renderer/src/player/engine.ts`; tests `tests/unit/player/clips.test.ts`, `tests/unit/player/engine.test.ts`.
- [ ] Replace the 2-piece first split with a **progressive split**. The first piece is at most about 8 words, at a clause boundary when one exists within reach, otherwise a word boundary. Each later piece is at most about 2× the previous piece's word count, so each piece's synthesis (about RTF × its audio) finishes before the previous piece's audio ends. Apply it to the sentence playback (re)starts at: Play, seek, refreshAudio, and a filter rebuild. Pieces must rejoin exactly to the sentence text. Keep the "1,000" and "12:30" no-split rules.
- [ ] Request the pieces in order, keeping the `front` priority for the first.
- [ ] Tests:
  - pieces rejoin exactly;
  - piece word counts grow by at most 2×;
  - the first piece is ≤ 8 words;
  - in the engine test with a fake TTS client at RTF 1.0, no silent gap longer than 1 s occurs after Play on a 40-word sentence. Simulate clip durations as words × 0.35 s.
- [ ] Re-run the report's harness against the real worker and record the new hole after Play and after a seek. Target: no hole longer than about 1 s.
- [ ] Commit `fix: progressive first clips so playback never leaves a silent hole`.

### Task 2: Table and number text never reaches the voice
**Files:** `src/shared/text/filters.ts` (and wherever table-text detection lives), the sentence builder (`src/shared/text/sentences.ts` / `pipeline.ts`); tests under `tests/unit/text/`.
- [ ] **Table detection.** Fix the two measured misses: cells merge when the label-to-number gap is under 2× the font size, and the number column jitters 5 pt against a 4.4 pt tolerance. Add a **numeric-density rule**: a line, or a run of lines, whose tokens are mostly numbers, brackets or percentages, with at most a short label, is table text when "Skip captions & table text" is on. Under "Read everything" it is still read.
- [ ] **Page-start break.** A sentence must not join across a page boundary into text that is table or figure material at the top of the next page. More generally, a de-hyphenated cross-page join must attach to the first *body* line of the next page, not to a table header or rows.
- [ ] **Sentence cap.** No sentence handed to the player exceeds about 300 characters. Longer ones are split at clause boundaries (`;`, `:`, `,`, a dash), falling back to word boundaries. The highlight anchors must still map each piece to its exact text.
- [ ] **PIPELINE_VERSION.** Bump it, because spoken output changes and the cache key must change.
- [ ] Tests use synthetic `PageText` fixtures (see `tests/unit/text/helpers.ts`):
  - a two-column page with a full-width numeric table at the top of page 2, after a page 1 line ending in "mar-"; the result is "…mar" + "riages" joined, and no table text is spoken;
  - a table whose label gap and column jitter match the measured values;
  - a 600-char prose sentence split into pieces of ≤ 300 chars that rejoin exactly.
- [ ] Run `npm run spoken-text` on the paper in the report's scratchpad folder, locally only. Record the longest sentence length and that no Table 1 or page-8 table text remains. Never commit that text.
- [ ] Commit `fix: keep table and number text out of speech and cap sentence length`.

### Task 3: A slow or failing sentence never kills the voice
**Files:** `src/main/tts-host.ts`, `src/renderer/src/player/engine.ts`, `src/renderer/src/player/PlayerContext.tsx`, the toast copy; tests `tests/unit/tts-host.test.ts`, `tests/unit/player/engine.test.ts`.
- [ ] **Progress-based timeout.** Replace the whole-job deadline with one that resets on each synthesized chunk (worker progress), so a long but progressing job never times out. Keep a hard per-chunk limit.
- [ ] **RS-3.** When a sentence fails twice, skip it: move to the next sentence, toast once per reading, and `logError`. The voice stays usable. The "voice isn't working" state is only for repeated failures across different sentences.
- [ ] Tests:
  - a fake worker that is slow but keeps sending chunks never times out;
  - a sentence that always fails is skipped and playback continues;
  - the toast is shown once.
- [ ] Commit `fix: slow sentences don't time out and a failing one is skipped`.

### Task 4: Tight sentence hand-offs (trim clip silence)
**Files:** `src/tts/worker.ts` or `src/tts/engine.ts`, wherever PCM leaves Kokoro; tests `tests/unit/tts-*.test.ts` or a new `tests/unit/trim.test.ts`.
- [ ] Trim leading and trailing silence in each clip's PCM to about 70 ms, using an amplitude threshold over a short window. Never cut speech: keep a safety margin and fade at the cut points to avoid clicks. Apply it to live playback and exports alike, since the shorter pauses read better in exports too. Clip durations change, so check that Timeline/estimates use real durations.
- [ ] Tests:
  - synthetic PCM with 310 ms of leading and 470 ms of trailing silence around a tone is trimmed to about 70 ms each side;
  - samples above the threshold are never removed;
  - an all-silent clip stays valid and short.
- [ ] Measure the real sentence-to-sentence gap with the harness. Target: under about 250 ms when prefetched.
- [ ] Commit `fix: trim clip silence for tight sentence hand-offs`.

### Task 5: Settings changes without a pause (speed, voice, Listen)
**Files:** `src/renderer/src/player/engine.ts`, `PlayerContext.tsx`, `src/renderer/src/player/sink.ts` (the audio element), `timeline.ts`, `finish-in.ts`; tests in `tests/unit/player/*` and `tests/renderer/player.test.tsx` / `voice-popover.test.tsx`.
- [ ] **RS-1.** Live requests are synthesised at speed 1. The sink sets `playbackRate` to the effective speed (chosen × Finish-in) with `preservesPitch = true`. setSpeed changes the rate on the playing clip immediately and causes no restart. Timeline, estimateSec and finish-in maths use the effective rate. Exports are unchanged: they synthesise at the chosen speed via the export path.
- [ ] **RS-2, voice.** setVoice keeps the current sentence playing. It drops and re-requests only the entries after the current one, in the new voice. If nothing is playing, behaviour is unchanged.
- [ ] **RS-2, Listen.** The voice popover's Listen pauses the reading. When the preview ends or is stopped (popover closes, another preview, Play), the reading resumes if it was playing before the preview. The Pronunciation tab's Listen follows the same rule.
- [ ] Tests:
  - setSpeed during playback makes no new synth request and updates playbackRate;
  - setVoice during playback keeps the current entry and re-requests the next ones;
  - Listen while playing, then the preview ends, resumes playback; Listen while paused stays paused.
- [ ] Commit `fix: speed and voice changes apply without a pause; Listen resumes the reading`.

### Task 6: Time-based prefetch
**Files:** `src/renderer/src/player/engine.ts`; test `tests/unit/player/engine.test.ts`.
- [ ] Replace AHEAD=3 sentences with prefetching until at least about 30 s of audio is ready ahead. Estimate unsynthesised sentences from words × average seconds per word at the effective rate. Cap it at about 8 entries in flight, within CACHE_MAX. If memory needs it, raise CACHE_MAX modestly, with a comment.
- [ ] Test: with a fake client at RTF 1.1 on short sentences, playback never stalls after the first sentence. The fake gives a constant chunk rate.
- [ ] Commit `fix: prefetch by time so slow machines keep ahead`.

### Task 7: Speed gets its own player button (RS-4)
**Files:** `src/renderer/src/player/PlayerBar.tsx`, `VoicePopover.tsx`, a new `SpeedPopover.tsx` (or menu); tests `tests/renderer/voice-popover.test.tsx`, `tests/renderer/player.test.tsx`, e2e helpers and any spec that clicks "Emma · 1×".
- [ ] Split the voice button: **"Emma"** opens the voice list, with Listen and voices only. A new **"1× ▾"** opens the five speeds (0.8× 1× 1.25× 1.5× 2×), using the existing radio pattern and an accessible name like "Speed, 1×". The Finish-in effective speed still shows, as it does today.
- [ ] Follow the existing button styles and tokens, ≥36 px, and the Kitty and Pixel Quest theme styles for player buttons. The keyboard focus ring comes from the global rule.
- [ ] Update every test and e2e that uses "Emma · 1×": tests/e2e/helpers.ts, player.spec.ts, keyboard.spec.ts, settings.spec.ts. Update docs/acceptance-v1.md row 10b's list of stops.
- [ ] Commit `feat: speed gets its own player button`.

### Task 8: Verify end to end

Yasin's instruction (2026-11-28): measure smoothness on his real documents, not on the synthetic "morning fog" fixtures.
- Run the measurements on her readings in the git-ignored `local-fixtures/` (5 PDFs) and on his paper (the scratchpad copy). That means the gap harness, the hole after Play, seek and settings changes, the sentence hand-off gap, and the longest sentence.
- Add a local-only e2e, `tests/e2e/local-smoothness.spec.ts`, following `tests/e2e/local-readings.spec.ts`. It skips when `local-fixtures/` is absent, so CI is unaffected. For each local PDF it plays about 60 s from a mid-reading point and asserts:
  - no audio gap over about 1.5 s;
  - no stall;
  - a speed change and a voice change cause no gap over about 1.5 s.
- Report aggregate numbers per reading index only. Never quote or name a reading, and keep their text out of committed tests, goldens, logs and commits (repo-wide copyright rule). Committed unit tests stay synthetic.
- [ ] Run the full `npx vitest run`, typecheck and lint. Run `npm run package`, then `TIDE_PACKAGED=1 TIDE_OFFLINE_GUARD=1 npx playwright test`. The known flaky jump test may be re-run alone once.
- [ ] Use the report's harness on the real worker to record, before and after: the hole after Play, seek, speed, voice and pronunciation changes; the sentence hand-off gap; and the longest sentence on the paper. Write these into the report.
- [ ] Push and run a release dry run.
