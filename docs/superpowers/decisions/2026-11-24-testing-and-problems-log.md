# Tide: testing failures and problems log, M0 to 2026-11-24

**Update 2026-11-28.** This log now also covers M6 (Settings and themes, merged to `main` at 1272cef on 2026-11-25) and M7 (Ship, branch `feat/m7-ship`, to 2026-11-28). The M0 to M5 sections below are unchanged except for added rows in the Counts table (section 1), the watch list (section 8) and the lessons (section 9). The new material is in section 10 (M6) and section 11 (M7). New sources: the M6 rulings document (branch `docs/m6-rulings`), the controller's M6 notes, the M7 ledger and per-task reports in `.superpowers/sdd/2026-11-27-tide-m7-ship/`, `git log` for `f37c533..1272cef` and `1272cef..feat/m7-ship`, and `gh run view` for the CI runs named. Where those did not say something, the text says "unconfirmed" or "not stated". Local readings are still referred to by index or in aggregate only.

A record of every way testing failed and every problem the project has hit from M0 (2026-11-16) to today (2026-11-24). It is meant for Yasin and for later Claude sessions that pick the project up. It is written to be learned from, not to look good.

Sources: the SDD ledger for M4+M5 (`.superpowers/sdd/2026-11-19-tide-m4-m5-voice-save-audio/progress.md`, rulings R1-R37), the per-task reports, `final-review.md`, `final-fix-report.md`, `code-review-fix-report.md`, `simplify-report.md`, the handoffs in `.superpowers/`, the three rulings documents in `docs/superpowers/decisions/`, `docs/spikes/m0-results.md`, `git log --all`, and GitHub Actions logs read with `gh` (16 runs inspected). Where a source did not say, this document says "unconfirmed" or "not stated". Local readings are referred to by index only; nothing from `local-fixtures/` is quoted or named.

Conventions: "ledger" means the M4+M5 progress file. "Important" is the reviewers' own severity label. Times in CI runs are UTC from GitHub's metadata. RTF = synthesis seconds per second of audio (below 1 is faster than real time).

Two corrections to earlier notes, found while writing this:

- The ledger says CI for 7460637 "was superseded". GitHub shows run 45369338552 on 7460637 completed **green on both OSes**, with macOS e2e 32 passed. So the R35 preemption code had one clean macOS pass, on a fast runner (RTF 0.41).
- CI run 45430542312 (25a3962, since superseded by the head c3b9f5d) **failed on macOS in the unit-test step** (see section 3, row 15), so the packaged e2e never ran on macOS. Windows was green (31 e2e; export with playback 1.11 s of audio per second; jump 1597 ms). The macOS failure was the 1 s default `vi.waitFor` timeout in an export unit test that spawns real ffmpeg. The ledger and handoff did not have this; they said CI on 25a3962 was pending. Ruling R38 fixed it (R38a, commit 1fc391c) and the export-while-playing failure (R38b, commit c3b9f5d); CI run 45434908281 on c3b9f5d is green on both OSes (section 3 row 16).
- Yasin asked that every problem say how it was solved. Each table has a "How we solved it" column (fix, commit, ruling, verification), or a paragraph follows; items not solved say "Not solved yet" with the plan.

---

## 1. Summary

Tide's testing has been strong on unit coverage and weak in three places: wiring across mocked seams, timing on shared CI runners, and verification of anything that needs a real device (sound, a real mouse, a Mac). Most serious defects were found by a reviewer reading the diff, not by a failing test. Of the 33 Important findings tallied below, a test caught almost none first; the one real product-breaking wiring bug (every export failed) was caught by a new end-to-end test only because a human wrote that test as the last task of the milestone.

macOS CI has been the main source of red runs. The cause is mostly runner speed: the same macOS image has produced a TTS RTF anywhere between 0.41 and 1.45 across runs of this branch, which moves first-audio time between 1.1 s and 8.8 s. Fixed timing limits fail under that variance, so the jump test needed three rounds of loosening (R23, R25, R32), and its current margin is thin.

The two macOS failures open earlier are now solved (R38, 2026-11-24): the export-while-playing e2e failure was export starvation when synthesis is slower than real time (R38b), and the unit-test timeout was a 1 s default `vi.waitFor` (R38a). CI run 45434908281 on c3b9f5d is green on macOS and Windows. What remains open is a list of unfixed minors and owner checks.

### Counts

These are my tallies from the sources named above. "Important" counts include findings opened by a fix round (a regression introduced by a fix) because each of those needed its own fix.

| Category | Count | Notes |
|---|---|---|
| Review findings rated Important, fixed | 33 | M4 Tasks 1-10: 14 (T3 1, T6 3, T7 2, T8 2, T9 2, T10 4, plus none for T1/T2/T4/T5); follow-ups 10a-10e: 8 (10a 3, 10b 1, 10d 1, 10e 3 incl. 1 opened by a fix); M5 Tasks 11-15: 4 (T11 1, T14 3); final review 3; /code-review 3 plus 1 opened by the fix of R37 |
| Spec-failed (small) findings from task reviews | 5 | T13 S1, S2; T15 S1, S2, S3 |
| Minors promoted to must-fix | 2 | m19 PlayingBlocker, finishIn corrupts library.json |
| Critical findings | 0 | Every review, including the Opus whole-branch review, reported none |
| Bugs introduced by a fix, found on re-review | 3 | `leavesKeysAlone` modifier short-circuit (10e round 1); front clips requested in reverse order (10a round 1); R37 stuck-pending failed entry (code-review round). T6/T7 none. Separately, re-reviews twice found a new test that passed without its fix (T14 "stale Try again", R37 follow-up). See section 5 |
| Product bugs that mocks or stubs hid until an e2e or review | 2 | Detached `this` in export IPC (3e87fd6); renderer ignoring main's export limits (final I2) |
| Product regressions found by /code-review | 1 | 0.8x played at 1x (10c regression, fixed 1a4e2f6) |
| Failed CI runs (whole run red) | 10 | 7 macOS-only, 2 Windows-only, 1 both. 5 of the 10 are on the M4+M5 branch |
| Cancelled CI runs | 1 (known) | 45429796506, by the workflow's own concurrency setting, not a failure |
| CI runs red from a real product or build defect | 3 | osx-sign crash (R15), narrow-layout e2e (83b8f98), M0d chapter language (9e9b86d) |
| CI runs red from timing or runner speed | 6 | jump test x3, export-while-playing (starvation confirmed, solved by R38b), Windows cold-launch width, macOS export ipc unit test (1 s `vi.waitFor`, solved by R38a) |
| Flaky tests catalogued | 14 | Section 4 |
| Environment and tooling problems | 15 | Section 2 |
| Targets missed and ruled | 4 | First audio under 2 s (M0a), RTF under 1 on Windows with q8 (fixed by fp32), jump at or under 1.5 s (R18), jump at or under 3 s in e2e (R25) |
| Global Constraints superseded by a ruling | 3 | R16, R17, R21 |
| Copyright near-misses | 2 | T9 (M0/M1) fragments in a commit, 10b brief naming a real identifier; both caught before shared history or code |
| Still open | 12 items (2 more resolved 2026-11-24 under R38) | Section 8 |
| M6: review findings fixed in task reviews (added 2026-11-28) | 19 | T3 2, T4 1, T5 2, T7 3, T9 3, T10 4, T11 2, T12 2; T1, T2, T6, T8 were clean. The M6 sources do not label severity per finding (only T11 says "Important"), so these are findings fixed, not Important findings |
| M6: defects found by re-review of Task 9's fix rounds | 7 | Round 2: 3, round 3: 3, round 4: 1. All in the path scrub and log rate limit. See section 10.2 |
| M6: final review, /simplify, /code-review | 9 + 11 + 6 | Final review 2 Important + 7 minors fixed in one wave; /simplify applied 11 cleanup groups (A-K, 10 redesigns skipped); /code-review 2 Important + 4 nits |
| M6: failed CI runs, and failed tests inside them | 3 runs, 4 test failures | 45462204975 (jump and export-while-playing), 45552715631 (jump), 45558129784 attempt 1 ("Finish in" note). All macOS; Windows green every time. A further 4 runs were cancelled by the concurrency group |
| M6: tooling or process problems | 1 | Playwright cannot fire native menu accelerators |
| M7: review findings fixed in task reviews | 20 | T1 2, T3 4, T4 9 (6 review items, 2 found by following the README in a fresh clone, 1 environment note), T5 1, T6 4 (3 findings and one Page-crashed flake); T2 was clean |
| M7: CI test failures on the first dry run | 2 tests, 1 run | 46032497501: a menu test that did not pin the platform (macOS) and an icon-render test that timed out at 5 s (Windows) |
| M7: final review, /simplify, /code-review, /security-review | 5 + 13 + 6 + 0 | Final review 5 items fixed; /simplify applied 13 items (A-M, 6 skipped by the controller); /code-review 2 Important + 4 nits; /security-review found no high-confidence vulnerability |
| M7: tooling or process problems | 3 | GitHub unreachable at the start of the session; the /security-review skill cannot run from another repo's cwd; a one-off failure in a full vitest run (Task 1 and Task 5; rerun green) |
| M7: installer size work | 5 candidates tried, 4 applied | Windows installer 478.9 to 454.2 MB (-24.7 MB, -5.2%); macOS 478.5 to 462.3 MB. Custom FFmpeg not done. See section 11.8 |
| Problems logged for M6 and M7 together | 46 and 36 | M6: 41 findings (19 + 7 + 9 + 6) + 4 CI test failures + 1 tooling = 46. M7: 20 + 2 + 5 + 6 + 3 = 36. My tallies; /simplify cleanups, the size candidates and deferred minors are not counted as problems |
| Still open, M6 and M7 (added 2026-11-28) | 8 items | O15 to O22 in section 8 |

---

## 2. Environment and tooling problems

| # | Symptom | Cause | Workaround or fix | Status | How we solved it |
|---|---|---|---|---|---|
| E1 | `npm`, vitest, electron or playwright misbehave; Electron starts as plain Node | VS Code's shell sets `ELECTRON_RUN_AS_NODE` | `unset ELECTRON_RUN_AS_NODE` before every command; PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE` before launching Tide | Permanent quirk; in the handoffs | Not a bug to fix; handled by habit and documented in the handoffs. No automated guard. Workaround stays. |
| E2 | `npm install` and model/Node downloads fail on TLS | The network intercepts TLS | `NODE_EXTRA_CA_CERTS=D:/pdf-narrator/.superpowers/roots.pem`; exact version pins for new deps. A README note was a deferred M0 minor | Permanent quirk | Solved by `NODE_EXTRA_CA_CERTS` pointing at `.superpowers/roots.pem`. Verified by installs and the model fetch working. Not solved yet: the README note (low priority). |
| E3 | `git` and worktree tools act on the wrong repo | `D:\` itself is an unrelated git repo; the native EnterWorktree tool targets it; local `main` ref can lag | Always `git -C D:/pdf-narrator`; check `origin/main`. M0/M1 and M2/M3 ruling 1: work on the feature branch in place (a worktree would also hide git-ignored `local-fixtures/` and `resources/models`) | Permanent quirk | Solved by always passing `-C D:/pdf-narrator` and working in place on the feature branch (M0/M1 and M2/M3 ruling 1; R1). Verified: no cross-repo commits recorded. |
| E4 | `npm run package` fails with EPERM; `release\win-unpacked` half-deleted | A running Tide (started before the task) held a lock on `release\win-unpacked`; Yasin's rule is never to kill it | Task 10d built into `D:\tide-installer-10d` and added a `TIDE_PACKAGED_EXE` override to `tests/e2e/launch.ts` | Worked around. `release\` still needs a rebuild after Tide is closed | Workaround: `TIDE_PACKAGED_EXE` override in `tests/e2e/launch.ts` (e8aa0e6) and a separate output dir; packaged e2e then ran 31 passed + 1 skipped. Not solved yet: `release\win-unpacked` stays half-deleted until Yasin closes Tide and reruns `npm run package`. |
| E5 | A 1 GB leftover build, `D:\pdf-narrator-release-10d` | With electron-builder's output dir not equal to `release/`, `release/` itself was packed into the asar (1+ GB). The implementer kept the real installer (456.6 MiB) but left the bad one; `rm` was blocked by the safety check | Yasin deletes it by hand (also `D:\tide-installer-10d` when no longer needed) | OPEN, owner action | Not solved yet: Yasin deletes `D:\pdf-narrator-release-10d` by hand. Prevention: keep the electron-builder output dir equal to `release/` (10d report). |
| E6 | The Task 10 implementer stopped mid-task with uncommitted WIP | Subagent hit the API usage limit; Yasin then said "finish now" | WIP saved as `task-10-wip.patch` (PDFs not in the patch; regenerate with `make-fixtures`); the same agent was resumed with SendMessage on 2026-11-22 and finished. The WIP was verified, not trusted | Resolved. Lesson in section 9 | Solved by resuming the same agent with SendMessage (2026-11-22); WIP verified, reviewed, committed as 86e754e and c6bb8ad; review findings fixed in a8514d3; task closed "review clean". |
| E7 | Push to `main` blocked by the permission classifier | Yasin's "yes" was ambiguous; pushes are outward-facing | R4: ask explicitly. On 2026-11-22 he said "yes push e2e flake fix to main" and `0154dc0` was pushed (fast-forward). Rule since: never push to main, open PRs or tag without asking each time; feature-branch pushes approved 2026-11-22 | Resolved, rule kept | Solved by R4 and by asking explicitly; 0154dc0 was pushed after his explicit yes. Verified: no further blocks recorded. |
| E8 | Hundreds of lint warnings that hide real ones | Working-tree CRLF line endings on a Windows checkout versus prettier (counts seen: about 709, 987, about 2000 at different times) | Treated as noise; errors are 0. `.gitattributes`/LF normalisation exists in git (7ef3387) but the working tree still warns | Open (cosmetic) | Not solved yet: treated as noise; lint reports 0 errors in every report. Plan: renormalise working-tree line endings if it ever hides a real warning. |
| E9 | macOS cannot be tested locally | Yasin has no Mac; macOS is verified only by GitHub Actions | CI macOS job; every Mac-only behaviour (hide-on-close, AVFoundation chapters, Gatekeeper, Now Playing) depends on it | Permanent constraint | Not solvable locally. Mitigation: every Mac-only behaviour has a CI step (hide test, AVFoundation chapters, Gatekeeper). The remaining gap is Yasin's hand-off checks (section 8). |
| E10 | No way to hear audio in CI | Runners have no sound device | Tests read the `<audio>` element's `data-phase` and TTS metrics. R14 reserved a fake sink; CI run 45003423979 showed the runners play without one, so none was built | Resolved | Solved by evidence, R14: CI run 45003423979 was green with all 8 packaged player tests on both OSes, so no fake sink was built. |
| E11 | Local e2e and vitest timings swing by 2 to 5 times | Contention on the dev machine (parallel Playwright workers, overlapping test processes). Examples: first audio 6.8-14.5 s with three parallel workers vs 3.6 s alone; export rate 0.85 overlapped vs 1.79 alone; I3 latency script ran at about 16 s per chunk | R13 `workers: 1`; measurements flagged as load-sensitive | Permanent quirk | Solved by policy: R13 `workers: 1` (a8514d3), condition waits (R9), and flagging contended numbers. Verified: serial local runs green; the remaining loaded-machine failure is F11. |
| E12 | macOS packaging failed: `RangeError: Invalid array length` (CI 45002612910) | `@electron/osx-sign` 1.3.3 depends on `isbinaryfile` ^4.0.8; 4.0.10 keeps reading after a short read while sniffing protobuf and throws on the 325 MB fp32 `model.onnx` | R15: npm `overrides` pins `isbinaryfile` 5.0.7 (same API); reproduced locally (4.0.10 throws, 5.0.7 returns true). Commit 2525d58. Do not remove the override | Fixed, CI green on 45003423979 | Fixed in 2525d58 (npm `overrides`, isbinaryfile 5.0.7), ruling R15; reproduced locally first. Verified by CI 45003423979 green on macOS and Windows. |
| E13 | Playwright launches see the shelf hidden; layout flips mid-test | CI screens are about 1024 px wide, so Tide opened in its narrow layout (Shelf behind a button). Earlier (M2/M3 ruling 11) 1100 outer px on Windows gave about 1086 content px, under the breakpoint, so the shelf was also hidden on first launch on a real window | `useContentSize` default 1200x800; `launchTide` pins 1000x700; `openShelf` helpers (83b8f98) | Fixed. See CI row 4 and 5 | Fixed by 83b8f98 (1000x700 pin, `openShelf`, layout spec) and 0154dc0 (pin waits for show); M2/M3 ruling 11 (1200x800 default). Verified: dev and packaged e2e 22/22 locally; CI 45002612910 Windows green. |
| E14 | `npm audit` reports 16 vulnerabilities | Not reviewed | Parked in M0 deferred minors | OPEN (unreviewed) | Not solved yet: `npm audit` unreviewed. Plan: review before M7 release prep. |
| E15 | Slow-machine test that cannot predict her Mac | Dev laptop (Ryzen 3 5300U) ran q8 at RTF 1.2-1.6; the macOS runner is a virtual 3-core M1; her target is an M5 Air | fp32 chosen (RTF about 0.5-0.75 on Windows). First audio to be re-measured on her M5 at hand-off (M7) | OPEN until hand-off | Partly solved: fp32 chosen 2026-11-19 (Windows RTF 0.46-0.75). Not solved yet: first audio on her M5 is unmeasured; re-measure at hand-off (M7). |

Also recorded as process hazards, not environment: a stale `release\win-unpacked` and leftover folders (E4, E5), and the ledger's copy of R33-R37 being the only one outside git (section 8).

---

## 3. CI failures, chronologically

All runs are on workflow "CI" with two jobs, `package + packaged smoke` on windows-latest and macos-latest. "Pass" and "green" mean both jobs. Columns follow the requested order.

| # | Run id | Commit | OS | What failed | Measured values | Cause | Resolution (fix) | Status | How we solved it |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 44029479479 (2026-11-17) | 8713d86 | macOS | Step "M0d: AVFoundation sees the m4b chapters" (spike M0d first attempt) | Not read in this pass; the next run's detail below | First attempt at chapters in the `.m4b` | Fixed with the chain in row 2 | Closed | Solved in the same chain as row 2 (9e9b86d). Verified: run 44031220120 green. |
| 2 | 44030363349 (2026-11-17) | ffab2ed | macOS | M0d chapter check | `AVFoundation chapters: 0`, `chapter locales: ["und"]`, expected 2; export itself fine (57 ms, 4.35 s audio, `ffmpegHasMp3: true`) | ffmpeg writes the chapter text track with language code 0, which Apple treats as undetermined | 9e9b86d: keep `-f ipod`, patch the chapter track `mdhd` language to `eng` after encoding; unit test decodes `mdhd` itself because ffmpeg cannot see the problem. Run 44031220120 (9e9b86d) green: 2 chapters | Closed | Fixed in 9e9b86d (chapter language patched to `eng`, unit test decodes `mdhd`). Verified by CI 44031220120: AVFoundation chapters 2. |
| 3 | 44339792825 (2026-11-18, on main) | e80c743 | Windows and macOS | At least 12 packaged e2e tests (`library.spec` 1-4, `reader.spec` 6-13) each hit a 30 s locator timeout (31-33 s each); `picker`/Add reading never clickable | 30 000 ms timeouts, repeated | CI screens about 1024 px wide: Tide opened in its narrow layout where the shelf and Add reading are behind the Shelf button (83b8f98's message) | 83b8f98: pin the window to 1000x700 and route shelf use through `openShelf`; new layout spec for the wide layout. Same run also shows the e80c743 change itself: the real-pipeline two-column stepping test needed a 20 s timeout (3.3 s alone, over vitest's 5 s default under full-suite load) | Closed | Fixed by 83b8f98 (window pin, `openShelf`, layout spec) and e80c743 (20 s timeout). Verified by local e2e 21/21 and the next runs. |
| 4 | 44345060519 (2026-11-18, on main) | 83b8f98 | Windows | `library.spec.ts:9`, `launch.ts:59`: `expect.poll(() => innerWidth).toBe(1000)` | Timed out at the default 5000 ms on the first cold launch only; every later launch passed that step. macOS green | On a cold first launch the resize could land while the window was still hidden and `show()` undid it, so `innerWidth` never reached 1000 | 0154dc0: wait for `domcontentloaded` and visibility, re-apply the size on every poll (20 s), confirm it holds. Dev and packaged e2e 22/22 | Closed. Windows was 15/16 (handoff) | Fixed by 0154dc0. Verified locally: dev and packaged e2e 22/22 (twice in dev); CI 45002612910 Windows green. |
| 5 | 44998638430 (2026-11-22, on main) | 0154dc0 | Windows | Vitest, `tests/renderer/highlight-resume.test.tsx` "opens at the first sentence when there is no saved place": `TypeError: el.scrollIntoView is not a function` at `ReaderView.tsx:372` | 1 failed, 400 passed (401 tests); macOS green | Not diagnosed. Looks like an effect running after the test's `scrollIntoView` stub was removed or before it was installed (unconfirmed). Not recorded in the ledger | None specific. The next runs on the feature branch passed Windows (45002612910, 45003423979). Related deflakes landed later in 10e (ea669b3). Whether they cover this exact failure is unconfirmed | Recurrence not seen since; root cause unconfirmed | Not solved yet at the cause; no specific fix. Later deflakes (86e754e, ea669b3) touched neighbouring tests. Verified only by absence: Windows vitest passed in every later run listed. |
| 6 | 45002612910 (2026-11-22) | a8514d3 | macOS | Step "Run npm run package" | `RangeError: Invalid array length` in osx-sign. Steps after it skipped | `isbinaryfile` 4.0.10 on the fp32 model (E12) | R15, commit 2525d58 | Closed | Fixed by 2525d58 (R15), reproduced locally. Verified by CI 45003423979 green. |
| 7 | 45003423979 (2026-11-22) | 2525d58 | both | Green. Later a macOS **A/B rerun** of this run (ruled R-note below) | Original macOS: first audio 3658 ms, RTF cold 0.779 / warm 0.767, load 841 ms. Windows: first audio 2688 ms, RTF 0.475/0.464. A/B rerun on 2026-11-24: first audio 6940 ms; raw synth in the log 5359 ms for 4.075 s = RTF 1.31 (warm 5189 ms = 1.27) | Same code, same image (macos-26-arm64 20261117.0516), about 1.9x slower: runner variance | The experiment is what showed the 5db31c3 failure (row 8) was noise, not a regression | Closed | No fix needed. The A/B experiment was the verification: the same code slowed about 1.9x, so row 8 was runner noise. |
| 8 | 45041086984 (2026-11-22) | 5db31c3 (after 10a-10e) | macOS | `player.spec`, the jump test ("a jump to another paragraph starts speaking within 3 s", later renamed) | First attempt: first audio 8544 ms vs 3658 on 45003423979; jump 9580 ms vs limit 6000 ms. Rerun reproduced: first audio 8776, jump 9570, raw synth RTF 1.45 (log: 5900 ms; warm 5758 ms). Windows green: 571 unit tests, 25 packaged e2e, first audio 2115 ms, jump 1955 ms | First suspicion: a 10a regression in `worker.ts`/`engine.ts` (yield between chunks, phonemizer warm-up, 120-token chunks, split shortcut). The A/B in row 7 showed the old commit slowing the same way | Rerun plus A/B; R32 (row 9) | Closed by ruling | Solved by ruling: R32 plus the A/B evidence. Verified by CI 45358770905 (green) and the fix-round re-review (Haiku, clean). |
| 9 | 45355571818 (2026-11-24) | 40f9e9a (M5 Task 15) | macOS | Same jump test again. 31 passed, 1 failed. All 5 save-audio e2e passed on macOS. The whole-reading `.m4b` AVFoundation chapter check **did not run** (skipped, see below) | Jump 8178 ms vs limit 6000; first audio 6013 ms. Log: raw synth 3143 ms = RTF 0.77, load 788 ms (so the smoke RTF looked normal while first audio was slow) | Runner speed on the jump path | R32: CI limit = max(6000, 2 x the same test's measured first audio); local stays 4500. Fix round 1 52d5e94 | Closed by ruling | Solved by R32 (limit = max(6000, 2x first audio)), commit 52d5e94, with test fixes S1-S3. Verified by CI 45358770905 green on both OSes including the AVFoundation check (3 chapters); re-review Haiku clean. |
| 10 | 45358770905 (2026-11-24) | 52d5e94 | both | Green | macOS: 32 e2e passed; AVFoundation check passed on the whole `.m4b` (3 chapters). First audio 5889 ms; jump 10232 ms vs R32 limit 11328 ms (ratio about 1.8). Raw synth 4345 ms = RTF 1.07, warm 3947 ms = 0.97, load 2513 ms | n/a | n/a | Green, but margin 1.1x (see row 14 for the thin margin) | No fix needed; this run verified R32 and the M5 e2e on macOS. |
| 11 | 45369338552 (2026-11-24) | 7460637 | both | Green (the ledger calls this run "superseded"; GitHub shows success) | macOS: first audio 1096 ms; jump 2512 ms vs limit 6000 (test first audio 1497 ms); export-while-playing passed in 1.0 min; raw synth 1663 ms = RTF 0.41, warm 1624 ms = 0.40; 32 passed. First run with the R35 scheduler | Fast runner | n/a | Closed | No fix needed; verified the R35 scheduler on a fast runner. The ledger line calling it superseded is wrong. |
| 12 | 45372915897 (2026-11-24) | 31b82aa (after /simplify) | macOS | `save-audio.spec.ts:149` "exporting while playing keeps playback going": `expect(locator).toBeVisible()` failed after 30 s; the Saved toast never appeared. Test ran 3.2 min. 31 passed, 1 skipped, 1 failed. Windows green | First audio 4683 ms; jump passed at 10186 ms vs limit 11886 ms (test first audio 5943 ms); raw synth 4752 ms = RTF 1.17, warm 5439 ms = 1.33. Unit step: 655 passed | Confirmed (R38b, run 45434908281): R35 preemption in `src/tts/scheduler.ts` `runHigher` runs every pending live job before each export chunk. On a runner slower than real time (RTF above 1), live playback keeps the pending-live queue full (3-ahead prefetch), so the export starves. Consistent with: same test passed pre-R35 on RTF about 1.0 (52d5e94) and post-R35 on RTF 0.41 (7460637), failed post-R35 on RTF 1.17-1.33. Confirmed by the RED test (order e1,l1,l1,l1...) and by the green macOS run in row 16 | R38b (c3b9f5d): `runHigher` runs at most ONE higher-priority job per chunk boundary | **Solved (R38b)** | Solved by R38b (c3b9f5d). RED test order e1,l1,l1,l1...; GREEN test e1,l1,e2,l1,e3. Verified by CI 45434908281 (row 16): macOS export with playback 70.3 s of audio in 134.6 s (0.52 s/s), Saved toast arrived. |
| 13 | 45429796506 (2026-11-24) | 6d755ae | n/a | **Cancelled**, not failed | n/a | The workflow's `concurrency` group (`ci-${{ github.head_ref || github.ref_name }}`, `cancel-in-progress: true`) cancels an in-progress run when a newer push to the branch arrives; 25a3962 was pushed next | None needed; this is by design | Closed. Read "cancelled" as "no information", not "failed" | Nothing to solve; by design. The next push (25a3962) produced run 45430542312. |
| 14 | (not a run) | 52d5e94 vs later | macOS | The R32 margin | 11328 vs 10232 ms (1.107x headroom) on 45358770905; 11886 vs 10186 ms (1.167x) on 45372915897. Jump/first-audio ratio was 1.09-1.36 on the three earlier failing runs and about 1.7-1.8 on the three most recent runs (10232/5664, 10186/5943, 2512/1497); why it rose is unconfirmed | The limit is 2x the test's own first audio; the actual ratio drifted up | None. R32 has no floor or cap on first audio (up to about 180 s on a pathological run) | **OPEN, watch** | Not solved yet. Plan: if CI flakes, scale by the measured ratio, cap the limit, or report instead of assert on CI. |
| 15 | 45430542312 (2026-11-24) | 25a3962 | macOS failed; Windows green | macOS step "Run npm test" (vitest), so package, packaged e2e, M0b and M0d were all **skipped**. `tests/unit/export/ipc.test.ts:148` "saves a safely named, chaptered file, reports progress and reveals it": `expected "vi.fn()" to be called 2 times, but got 1 times` | macOS: 1 failed, 666 passed (667); test took 1064 ms. Windows: 31 e2e passed; export with playback 1.11 s of audio per second; jump 1597 ms | `vi.waitFor`'s default timeout is 1 s. Real ffmpeg is spawned between the two `host.synthesize` calls and on the slow macOS runner that took over 1 s, so the second call had not happened when the wait gave up. Not a product bug; not in the engine code 25a3962 changed | R38a (1fc391c): explicit 10 s `vi.waitFor` waits in `tests/unit/export/ipc.test.ts` | **Solved (R38a)** | Solved by R38a (1fc391c). Verified by CI 45434908281 (row 16): macOS `npm test` passed and the packaged e2e ran, which also answered the row 12 question. |
| 16 | 45434908281 (2026-11-24) | c3b9f5d | both | Green | macOS (a slow runner): first audio 8262 ms; "export with playback: 70.3 s of audio in 134.6 s (0.52 s/s)" and the Saved toast arrived; jump 7661 ms vs limit 9016 ms; 32 e2e passed; the AVFoundation checks ran. Windows: export with playback 0.81 s/s; jump 1998 ms vs limit 6106 ms; 31 e2e passed | n/a | R38a (1fc391c) and R38b (c3b9f5d) | Closed | No further fix needed. Verified R38a, R38b and the unit-to-e2e chain on a slow macOS runner. |

### How a "skipped" step hides a failure

How we solved it: not solved by code yet. The AVFoundation check was re-run on a later green run (45358770905). Plan: see 6.7 and Lesson 5.

- In row 9 (45355571818) the whole-reading `.m4b` AVFoundation check was skipped, not passed: the M0b and M0d steps carry `if: runner.os == 'macOS'` (ci.yml lines 106 and 175), and an `if:` condition replaces the implicit `success()`, so an earlier failure should have skipped them. The GitHub job shows them as skipped. The macOS chapter result for M5 was therefore unknown until the next run (row 10) passed it.
- The same pattern in row 12 (45372915897): M0b and M0d skipped after the failed e2e step. And in row 15: the package and e2e steps never ran, so nothing about 25a3962's packaged behaviour on macOS was known; run 45434908281 (c3b9f5d, row 16) later passed the macOS e2e.
- On Windows those two steps always show as skipped because they are macOS-only; that is not a gap.

### Runner speed variance (macOS image macos-26-arm64 20261117.0516, same image in every run below)

Raw synth is the smoke test's 4.075 s sentence from the job log (latest attempt of each run, so reruns show the rerun). RTF = ms / 4075.

| Run | Commit | Raw synth cold ms | RTF cold | Warm ms | RTF warm | Load ms | First audio ms | Jump ms |
|---|---|---|---|---|---|---|---|---|
| 45003423979 (original, from ledger) | 2525d58 | n/a | 0.779 | n/a | 0.767 | 841 | 3658 | n/a (no jump test yet) |
| 45003423979 (A/B rerun, from log) | 2525d58 | 5359 | 1.31 | 5189 | 1.27 | 2163 | 6940 (ledger) | n/a |
| 45041086984 (rerun, from log) | 5db31c3 | 5900 | 1.45 | 5758 | 1.41 | 1295 | 8776 | 9570 |
| 45355571818 | 40f9e9a | 3143 | 0.77 | 3145 | 0.77 | 788 | 6013 | 8178 |
| 45358770905 | 52d5e94 | 4345 | 1.07 | 3947 | 0.97 | 2513 | 5889 | 10232 |
| 45369338552 | 7460637 | 1663 | 0.41 | 1624 | 0.40 | 642 | 1096 | 2512 |
| 45372915897 | 31b82aa | 4752 | 1.17 | 5439 | 1.33 | 2183 | 4683 | 10186 |
| 45434908281 | c3b9f5d | n/a | n/a | n/a | n/a | n/a | 8262 | 7661 |

Reading the table:

- On the same image, RTF spans 0.40 to 1.45 and first audio spans 1.1 to 8.8 s. That is a 3.6x range in raw synthesis and a 8x range in first audio.
- Row 45355571818 shows the smoke RTF is not enough to predict the jump failure: RTF 0.77 but first audio 6013 ms. The slowdown there is not visible in the smoke metric alone (cause unconfirmed).
- Earlier history from the ledger: macOS RTF 0.77-1.25 and Windows RTF 0.47-2.6 across runs seen up to 2026-11-22; M0a's macOS runs were 0.84-0.85 and 1.13.
- Windows runners have been faster and steadier on this branch: first audio 2115-2688 ms, jump 1955 ms, RTF 0.46-0.475 in the runs with ledger numbers.
- The macOS run that led to R32 (jump 8178 ms) would have passed a limit scaled by that run's own first audio (6013 x 2 = 12 026 ms).

### The macOS jump-test saga in order

1. R18 (2026-11-22): the plan's goal of at most 1.5 s from click to speech for an uncached jump was ruled missed (see section 7). Local packaged measurements were 2.4-3.4 s.
2. R23: the e2e asserts at most 3 s locally and at most 6 s when `CI` is set, always logging the value (because 10a measured 2.6-3.6 s on long sentences locally).
3. 10d review I1: the 3000 ms local limit already flaked (2 of 4 uncached runs at 3162 and 3381 ms). R25 raised the local limit to 4500 ms (commit 5db31c3). CI stayed at 6000 ms.
4. CI 45041086984 (macOS): 9580 ms against 6000 ms. Rerun reproduced it (9570 ms). The 10a changes were the first suspect.
5. A/B: rerunning the pre-follow-up commit 2525d58 on the same image gave first audio 6940 ms against its original 3658 ms, so the old code slowed about 1.9x as well. Conclusion: runner noise.
6. CI 45355571818 (M5 Task 15): 8178 ms against 6000 ms, first audio 6013 ms. R32 made the CI limit max(6000, 2 x first audio in that test), with the limit logged and the test renamed. Jump to first-audio ratios on the failing runs were 1.09-1.36, so 2x still catches a real regression.
7. 52d5e94: passed at 10232 ms against 11328 ms. Ratio now about 1.8, close to the 2x bound.
8. Current state: 45372915897 also passed the jump at 10186 ms against 11886 ms. Margins are 1.11x and 1.17x. A slightly slower jump on a slow runner will fail it, and the limit has no cap.
9. On 25a3962 (45430542312) Windows measured jump 1597 ms; macOS never reached the e2e (row 15).
10. On c3b9f5d (45434908281, row 16) macOS, a slow runner (first audio 8262 ms), passed the jump at 7661 ms against a limit of 9016 ms; Windows 1998 ms against 6106 ms.

**How we solved the jump saga.** R18, R23, R25 and R32 (commits 5db31c3, 52d5e94), verified by green runs 45358770905 and 45372915897. Not solved yet: the thin margin (row 14).

---

## 4. Flaky tests

"Recurs" is as of 2026-11-24. "Fix" lists what the sources record; where a root cause was never captured, that is stated.

| # | Test | Symptom | Suspected or confirmed cause | How we solved it (fix and when) | Still recurs? | How we solved it |
|---|---|---|---|---|---|---|
| F1 | `highlight-resume` "opens at the saved place and scrolls it into view" (renderer, jsdom) | Failed in 1 of 3 full-suite runs in Task 7; seen again 10a | Load-sensitive timeout. T8 minor: "root cause was never captured" | R9 (b9d9baa): 15 s jsdom `testTimeout`, wait on conditions not fixed delays. T10 reproduced nothing and changed nothing in this test | Seen again after R9 (10a); not seen in the last listed runs. Treat as open | Mitigated by R9 (b9d9baa: 15 s timeout, condition waits). Verified by 3 full runs of 496 tests. Root cause never captured, so not solved at the cause. |
| F2 | `highlight-resume` "opens at the first sentence when there is no saved place" (CI Windows 44998638430) | `TypeError: el.scrollIntoView is not a function` at `ReaderView.tsx:372` | Unconfirmed; looks like an effect firing outside the stub's lifetime | None specific. 10e deflakes later (ea669b3) | Not seen since; unconfirmed whether fixed | Not solved yet at the cause; passed on rerun and in all later runs. Plan: stub `scrollIntoView` file-wide in `tests/renderer/setup.ts` if it returns. |
| F3 | `highlight-resume` "a click after opening does not force a centred scroll" (line about 226) | One full-suite flake in 10e (passed alone and on rerun) | The test cleared the scroll spy before the open-time scroll had settled | 10e round 2: wait for the open-time scroll before clearing the spy (ea669b3). Reviewer note: it waits for the first open scroll, not a settled state | Not seen since | Fixed in ea669b3 (wait for the open-time scroll). Verified by the 10e re-review (clean) and no recurrence. |
| F4 | Player "hands-off auto-scroll" (renderer) | Timing failures in Tasks 7 and 9 under load | Suspected (inferred, not reproduced): the opening highlight's forced scroll lands after the `scrollIntoView` stub is installed and is counted | T10 (86e754e): wait for id 0 and let it settle 50 ms before installing the stub. Ledger: "a hardening on an inferred cause", still one fixed delay | Not seen since; replaced entirely by 10e's follow tests (the 5 s timer test was removed) | Hardened in 86e754e, then the test was replaced by 10e's follow tests (04278a8, 7/7 green). Verified by 5 consecutive full runs of 523/523 in Task 10. |
| F5 | Store "steady updates..." debounce (`tests/unit/library/store.test.ts`) | Seen in Tasks 7 and 9; 2 of 3 writes seen | After switching back to real timers it waited a fixed 100 ms; the in-flight write then raced temp-dir removal (`ENOTEMPTY`). Reproduced once (confirmed) | T10 (86e754e): `vi.waitFor` the third write, 100 ms to prove no fourth, `store.flush()` before teardown | Not seen since. M2/M3 final-wave minor: the throttle test's `sleep(100)` may also be flaky on a slow disk | Fixed in 86e754e (`vi.waitFor`, flush before teardown). Verified by 5 consecutive full runs (523/523) in Task 10. |
| F6 | Voice popover "lists the ten voices..." | 5255 ms against the 5 s default timeout (Task 7, 3-run check: 486, 486, then 2 failures) | Load-sensitive renderer timeout | R9: 15 s jsdom timeout | Not seen in the listed runs | Fixed by R9 (15 s jsdom timeout). Verified by 3 green full runs in Task 8. |
| F7 | Real-pipeline two-column stepping test (`reader.test.tsx`) | Crossed vitest's 5 s default under full-suite load; 3.3 s alone | Load | e80c743: 20 s timeout | No | Fixed in e80c743 (20 s timeout). Verified by later green CI runs. |
| F8 | Fake-timer leak in `player.test.tsx` (~742-825) | Task 9's new `describe` used `useFakeTimers` and leaked into the following Toast describe | Missing restore of real timers; flagged as a possible source of full-suite flakes | T9 fix round 1 (e858f3d): real timers restored. Also 10e: "fake timers installed late in the replaced player test" (minor) | Not seen since | Fixed in e858f3d (real timers restored). Verified by the T9 re-review (clean). |
| F9 | Parallel Playwright workers | Each test launches Electron plus the fp32 voice engine; parallel workers time out on voice load (first audio 6.8-14.5 s with three workers) and `first-audio.json` is last-writer-wins | Contention; shared output file | R13: `workers: 1` in `playwright.config.ts`; one writer for `first-audio.json` (a8514d3) | Fixed by policy. Cost: longer CI e2e | Fixed by R13 and a8514d3 (`workers: 1`, single first-audio writer). Verified by dev and packaged e2e 29/29 and CI 45003423979 green. |
| F10 | Windows cold-launch window pin (`launch.ts:59` poll) | CI 44345060519 | Resize lost to `show()` on first launch | 0154dc0 (20 s poll, re-apply) | No since | Fixed in 0154dc0. Verified by dev and packaged e2e 22/22 and later green Windows runs. |
| F11 | Uncached jump e2e (`player.spec.ts`) | Local: 2 of 4 runs at 3162 and 3381 ms against a 3000 ms limit; 5992 ms against 4500 ms in a loaded full packaged run (passed alone at 2454 ms); CI macOS three times (section 3) | Machine load and runner RTF; engine floor is one fp32 synthesis | R23, R25, R32 (relative limit on CI) | Recurs on loaded machines; margin thin on macOS CI (row 14) | Mitigated by R23, R25, R32 (5db31c3, 52d5e94). Verified by CI 45358770905 and 45372915897 (jump within the limit), margin thin. Not solved yet at the root (engine floor, R18). |
| F12 | Renderer suite under load, final fix wave | First full run: 3 failures in `player.test` and `save-panel.test` (15 s timeouts, one pointer-events error, worker-pool timeouts in the log); passed on rerun, 660 tests green | Load | Not fixed; rerun | Intermittent | Not solved yet; rerun passes. Plan: raise timeouts or trim work in `player.test` and `save-panel.test` if it recurs. |
| F13 | Export ipc unit test "saves a safely named, chaptered file..." | macOS CI 45430542312: called 1 time, expected 2 | Confirmed by the controller: default `vi.waitFor` timeout of 1 s too short on a slow runner, because real ffmpeg is spawned between the two synthesize calls | R38a (1fc391c): explicit 10 s waits in `tests/unit/export/ipc.test.ts` | New; passed on every earlier run listed. Not seen after the fix | Solved by R38a (1fc391c). Verified by CI 45434908281: macOS `npm test` passed. Parked minor: the `until()` helper in `ipc.test.ts` still caps at about 10 s. |
| F14 | Export-while-playing e2e (`save-audio.spec.ts:149`) | Section 3 row 12 | Suspected starvation under RTF above 1 (R35); an e2e that also accepts a finished reading and polls every 250 ms (T15 minor) | R38b (c3b9f5d) | Not seen after the fix | Solved by R38b (c3b9f5d). Verified by CI 45434908281: macOS export with playback 70.3 s of audio in 134.6 s (0.52 s/s), Saved toast arrived. Parked minor: no test covers live jobs that are pending after the last export chunk. |

Related timing-fragile tests that never failed in recorded runs but were flagged: the zoom test is wall-clock timed (M2/M3 T14 minor); the paused-countdown test uses a fixed 400 ms delay (T8); the export-while-playing test reads its start after Save (T15); T10 `clickSentence` throws at once if the page size is unknown (should poll).

---

## 5. Bugs found by review instead of tests

Format: finding, whether a test existed, why the tests missed it, fix. "Impl first" means the implementer wrote the code before the tests (no RED). Review rounds are named as in the ledger. All commits are on `feat/m4-m5-voice-save-audio` unless noted.

### 5.1 M0 and M1 (from `2026-11-17-m0-m1-rulings.md` and `m0-results.md`)

The M0/M1 ledger lists rulings made on reviewer findings rather than finding text, so details of why tests missed things are mostly not stated.

| Task | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| T1 | Important #3: electron-builder template had an example.com `publish` update URL and unused camera/mic usage strings (network and privacy hazards) | Not stated | Round 1 removed them; T5 rewrote the file |
| T3 | I1 ffmpeg-static externalised but not installed | Not stated | Deferred to T11, which owned the dependency |
| T3 | Deferred minors with real risk: synthesize timeout starts at post time, a hung synth never recycles the worker; queue stalls if `reply()` throws; unknown message type crashes the host | Tests lacked concurrent start/timeout/retry coverage | Final #3 deferred to M4 Task 1 (v2 protocol, cancel, gens, start-based timeout, recycling). `6cd16ec` handled the utilityProcess `error` event |
| T8 | I1 footnote cut removed lines in other columns; I2 caption rule too loose; I3 strong cover markers skipped wordy pages | Fixtures did not cover them | Column-scoped cut; caption regex with required punctuation; strong markers need under 150 words |
| T8 follow-up | **High severity**: body lines that start with a decimal figure reference ("Figure 6.4). In...") were dropped as captions; found running the text pipeline on the local readings (M0c) | No: the golden snapshots were generated from the code. Tests added afterwards used invented text | 40588f7 plus regression tests; 7 lines restored, 713 to 715 sentences |
| T9 | I1 test strings were fragments of a real reading | n/a (copyright) | Replaced with invented strings and amended an unpushed commit so fragments never entered shared history (1f92367) |
| T4 | `countTokens` ignored short sentences with acronyms, symbols, math characters (98bfafe) | Not stated | 98bfafe |
| Main | `tts:synthesize` accepted NaN, 0, negative or out-of-range speed (247a227) | The handler had no validation test | 247a227 plus a unit test with `ipcMain` mocked |
| Final review | #1 installer carried other-OS onnxruntime binaries, onnxruntime-web, pdf.js and its optional canvas | No size test | Package trim (dmg 323.3 to 246.3 MiB, exe 312.4 to 241.2 MiB, CI 44036153231) |
| Final review | #2 pdf.js 5.7.x affected by GHSA-hq66-cqwq-w95j | No | Exact pin 6.5.438 (fixed from 6.2.108); `PIPELINE_VERSION` 2 |
| Final review | #4 the cover rule could remove every text page; #5a line-break hyphens in compounds; #5b two-column pages with a full-width line collapse to one column | Not stated | `2cd33d6`, `1acdaf3`; #5b deferred to M3 and done there |
| Security review (Opus) | No high-confidence vulnerabilities. Notes: FFMETADATA escape lacks `\r`; `release.yml` actions pinned to major tags and checkout persists credentials during `npm ci` | n/a | Parked to M7 |

M0c on five real readings found a large list of open text-quality issues (tables with multi-word cells, end-of-chapter lists, block-quote breaks, run-in headings, citation shapes); they are catalogued in `m0-results.md` and are not repeated here.

**How these were verified.** The fix wave was verified by CI runs 44036153231 and 44036741847 (green) and the fix-wave re-review (Sonnet): all 5 findings ADDRESSED, no new Critical or Important. The security review found nothing high-confidence. Not solved yet: the parked items in the M0/M1 rulings (M3 text plan, M7 hardening).

### 5.2 M2 and M3 (from `2026-11-18-m2-m3-rulings.md`)

| Task | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| T1 | Stage remounted across the 1100 px breakpoint (would break reader state); overlay `open` went stale | Not stated | Fixed early (3245256) |
| T2 | An AV-locked backup copy could block the primary write; a failed write was not retried; `flush()` did not report success | Not stated | Best-effort backup, retry, `flush(): Promise<boolean>` (03a762d) |
| T1/T7 | Default window: 1100 outer px gave about 1086 content px, so the shelf was hidden on first launch | Layout was never exercised at that width | Ruling 11: 1200x800 `useContentSize` |
| T8 | Single-slot pick queue dropped multi-select Open With files; failures silent; weak e2e | Weak e2e | afe8e5d (FIFO queue, surface failures) |
| T9 | Missing-row click left an empty header; dead clear-selection after Remove; Remove double-click | Test gaps | Fixed early (e3bcb85) |
| T14 | Open finished after unmount leaked the doc; Open could be double-submitted; wrong password stayed in the field; held-key zoom rewound | Not stated | 4959475, 2b8917a |
| T15 | Stale jump flag; scrollIntoView not restored; dialog cleanup | Not stated | Folded into round 1 (37058f5) |
| Final wave | A transient read error on `library.json` was treated as "no file" and the shelf could be overwritten; the title was used in a locator; a trailing-debounce position write would starve under M4 auto-advance; text never loaded if she scrolled away before her page drew; "Use a different file" kept the old place; a superseded pipeline worker was never terminated | Not stated | 873c581 (six fixes) |
| Process | Footnote-start floor 3 would speak short citation footnotes (ruled 2) | The rule exists to exclude axis labels | Ruling 15 (3b3f0d0) |
| Merge gate | The branch had never run in CI and macOS had never been exercised when it was written | n/a | Run on main: rows 3-4 of section 3 |

**How these were verified.** The final whole-branch review of M2/M3 came back clean; 406 unit/renderer tests and 21 e2e passed, packaged Windows e2e 21/21. The merge gate (CI on both OSes) was later met on main (see section 3, after rows 3-4 were fixed). Not solved yet: the deferred minors per task in the M2/M3 rulings (the newer-schema message goes to M6).

### 5.3 M4 Tasks 1-10 (ledger)

| Task | Finding (Important unless noted) | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| T1 | Implementer concerns (not review Important): cancelled gens never cleared; initial load failure retryable; exit during load not recycled; worker untested | The worker had no test seam (not testable) | Minors carried; worker scheduling moved to `scheduler.ts` in the final wave (83911ec) so it could be tested |
| T3 | Prettier warnings in new tests | n/a | Fixed round 1 (8288540) |
| T3 (ruling R5) | `firstClips` split inside "1,000" and "12:30"; the plan's rule would make TTS read "paid about 1," | The plan's rule itself was wrong | R5; `, ; :` count only when followed by whitespace; test added |
| T4 | None Important. m12 (load-bearing for the crash policy): a crash rejection before `restarting` puts the engine in `error` and the later `ready` is ignored | No test; "implementation written first, weak RED" | R6 (renderer caches status, seeded once); main sends `restarting` before rejecting (pinned by `ipc.test.ts:141`). Final review closed it |
| T6 | I1 Space did not play or pause on a focused shelf row (R7 unmet, `PlayerContext.tsx:573`) | No RED for the player tests (mutation-checked instead) | R7, fix round 1 (d68aeea) |
| T6 | I2 a rebuilt sentence list stopped playback (R8 unmet, 480-494) | Same | R8 |
| T6 | I3 a stale `pushed` ref could desync the highlight from the audio after a click | Same | Retired the ref |
| T7 | I1 a voice preview was not stopped on play, toggle, skip, readFrom or popover close, so it overlapped narration | Test for "stays paused" was near-vacuous | Fix round 1 (2abd81b); lifecycle tests added. Later minor: the play/toggle/skip/readFrom stop paths are not isolated (the Play test is masked by the outside-click close) |
| T7 | I2 tests did not cover that lifecycle; no guard-while-open or idle-preview test | Weak coverage | Same round |
| T8 | I1 the page-option stop rode a 250 ms poll: up to 25% volume leaked into the next sentence and the saved position landed past the page | No wiring test | Engine `holdAfter` hook stops at the page boundary (780b13d) |
| T8 | I2 no wiring test for the page option (pageOf, remaining time, reading-id reset, finished, pause/seek during a fade) | Missing | Wiring tests added |
| T9 | I1 one-shot autoplay stayed armed when Play next targeted a missing file, firing on a later open (breaks "no autoplay on open") | Not covered | R11 (e858f3d) |
| T9 | I2 single toast slot let the sticky Restart Tide toast be replaced; `restarting` not de-duplicated | Not covered | Sticky toast plus de-dupe (e858f3d) |
| T10 | I1 R13 not applied; `first-audio.json` last-writer-wins under parallel workers | The suite had the race built in | Workers 1 and one writer (a8514d3) |
| T10 | I2 the macOS `hide()` check inside the minimise test was unverified and could fail for harness reasons | Cannot run on Windows | Split into its own test; CI run 45003423979 passed it on macOS |
| T10 | I3 no `TIDE_FAKE_AUDIO` for deviceless runners | n/a | R14: decided by CI evidence; none needed |
| T10 | I4 `clickToChangeSentence` used blind coordinate clicks and swallowed errors | Test helper hid failure | `clickSentence(win, id)` via a `tideTest`-gated centre accessor, asserts the highlight is exactly that id |
| T10 | Controller-found (CI 45002612910): macOS packaging crash | CI only | R15 |

**How these were verified.** Each task shows in the ledger as fix round then "complete (review clean)". CI evidence for M4: run 45003423979 (green on both OSes, 8 packaged player tests). Not solved yet: the minors listed in the rulings file.

### 5.4 M4 follow-ups 10a-10e

| Task | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| 10a | I1 `split.ts` live shortcut shrank to 60 characters, so most real sentences paid `countTokens` before synthesis; unmeasured | Fixtures were 30-55 characters, below the new limit | `maxTokens/1.25` etc. (ac8537d) |
| 10a | I2 a seek to a missing target cancelled and re-requested in-window in-flight jobs (waste when mashing) | Not tested | ac8537d |
| 10a | New in fix round 1: reversed front clip requests made an idle worker synthesise clip 1 before clip 0 | Introduced by the fix | 27deef6 (`pushFront` keeps same-gen order) |
| 10a | Purpose not met after round 2: clause-less sentences got no short first clip, so the whole sentence was synthesised first; a pending target was not re-fronted (`engine.ts:281`) | Measured: uncached idle 2.8 s, busy 3.8 s, second busy 6.9 s | R19 (a8d914d): word-boundary first clip after about 8 words; re-front a pending target. After: uncached 2.6-3.6 s, busy 3.8-4.2 s, second busy 2.7 s |
| 10a | Worker did not see cancel between back-to-back jobs | Untestable in unit (no worker seam) | `setImmediate` yield, found by measurement |
| 10b | I1 the owner's finding (ebook-vendor stamps read aloud) was not shown fixed: local readings were identical before and after under default filters | The cause was undiagnosed; `PIPELINE_VERSION` is read nowhere in `src` | Diagnosis (7319026): the app path already dropped every stamp under default filters (0 survive in all 5 readings); one of his 2 library readings had `readEverything: true` (set only by the More-menu item or the "Tide skipped everything" button). Vendor patterns made band/repeat-limited and continuation-guarded. R20 |
| 10c | None Important. Minors: charsPerSec taken from one 66-character preview including silence, biased low (finishes early); library/schema/ipc tests written after the code (no RED) | n/a | Deferred |
| 10d | I1 the 3000 ms local jump limit flaked (3162, 3381 ms) | e2e timing limit | R25 (4500 ms) |
| 10d | Minors: Finish-in effective-speed assertion weak at 1x (the e2e picked the option by keyboard on a short fixture); mouse path untested; `sawBuffering` could carry over | Weak assertion | `sawBuffering` reset at click; mouse path still untested |
| 10e | I1 a small scroll that keeps the line visible resumed following at once (spec miss) | Untested | R22 (ea669b3 path) |
| 10e | I2 middle-click autoscroll not detected as a user scroll | Untested | d93c994 |
| 10e | New in fix round 1: `leavesKeysAlone`'s modifier short-circuit stopped Ctrl/Shift scroll keys from pausing following | Introduced by the fix | ea669b3 |
| 10e | RED was shown only after the fact by stashing `src` | No RED first | n/a |

**How these were verified.** Each follow-up closed "review clean" after its fix rounds; packaged offline e2e 31 passed + 1 skipped; Windows CI 45041086984 green. The macOS jump failure is in section 3 (R32). 10a's R18 miss is not solved (section 7).

### 5.5 M5 Tasks 11-15

| Task | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| 11 | I1 `selectionSentences` matched first/last over spans independently; a selection covering only a running header between a cross-page sentence's two spans mapped to that sentence | Plan-mandated wording; unit RED not captured | R27 (bc6ccc0): only spans that overlap `[from,to]` count |
| 12 | None Important. Weak RED: the "no bubble" test passed before the code | Passed without the fix | n/a |
| 13 | S1 (spec) a late abort during finish's awaits could let the rename complete, leaving a full file while IPC reported cancelled | No abort-mid-finish test | 8372051: `publish()` removes `outPath` after a late abort |
| 13 | S2 (spec) all-blank sentences passed validation | Missing | 8372051 |
| 14 | I1 a sticky failure toast blocked later Saved, Audio not saved and busy toasts | Not covered | f2a6734 (dismiss on new job) |
| 14 | I2 a stale Try again or Choose another folder with a job running clobbered the job state | The test passes without the guard (the button is detached before the click); guard verified by reading only | f2a6734 (busy guard in `start`) |
| 14 | I3 a rejected `start()` showed the busy message | Not covered | f2a6734 |
| 14 | `useExport.tsx` and `names.ts` tests never RED; jsdom only | n/a | n/a |
| 15 (Task 13 bug) | **Every real export failed.** `registerExportIpc` passed `host.synthesize` and `host.cancel` to `runExport` detached; `TtsHost` methods use `this`, so synthesize threw and the `cancel(gen)` in the catch threw `Cannot read properties of undefined (reading 'child')`, masking the first error | Unit tests existed; the mock host was a plain object of `vi.fn`s, so a lost `this` was invisible. The Task 13 reviewer approved it. The Task 15 e2e found it | 3e87fd6 (arrow wrappers) plus a regression test with a `this`-dependent host |
| 15 | S1 (spec) chapter count hardcoded 3 in `ci.yml` (lines 193, 199) and the spec, instead of read from `listen.json` | Hardcoded | 52d5e94 |
| 15 | S2 Read-from-here asserted `id >= 1`, not the selected sentence; S3 MP3 artist not anchored, drag not proven across two sentences | Weak assertions | 52d5e94 |

**How these were verified.** Each task closed on its re-review (Haiku for Task 15); dev e2e 37 passed + 1 skipped; CI 45358770905 green on both OSes with the macOS AVFoundation check on the whole `.m4b`.

### 5.6 Final whole-branch review (Opus, 0154dc0..52d5e94)

0 Critical, 3 Important, 12 Minor. Fix wave 52d5e94..7460637; re-review: all 5 addressed.

| Id | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| I1 | Quit or Restart Tide during an export left `<name>.mp3.part` in Music/Tide, an orphaned ffmpeg (a normal child survives its parent and finalises the truncated `.part`), and a `tide-m4b-*` temp dir; violates spec 6.5 "a broken file never appears in her Music folder" | No test of quit with a pending export | b0a8d85, R34: abort on `before-quit` and Restart, wait up to 3 s for cleanup, SIGKILL ffmpeg. The startup sweep for stale files after a hard crash was not done |
| I2 | Main's `export:start` limits (title and baseName at most 200, sentence text at most 5000, at most 20 000 sentences) were not respected by the renderer; failure said "something went wrong" and Try again resent the same spec forever | The renderer tests stub `export.start` (`tests/renderer/setup.ts`), so the seam was never exercised; same class as 3e87fd6 | 86e89dd, R33: renderer cuts names and splits sentences; over 20 000 shows "too long for one file". New unit test sends a real renderer-built spec through main's `parseSpec` |
| I3 | A live job waited for every remaining chunk of the running export sentence (live playback only took priority between whole jobs) | The e2e only checked the highlight moves on short text; no test measured a jump during an export | 83911ec, R35: check for a higher-priority job between chunks (new `scheduler.ts`, `JobQueue.nextAbove`). Measured in plain Node on a slow box, live first clip 196 s before and 8.2 s after (the ratio is the point; not measured through the app) |
| m19 | PlayingBlocker never released when the renderer crashed or reloaded; a MacBook would never idle-sleep | No handler existed | f3f88ec |
| finishIn | An invalid `finishIn` made the **whole** `library.json` fail to parse (rename to `library.corrupt-*`, fall back to a backup likely with the same value); the ledger had understated it as "drops the reading" | New fields `voice`/`speed` were lenient; this one was not | e961d3e (falls back to null for that reading; test for 15, 50, -1, '60', true, {}, NaN) |

Minors M1-M12 of the final review and which are still unfixed are in section 8.

**How these were verified.** The fix-wave re-review (Sonnet) found all 5 ADDRESSED with no new Critical or Important; vitest 660 (3 load-timeout flakes passed on rerun); dev and packaged e2e for save-audio and player 14 passed + 1 skipped; CI 45369338552 green on both OSes. Not solved yet: the startup sweep (O4) and minors M3-M12 (O6).

### 5.7 /simplify

Four reviewers (reuse 12, simplification 15, efficiency 15, altitude 12 findings) deduped into groups A-O, applied behaviour-neutrally in 7460637..31b82aa (+535, -486 lines; G partial). It is a quality pass, not a bug hunt, and it is the commit range that CI run 45372915897 (the export-while-playing failure) ran on. No bug was attributed to it: the failing test also fits the earlier R35 change, and R38b later confirmed R35 as the cause. Redesigns it skipped are listed in `simplify-fixes.md` and in section 8.

**How this was verified.** vitest 660; e2e save-audio, player, reader 23 passed + 1 skipped locally. CI 45372915897 on its head failed on macOS in export-while-playing, which is not attributed to /simplify (section 3 row 12, O1; solved by R38b, CI 45434908281).

### 5.8 /code-review

3 Important and 3 nits on 31b82aa; fixes 31b82aa..6d755ae, plus a follow-up round 25a3962.

| Id | Finding | Test existed? / why missed | How we solved it (fix, ruling, verification) |
|---|---|---|---|
| CR1 | 0.8x played at 1x when Finish in was off: `Math.max(speed, fin?.speed ?? 1)` at `PlayerContext.tsx:207,480`; a 10c regression | No test: the effective-speed tests only asserted above 1 and at most 2 (10c review minor) | 1a4e2f6 `fin ? Math.max(speed, fin.speed) : speed`; test "a slower own speed plays as chosen when Finish in is off" (RED: expected 'Emma 0.8x', got 1x) |
| CR2 | A preempted export's host timer kept running during nested live jobs, so recycle could kill live playback (the parked item of the final wave, re-rated Important) | Deferred "with ruling" by the fixer; reviewer re-rated it | ccbd221, R36: the worker re-posts `started` after nested jobs and the host re-arms its timer on every `started` |
| CR3 | A prefetched sentence's ordinary synthesis failure stopped the current sentence | No test | 657972f, R37: failure on a non-current entry only marks it failed; raised when the cursor reaches it |
| CR nits | Export start dismissed the sticky Restart toast; drain waits piled up `closed.then` handlers; invalid page range said "Nothing to read on those pages." | The drain test counts `Promise.prototype.then` calls | 0f714f4, e4c5b19, 23b675b (R37 message "Check the page numbers."); 6d755ae a type fix in the drain test |
| Re-review | NEW Important in R37 (657972f): `onFail` never decremented `entry.pending`, so a failed entry stayed "pending", re-raised on play and seek with no retry and skewed `needsFront`. Minor: toast dedupe-by-text can alias `ownToast`'s key | The first R37 tests passed with the bug; two of the new tests (the Play-retry and seek-past-and-back) already passed without the fix because those paths evict | 25a3962: `onFail` settles `pending` like an arrival; `seek()` evicts a failed entry |

**How these were verified.** Each fix has a RED-then-GREEN unit test; vitest 668 then 672; dev and packaged e2e player and save-audio 14 passed + 1 skipped. The scoped re-review (Haiku) found 6 of 6 addressed plus one new Important (R37 stuck-pending), fixed in 25a3962 (re-review verdict pending when written). CI 45430542312 (25a3962): Windows green, macOS stopped at an unrelated unit test (R38a, solved). R38 re-review (Haiku): both findings addressed, no new Critical or Important breakage; CI 45434908281 (c3b9f5d) green on macOS and Windows.

---

## 6. Testing-method weaknesses observed

### 6.1 Mocks and stubs hiding wiring

| Instance | What the mock hid | Caught by | How we solved it |
|---|---|---|---|
| Export IPC host (3e87fd6) | Plain-object `vi.fn` host cannot lose `this`; the real `TtsHost` did | Task 15 e2e | Fixed in 3e87fd6 (arrow wrappers) with a regression test using a `this`-dependent host. Verified by the Task 15 e2e and review clean. |
| `tests/renderer/setup.ts` export stub (final I2) | Renderer-built specs never went through main's `parseSpec`; limits ignored | Opus final review | Fixed in 86e89dd with `tests/unit/export/spec-limits.test.ts`, which sends a renderer-built spec through main's real `parseSpec`. Re-review: all 5 final items addressed. |
| Task 5 `app:playing` / `app:relaunch` glue | Untested glue; "coalescing test uses a mocked snapshot" (m22) | Not found as a bug; flagged | Not solved yet: glue still untested (m22). Plan: a real-host test if it breaks. |
| Task 4 status ordering (m12) | The engine and the status event were tested in isolation; the real crash order only mattered end to end | Review (R6), then a real `TtsHost` test through `registerIpc` | Fixed by R6 (renderer status cache) and a real-`TtsHost` test through `registerIpc` (`ipc.test.ts:141`). Verified: final review closed m12. |
| T14 jsdom-only | The Save panel and `useExport` were verified in jsdom only until Task 15 | Task 15 e2e | Fixed by the Task 15 e2e (`save-audio.spec.ts`, five tests). Verified by CI 45358770905 green on macOS and Windows. |

### 6.2 Vacuous or weak tests

| Instance | Detail | How we solved it |
|---|---|---|
| T4 "late audio" test | Vacuous on URLs (m15) | Not solved yet (m15); minor. |
| T7 "stays paused" test | Near-vacuous (T7 I2) | Partly solved: T7 fix round 1 (2abd81b) added lifecycle tests. Isolation of the individual stop paths is still a minor. |
| T10a closer-rule clips test | `clips.test.ts:69-74`: the first sentence splits after word 8, the second's loop has no iterations (`w` from 3 while `< 2`), so the `CLOSERS` branch is never reached (confirmed in the final review, M10) | Not solved yet (final-review M10). Plan: use a sentence that reaches the closer rule. |
| T12 "no bubble" test | Passed before the code existed; a 50 ms sleep (weak RED) | Not solved yet; plan: replace the 50 ms sleep with a condition. |
| T14 "stale Try again" | The button is detached before the click, so it passes without the guard; guard verified by reading only | Not solved yet; the busy guard (f2a6734) is verified by reading only. Plan: keep the button attached in the test. |
| T14 `names.ts` | Test never RED | Not solved yet; minor. |
| T10 ArrowRight | `>= 2` assertion is loose | Not solved yet; minor. |
| T15 Read-from-here | `id >= 1`, later fixed to the exact sentence | Fixed in 52d5e94 (exact sentence asserted); re-review Haiku clean. |
| 10d Finish in | Effective speed asserted only at 1x on a short fixture | Not solved yet; the mouse path is an owner check (O10e). |
| 10c | Speed asserted only above 1 and at most 2; no voice-change recompute, timer-cleanup or popover chosen-speed test. This is what hid CR1 | Partly solved: CR1 got its test in 1a4e2f6. Voice-change recompute, timer-cleanup and popover tests are still missing. |
| T6 | Flush assertion in the switch test loose; no `role=menu/listbox` key tests | Not solved yet; minor. |
| T10e RED | Shown only after the fact by stashing `src` | Cannot be fixed after the fact; later 10e fix rounds added tests and the review closed clean. |
| T15 cancel test | `files()` passes if the Tide folder never existed | Not solved yet; minor. |
| T9 | `toContainEqual` does not prove "finished once" | Not solved yet; minor. |
| CR round (R37 first pass) | Two of the new tests already passed without the fix | Fixed in 25a3962 with tests that fail without the fix (RED shown). Re-review verdict for 25a3962 was pending when written. |

### 6.3 Tests written after the code (no RED)

Recorded by implementers or reviewers: Task 4 (PlayerEngine, "weak RED: implementation written first"), Task 6 (no RED for the player tests; mutation-checked instead), 10c (library/schema/ipc written before their tests), 10e (RED by stashing after the fact), T11 (unit RED not captured), T12 (weak RED), T14 (`names.ts`, `useExport`), I2 helper unit tests (`spec.ts`, no separate RED). Where a RED was captured the pattern was healthy: the code-review fix wave shows RED output for each of the 6 fixes.

**How we solved it.** Partly. Where a RED was missing, later fix rounds added tests that fail without the fix (RED output printed for each of the 6 code-review fixes, I1-I3, finishIn, m19). Not solved yet: nothing forces a RED first; the controller relies on reviewers to ask for it.

### 6.4 jsdom-only verification and what jsdom cannot do

- Real mouse drag selection in Electron was unverified at Task 11 (reviewer flag). Task 15's e2e uses `page.mouse` moves over the `[data-item-index]` divs on fixtures. The text layer's CSS drops pdf.js's `.endOfContent` helper, so dragging across gaps may select oddly; a real-window hands-on check is still owed.
- Bubble timing: it shows during the drag on `selectionchange`, not on mouse-up, and is not hidden when the selection scrolls away (T12 deferred).
- Radix submenus: the Finish in e2e picked the item by keyboard (stock Radix Sub vs Playwright pointer grace). Mouse path unverified.
- `scrollIntoView` does not exist in jsdom, so every reader test stubs it (see F2, F3, F4).
- No Mac and no sound device: hide-on-close, Media Session on macOS, AVFoundation chapters and Apple Books are CI-only or owner-only.

**How we solved it.** Partly. Task 15's real-mouse e2e (`save-audio.spec.ts`) covers drag selection on fixtures; the other items are owner checks (O10). Not solved yet: `.endOfContent` CSS, bubble mid-drag, mouse path on the Finish in submenu.

### 6.5 Fixed timing limits on noisy runners

Jump test 3 s local (flaky at 3.2-3.4 s), then 4.5 s, 6 s on CI, then R32 relative. Playwright `expect.poll` 5 s default for the window width. vitest 5 s default on renderer tests. The store debounce's fixed 100 ms. The `launchTide` size pin. Rule that emerged: use conditions or relative limits (R9, R13, R32).

**How we solved it.** R9 (condition waits), R13 (`workers: 1`), R23/R25/R32 (relative limits), 0154dc0 (window pin poll). Verified by green CI runs 45003423979, 45358770905, 45369338552. Solved: the export-while-playing timing (O1, R38b, c3b9f5d) and the default 1 s `vi.waitFor` in the export unit tests that spawn ffmpeg (R38a, 1fc391c, explicit 10 s waits), verified by CI 45434908281. Not solved yet: the R32 margin (O3).

### 6.6 Implementation-sensitive tests

- The drain test counts `Promise.prototype.then` calls (205 then-calls red, under 100 green) and needed its own type fix (6d755ae). It will break if Node or the code path changes how many promises a `write` creates.
- The 10a trim test reads private cache entries via a cast; the final review flags `as never` casts in tests (T9), and the clips test reads `resetCursor`'s `firstIdx` indirectly.
- Scheduler tests assert reply sequences (`started, started, audio`); the R36 fix had to update two existing assertions. A correct change to the protocol will therefore always touch them.

**How we solved it.** Not solved yet. The drain test was kept and given a type fix (6d755ae); scheduler assertions were updated with R36. Plan: assert the observable outcome (listener count) instead of `then` calls if it breaks again.

### 6.7 CI-only checks that can silently not run

Steps with `if: runner.os == 'macOS'` skip when an earlier step fails (section 3). The M0d step also ran `check-chapters.swift ... || true` in an early version (44030363349's command line), and `whole_n=$(cat test-results/whole.chapters)` under `bash -e` aborts without a summary if the e2e failed before writing the file (final review M9, still unfixed).

**How we solved it.** The chapter check now also runs on the whole `.m4b` and its summary shows pass or skip (52d5e94, `ci.yml`). Not solved yet: the `cat` under `bash -e` (M9) and the implicit `success()` in `if: runner.os == 'macOS'`. Plan: `if: always() && runner.os == 'macOS'` where the step is independent; meanwhile read skipped as not tested.

---

## 7. Targets missed and decisions taken because of them

| Target or constraint | Missed by | Decision | Cost accepted | How we solved it |
|---|---|---|---|---|
| M0a: first audio under 2 s after load | CI macOS 3.2 s and Windows 4.8 s (q8) | M4 plan: short first clip and warm the model at app start; re-measure on her M5 at hand-off | Still unmeasured on her machine | Partly solved: the post-load part is about 1-1.5 s (M4 status). Not solved yet on her M5; measure at hand-off. |
| M0a: RTF under 1 on Windows with q8 | 1.25-1.40 CI, 1.31-1.59 dev laptop | M0e (2026-11-19): fp32 on both OSes (RTF 0.5 dev x86 measured) | Installer +215 MiB (241.2 to 456.6 MiB) | Solved by fp32 (M0e decision). Verified: Windows dev RTF 0.62-0.74; CI Windows 0.46-0.475. |
| **R18** plan target: at most 1.5 s from click to speech for an uncached jump (idle engine) | 1.7-2.3 s (10a first measure), 2.6-3.6 s after R19, 2.4-3.4 s packaged | Accepted as missed. The floor is one Kokoro fp32 synthesis of the first clip (about 1.1-2.0 s on this machine, 2-2.5 s per the follow-up handoff). A roughly 4-word first clip would be a new decision for Yasin | She waits about 2-3 s on a far jump. Cached seek is 0.09-0.19 s and meets 0.3 s | Not solved yet; ruled R18. Plan: Yasin decides if a ~4-word first clip is worth a seam. Cached seek 0.09-0.19 s verified. |
| R19 (10a round 3) | The purpose of 10a was not met while a first clip could be a whole sentence | Word-boundary first clip after about 8 words, never inside a number or time (R5); re-front a pending target | An audible seam on a long clause-less first sentence (unlistened) | Solved in a8d914d (word-boundary first clip, re-front pending target). Verified: uncached 2.6-3.6 s, second busy jump 6.9 s to 2.7 s; 10a review clean. |
| R23, R25, R32: jump e2e limits | 3 s local goal and 6 s CI limit both failed (section 3) | 3 s local then 4.5 s; CI 6 s then max(6 s, 2x the run's first audio) | A real regression is caught only relative to the runner's own speed; 4.4 s local drift goes unnoticed (the log shows it); the CI limit has no cap | Solved by R23 (e8aa0e6), R25 (5db31c3) and R32 (52d5e94). Verified: CI 45358770905 and 45372915897 jump passed; thin margin remains (O3). |
| charsPerSec bias (10c) | Rates come from one 66-character preview including silence, so "Finish in" finishes slightly early; per-voice values 9.2-14.6 chars/s | Left as the safe side of "finish within N minutes". Final review M6: `Timeline` still uses a flat 14.5 chars/s for "min left" and Save estimates, about 35% short for one voice and 15% for two others | Estimators disagree | Not solved yet. Plan: re-measure rates on longer text; give `Timeline` per-voice rates (final-review M6). |
| R16 supersedes Global "never more than 4 sentences of audio" | n/a | 8-sentence audio cache, prefetch stays 3 ahead, every evicted URL revoked | About 2x WAV memory | Solved by ruling R16, implemented in 39f0150. Verified by the 10a review. |
| R17 supersedes Global "auto-scroll suppressed for 5 s" | n/a | Follow instantly; "Back to reading" pill | None | Solved by R17 and 10e (04278a8, fixes d93c994, ea669b3). Verified: e2e player and reader 15 passed + 1 skipped, review clean. |
| R21 supersedes Global "speeds are exactly 0.8, 1, 1.25, 1.5, 2" for effective speed only | n/a | Finish in uses 0.05 steps between 1x and 2x; her choices stay the five | The 0.8x regression (CR1) came from this seam | Solved by R21 (5e43762). The seam produced CR1; fixed in 1a4e2f6 with a test. |
| R26 exports use her chosen speed, never the Finish-in effective speed | n/a | Task 13 validates speed against `SPEEDS` | An export made while Finish in is on plays at her base speed | Solved by ruling R26; no code change beyond Task 13 validation (tests in Task 13). |
| Installer size | CI baselines estimated for dmg (M1 246.3 plus the local delta) | Confirmed by CI artifacts (about 456 MiB zipped); baselines kept | None | Solved: CI artifacts about 456 MiB zipped; baselines kept. Verified by CI 45003423979. |
| R35 (I3) priority between chunks | The export slows slightly while she jumps around | Accepted | Cost confirmed: starvation on an RTF above 1 runner (section 8, O1, resolved) | Solved in 83911ec (R35). Fairness follow-up solved by R38b (c3b9f5d): at most one higher-priority job per chunk boundary; verified by CI 45434908281. Accepted trade-off: with k live jobs queued during an export, the k-th waits k-1 export chunks. |

---

## 8. Still open and watch list

| # | Item | Detail | How we solve it (plan) |
|---|---|---|---|
| O1 | **Export-while-playing fails on a slow macOS runner (resolved 2026-11-24)** | CI 45372915897 (31b82aa). Cause confirmed: R35 `runHigher` in `src/tts/scheduler.ts` drained every pending live job before each export chunk (RED test order e1,l1,l1,l1...). Re-review (Haiku): both R38 findings addressed, no new Critical or Important breakage | Solved by R38b (c3b9f5d): `runHigher` runs at most ONE higher-priority job per chunk boundary, so an export always advances (GREEN test e1,l1,e2,l1,e3). Verified by CI 45434908281: macOS (slow runner) export with playback 70.3 s of audio in 134.6 s (0.52 s/s), Saved toast arrived; Windows 0.81 s/s. Accepted trade-off: with k live jobs queued during an export, the k-th waits k-1 export chunks. Parked minor: no test covers live jobs that are pending after the last export chunk |
| O2 | **macOS unit failure on 25a3962 (resolved 2026-11-24)** | Run 45430542312, `tests/unit/export/ipc.test.ts:148`, called once instead of twice. Cause: 1 s default `vi.waitFor` with real ffmpeg between calls. Windows was green | Solved by R38a (1fc391c): explicit 10 s `vi.waitFor` waits in `tests/unit/export/ipc.test.ts`. Verified by CI 45434908281: macOS `npm test` passed (32 e2e then ran). Parked minor: the `until()` helper in `ipc.test.ts` still caps at about 10 s |
| O3 | R32 margin (11 328 vs 10 232 ms; 11 886 vs 10 186 ms) and no floor or cap on first audio | Section 3 row 14 | Not solved yet. If CI flakes, scale by the measured jump/first-audio ratio, cap the limit, or make the jump test report instead of assert on CI |
| O4 | No startup sweep of stale `Music/Tide/*.part` and `tide-m4b-*` temp dirs after a hard crash | Quit and restart are clean (R34); a hard kill is not. The review's belt-and-braces suggestion; parked | Not solved yet. Follow-up |
| O5 | Preempted-export host timeout | Now R36 (ccbd221): the timer re-arms on each `started`. Cost: a hung export is detected slightly later. Marked closed in the ledger; the e2e behind it is O1, now resolved | Closed; O1 revealed nothing more |
| O6 | Unfixed minors from the final review | M3 `failed` state: player sits forever in "Getting the voice ready" (`engine.ts:398-401,416-429`); M5 follow can scroll the page under a drag selection (`ReaderView.tsx:456`); M6 two duration estimators; M7 seek-back inside a fading last sentence leaves volume low (`sleep.ts:84-88`); M8 `safeFileName` does not guard Windows reserved names (`CON`, `NUL`, `COM1`; a reading titled "Aux" fails on Windows) and slices a surrogate pair; M9 `ci.yml:193` `cat` under `bash -e` and no cap on the R32 limit; M10 vacuous clips test; M11 scroll-key pause dropped its `defaultPrevented` check; M12 `library.flush()` on every playing-to-buffering transition. No fix recorded in the sources for any of them | Not solved yet. Triage into the next milestone; M3, M8 and M5 are the user-visible ones |
| O7 | Deferred minors by task | T1-T15, listed in `2026-11-24-m4-m5-rulings.md`, notably: T3 `skipTarget` -1; T4 swallowed `sink.play()` rejections leave phase "playing" with no audio (m13); T5 `tipsSeen` cap, `app:*` handlers do not check the sender (m21, judged the same as pre-existing handlers); T6 toast overlap, `spaceHandled` can stick; T11 swallowed non-abort text-layer failures; T12 bubble mid-drag, stale range after zoom; T13 no tests for abort mid-pass-2, ffmpeg crash mid-stream, a missing folder for `.m4b`; T14 blank-only selection disables Save silently; T15 temp dirs not removed | Not solved yet. Pick by user impact |
| O8 | Skipped /simplify redesigns | Play-next autoplay, tts-host timer redesign, `promote(gen)` protocol, splitting player and export contexts (the player context rebuilds about once a second during a sleep timer), Timeline prefix sums, pipelined export synthesis, position-only broadcast (`simplify-fixes.md`) | Not solved yet. Revisit if Settings (M6) adds consumers |
| O9 | M0-M3 text-quality list | Tables with multi-word cells, run-in bold headings, citation shapes, figure source notes, initials and abbreviations, rotated pages, superscript exponents, roman-numeral zone titles, compound-prefix splits; text cache deferred (warm 0.23-0.35 s, cold 1.07 s) | Not solved yet. M6/M7 or when readings expose them |
| O10 | Owner checks only Yasin can do | (a) Listen to an exported MP3 on a phone (selection and page range): voice, pauses, title and artist; (b) real mouse drag across a paragraph and a page break, bubble appears, highlighted text equals what is read and saved; (c) the `.m4b` on an iPhone in Apple Books (one chapter per page, place remembered); (d) Save as audio while listening; (e) Finish in with the mouse; (f) 0.8x speed after 1a4e2f6; (g) jumping or changing voice during an export (R35); (h) "Choose another folder" saves straight into the chosen folder (R29) | Not solved yet. Yasin |
| O11 | Open owner questions | Should vendor stamps be dropped even under "Read everything" (R20, currently kept)? Is a roughly 4-word first clip after a jump worth a seam (R18)? | Not solved yet. Yasin |
| O12 | GPL source offer for the bundled ffmpeg | `NOTICE.md` names the licences; the obligation must be handled before any public release; unclaimed route | Not solved yet. M7 |
| O13 | Apple Books on a real iPhone, and the real Open Anyway flow on a Mac | Untested; AVFoundation chapter check on CI is only a proxy | Not solved yet. M7 hand-off |
| O14 | Housekeeping | No fresh installer built after the M5 fixes; `D:\pdf-narrator\release\win-unpacked` half-deleted; delete `D:\pdf-narrator-release-10d` and `D:\tide-installer-10d`; the ledger is the only copy of R33-R37 outside git (the handoff says to delete the SDD workspace only after Yasin has seen R1-R37); nothing from M4/M5 is merged to `main` (origin/main = 0154dc0) | Not solved yet. Yasin, controller |
| O15 | **macOS timing-test design (R32 relative limit, export budget) left unchanged in M6** | macOS packaged jobs failed 4 times in M6, all timing tests (section 10.5). The final reviewer traced the same failures on `main` before M6 and called them runner noise; recommended an absolute limit. The controller ruled that changing R32 was outside M6's plan | Not solved yet. Decision for Yasin: absolute limit, capped relative limit, or report-instead-of-assert on CI (same options as O3). Cost of waiting: occasional red macOS CI |
| O16 | **The release tag path is untested until a real `v*` tag** | Every dry run (`workflow_dispatch`, never publishes) is green: 46033063021, 46033838862, 46046066717, 46048011130, 46049949335, 46052301977. A dispatch run does not exercise `create-draft`, the attach job, the tag-equals-version check or the single-draft check, or the Electron cache hits | Not solved yet. The first real tag is the first live test. Plan: Yasin tags a release candidate and reads the draft before publishing; README says never to publish a draft that lacks the FFmpeg source |
| O17 | **Custom minimal LGPL FFmpeg: not built** | The size research estimates 3-6 MB per platform against 79 MB for the bundled Windows `ffmpeg.exe` (a GPL build), saving about 73 MB unpacked and 25-30 MB of installer per OS, for 1-2 days of CI work. These are estimates; nothing was built | Not solved yet. Decision for Yasin. Recommended in the size report as the next and largest remaining win |
| O18 | **v1 acceptance checklist: 5 manual rows pending** | `docs/acceptance-v1.md`: 6 automated, 5 manual rows pending (rows 1, 3, 6, 8, 9), 0 gaps. Row 3's at least 95% header/footer-free check is not measured by the local-readings spec (it ran 5 of 5 for render, step and resume only) | Not solved yet. Yasin at hand-off (with O10, O13) |
| O19 | **GPL source offer (O12) is now built, not yet exercised** | The release workflow fetches the pinned FFmpeg 6.1.1 source, verifies its sha256, and the draft holds it; `NOTICE.md` says the exact source is attached to every release. Help > View licences opens NOTICE.txt on every platform | Built, untested live (O16). The tarball's hash was cross-checked against the signature from ffmpeg.org because no published `.sha256` exists (the key itself is not trust-anchored) |
| O20 | **M6 and M7 deferred minors** | M6: listed in the M6 rulings document (branch `docs/m6-rulings`), e.g. curly vs straight apostrophe in pronunciation rules, rotation rename failure on a locked log file silently stops logging, 200-line tail counts stack lines, Done button before main content in tab order, on-close save failure not retried. M7: `showAbout` not unit-tested, aboutText parameters unused, no test asserts Toast carries `.on-bubble`, menu items show a ring and the highlight fill together on mouse-after-keyboard | Not solved yet. Triage with O6 and O7 |
| O21 | `npm audit` (E14) still unreviewed per the sources | The M7 plan did not list it and no M7 report mentions it; /security-review (a code review, not an audit) found nothing high-confidence | Unconfirmed whether it was looked at. Plan: run `npm audit` before the first public release |
| O22 | Housekeeping | The M6 ledger was deleted after merge (rulings kept on branch `docs/m6-rulings`); the M7 ledger and reports are deleted after this log is written. Untracked `tsconfig.node.tsbuildinfo` sits in the repo root | Controller. Nothing is merged from `feat/m7-ship` to `main` yet |

---

## 9. Lessons

1. **Run the packaged end-to-end test before trusting an IPC refactor, and give every mock a real counterpart test.** The detached `this` in the export IPC (3e87fd6) passed its unit test and its task review, then failed every real export. A mock that is a plain object cannot lose `this`. Use a host whose methods read `this`, or an in-process test through the real class.
2. **Test the seam, not the stub at the seam.** The renderer stubbed `export.start`, so main's limits and the renderer's specs never met (I2). One test that feeds a renderer-built payload through main's real validator would have caught it.
3. **Use relative limits for timing on CI, and always log the measured value.** Fixed jump limits failed three times (section 3 rows 8, 9; local 3 s). R32's limit scales with the run's own first audio; that works only while the actual ratio stays below 2 (it is now 1.7-1.8).
4. **Re-review every fix.** Four fixes introduced a bug of their own (10a clip order, 10e modifier keys, the R37 stuck-pending entry, and the first R37 tests passing without the fix). Each was caught only because the fix was reviewed again.
5. **Read "skipped" as "not tested", and "cancelled" as "no information".** The macOS chapter check was skipped behind a failed jump test (45355571818); the whole unit-to-e2e chain was skipped behind a unit failure (45430542312); 45429796506 was cancelled by the next push. None of them says anything about the product.
6. **Capture a RED run and make the test fail without the fix.** Tests that pass without the guard (T14 stale Try again, the R37 Play-retry, the T12 "no bubble" test, the 10a closer rule) give false confidence. The code-review fix wave's habit of printing the RED output for each fix is the pattern to keep.
7. **Reproduce the user's symptom before changing code.** The 10b task changed filters and measured no difference on any reading; the cause was `Read everything` being switched on for that reading. Diagnose first, then change.
8. **Measure the runner before blaming the code.** The macOS jump failure looked like a 10a regression until an A/B rerun of the pre-follow-up commit slowed the same way (about 1.9x). Keep a run's raw synth RTF next to any timing assertion.
9. **Do not trust a ledger line over the run itself.** The ledger's "7460637 superseded" is wrong: the run was green. A short `gh run view` settles it; section 3 now carries the real numbers.
10. **Write what the reviewer could not run into a handoff.** Real mouse selection, sound, Apple Books, the Windows hide-on-close and macOS only behaviours cannot be tested here; each should be written as an owner check at the time it is deferred (section 8, O10), or it is forgotten.
11. **Keep copyright discipline in briefs, not only in tests.** Two near-misses (M1 T9 fragments in a commit, the 10b brief naming a real identifier) were caught before shared history or code. Briefs should say "invent all values" up front.
12. **A rule the controller writes can be the bug.** Task 9's path scrub needed four rounds. The leak in round 4 came from the controller's own quote rule ("a path runs to the closing quote"), not from the implementer. Specify a privacy rule with its hostile inputs (apostrophes in names, spaces, other drives, `file://host`) before dispatching, and send a tricky fix to a fresh implementer with the failing example, not a paraphrase.
13. **Anything that can leak needs an adversarial test list written first.** Five of the seven re-review defects were path shapes nobody had listed. A scrubber is tested by what it must not leak, so enumerate shapes first and test each.
14. **A constant copied between files needs a guard that reads both.** Window background hexes duplicated `tokens.css` with nothing to compare them (M6 T3); the fix was one shared module and a test that parses `tokens.css`. The same pattern fixed the theme list that was repeated in five places.
15. **The first paint is part of the design.** The theme flash was closed three times (T3 additionalArguments and preload, then a runtime window colour, then setting `dataset.theme` before React renders in 1272cef). Look for a flash at every stage a page can be seen, not only after React mounts.
16. **A test that passes without the fix proves nothing.** M6 repeated an M4/M5 lesson: the R8 "keeps her place" test began and ended on sentence 0, and the Skip-footnotes test asserted `id >= before`, both of which pass on a restart. Start the test somewhere the bug would change.
17. **Build the dry run before the release, and make the invariant structural.** The final review found a draft could hold installers with no FFmpeg source because the source job ran after the builds. The fix was ordering (`needs`), not a check someone must remember. Say plainly what a dry run does not cover (O16).
18. **Run the README in a fresh clone.** Following the README in a fresh clone found that dev e2e needs `npm run build` first and that `package` needs a git origin. An 18-minute failed run is a cheap way to learn a README was wrong.
19. **Tests must not assume the host.** The first dry run failed because a menu test used whatever platform the runner had and an icon render test had a 5 s limit on a slower runner. Pin the platform in the test; give heavy work an honest timeout.
20. **A visible-focus rule is a contrast problem on every surface, not one CSS line.** Tailwind 4's `outline-none focus-visible:outline-2` left the outline style at none, so no control showed a focus ring. The global rule then failed on toasts (2.1-2.5:1), Pixel Quest's page button (1.37:1) and its floating button (about 1.4:1 on the stage). Each surface needed its own tested ring.
21. **Measure where the bytes are before cutting.** The size pass removed 24.7 MB (5.2%) from the Windows installer; the big items (Electron 239 MB, the model 311 MB, FFmpeg 79 MB) were left alone or became separate decisions. Units matter: the reports mix MB (installer) and MiB (unpacked).
22. **Know your tools' limits and write them down.** Playwright's keyboard cannot fire native menu accelerators; the /security-review skill diffs the cwd's repo; GitHub was unreachable for a while. Each forced a changed method; none produced a product defect. Record the workaround where the next session will read it.

---

## 10. M6 (Settings and themes), 2026-11-24 to 2026-11-25

Branch `feat/m6-settings-themes`, commits `f37c533..1272cef` (31 commits), merged to `main` at 1272cef. Scope confirmed with Yasin on 2026-11-24: all five themes, "Copy diagnostic info" and the rotating log, and the player-context split. Twelve tasks, each with an implementer, a task review and fix rounds; then a final Opus review, /simplify and /code-review. The M6 ledger was deleted after merge, so the sources are the rulings document, the controller's notes and git. Commit hashes for fix rounds below are matched from commit messages.

How we solved it (summary): every finding below got a fix commit and a re-review. Not solved yet: the macOS timing tests (10.5) and the deferred minors (O20).

### 10.1 Per-task review findings (fixed)

Tasks 1, 2, 6 and 8 were clean (minors only). Rulings made along the way: R-M6-1 (T7 may add `previewClip` to the player actions, because a second audio element was forbidden), R-M6-2 (`StoredSettings` carries the export folder path inside the main process; the snapshot type stays path-free), R-M6-3 (T12 may touch `speak.ts`, `index.ts` and preload behind `--tide-e2e` for `lastSynthText`), and in T2 a deleted custom export folder fails with `folder-missing`, never a silent recreate.

| Task | Finding | Why tests missed it | How we solved it (fix, commit, verification) |
|---|---|---|---|
| T3 theme engine | Window background hexes duplicated `tokens.css` with no guard | No test compared them | 4442335: shared `src/main/window-bg.ts` plus a test that reads `tokens.css` |
| T3 | First-paint flash for dark users | Not stated | 4442335: main passes `--tide-theme` via `additionalArguments`, preload exposes `initialTheme`, a layout effect applies it. A one-frame flash remained (see 10.4) |
| T4 Settings dialog | The Dark pages switch was 24 px tall (target 36 px) and its knob used `bg-white` and a hard-coded shadow | Not stated | 8c446c0: 36 px hit area, token colours, plus a radiogroup arrow-key test |
| T5 Reading tab | The R8 "keeps her place" test started and ended on sentence 0, so it would pass on a restart | The test itself was weak | 95eebad: advance to sentence 3 first |
| T5 | Folder and settings calls had unhandled rejections | Not stated | 95eebad: attempt plus toast |
| T7 Pronunciation tab | An in-flight Listen played after she left Settings | Not stated | 8489f68: a request-counter ref |
| T7 | Rapid Listens played a stale clip | Not stated | 8489f68: the same counter drops stale clips |
| T7 | Listen used the idle player snapshot's default voice, not her saved voice | Not stated | 8489f68: use the library's saved `settings.voice` |
| T9 diagnostics | Startup failure hidden: the new `uncaughtException` handlers silenced it, leaving a windowless zombie process holding the single-instance lock. A regression against Electron's default error dialog | Review flagged it; no test | 9b2472a: a "Tide could not start" dialog and exit before any window |
| T9 | The path scrub replaced only the home folder, so other-drive paths leaked into pasted diagnostics | Review flagged it | 9b2472a: scrub all absolute paths (then see 10.2) |
| T9 | The renderer log had no rate limit | Review flagged it | 9b2472a: collapse repeats, 20 per minute (then see 10.2) |
| T10 Pixel Quest | Hard-coded colours in the dialogue box, waves and badge text | Not stated | 55960ef: tokens |
| T10 | Unbounded dialogue height jittered the player bar | Not stated | 55960ef: fixed dialogue height |
| T10 | The page was pure white against a cream theme (the pdf.js canvas is opaque) | Not stated | 55960ef: `mix-blend-mode: multiply` so the cream shows |
| T10 | The wave strip overlapped page text. The controller saw it in a screenshot; no reviewer or test did | Visual only | d0150c9: waves moved into the player bar |
| T11 Kitty | Yarn progress duplicated the wave progress renderer (the review's Important) | Not stated | c01f8a6: shared `ProgressTrack` |
| T11 | Cat-ear tips keyed on a Tailwind `rounded-[11px]` substring selector: fragile and untested | Not stated | 5894fad: explicit `btn-primary` class, tested |
| T12 Settings e2e | `lastSynthText` kept only the latest text, so a prefetch race made the test flaky | A race, not a logic error | 0c9a0cc: a bounded list of recent synth texts |
| T12 | The Skip-footnotes test could pass before the rebuild, slept 2 s, and asserted `id >= before` (true after a reset) | The test was weak | 0c9a0cc and 9885f49: assert the same sentence text through an e2e-only attribute |

Rulings in T11: cat-ear tips go on all primary buttons (spec section 6.8; a re-reviewer called the ears on "Read everything" a defect, the controller ruled it was the spec); Kitty's warning colour is #A34620 because the spec's #B4532A fails 4.5:1 on the shelf (the test says so in a comment). Mascot art may keep fixed art colours in one named constant.

### 10.2 The Task 9 path-scrub saga, four rounds

Task 9 added the rotating error log and "Copy diagnostic info". The point of the scrub: a pasted diagnostic must not carry file or folder names from her readings. It took four fix rounds after the first review, and the last leak came from a rule the controller wrote. Round numbering follows the controller's notes; the commit mapping is from commit messages.

| Round | What the re-review found | Cause | Fix |
|---|---|---|---|
| 1 (9b2472a) | The three flagged gaps: startup zombie, non-home path leak, no log rate limit | First implementation | Fatal-start dialog, scrub absolute paths, rate limit (see 10.1) |
| 2 (2e3b5c3) | Paths cut at the first space or parenthesis leaked file names; names relative to home were kept; the cap could be bypassed by repeat summaries | The round-1 scrub ended a path at the first space; the cap did not count its own summary lines | Controller rule: a path runs to the closing quote, a stack-frame parenthesis or end of line; home becomes `<path>` (this supersedes the brief's `home` to `~`, because `~` leaks the shape). Summaries count toward the cap |
| 3 (e6192a8) | A fixed one-minute window let 40 lines through at a window boundary; an apostrophe in a name (`John's`) split the path; `file://host` was not scrubbed | The fixed-window cap; the quote rule treated every apostrophe as a closing quote | A sliding-window budget, a quote-aware scrub, `file://host` handled |
| 4 (1f8a26b, fresh Sonnet implementer) | A single-quoted ENOENT path whose name contains an apostrophe still leaked | **The controller's own quote rule**: it ended the path at the first quote | Close the run only on a quote not followed by a word character |

Ruling (cost if wrong: one more round): round 4 went to a fresh Sonnet implementer, not Opus, because the problem was not a lack of skill; the controller's spec contained the bug, and the fix was one precisely specified regex change. Known remaining behaviour: a closing quote followed by a word character over-scrubs to end of line (the safe side). Deferred minors: a rotation rename failure on a locked file silently stops logging; the 200-line tail counts stack lines; no tests for the `app:log` validation wiring.

### 10.3 Final review, /simplify, /code-review

| Pass | Result | How we solved it |
|---|---|---|
| Final review (Opus, `f37c533..9885f49`) | Ready after fixes. Important: (1) the Save panel hard-coded "Saves to Music > Tide" and ignored a custom folder; (2) pronunciation edits were lost when Settings closed by Esc or the backdrop, because they saved on blur only and there was no visible Close. Minors in the same wave: LookTab used `void setSettings`, `color-scheme` missing for the dark themes, runtime window background, per-row Listen and Remove accessible names, Nunito 400 not imported, NOTICE missing fonts, a duplicated log `describe()` message | edd31c4 (9 items). Pronunciation now saves on unmount and there is a Done button. vitest 852/852; e2e settings, save-audio, smoke 13/13 offline. Re-review: approved, 9 of 9 |
| /simplify (4 Sonnet reviewers) | The theme list repeated in 5 places, per-component theme branches, `useTheme` re-rendering on every snapshot, `JSON.stringify` of pronunciations every render, synchronous log I/O per error, and others: applied as groups A-K | 2503cf8 and e5b250f: shared theme module, `ThemeMark`, `escapeRe`, shared settings controls, a `ThemeContext` with a stable `matchMedia`, `samePronunciations`, async log I/O. 10 redesigns skipped (skin capability map, semantic-token CSS refactor, `useLibraryActions`, `onSettingsChange`, pronunciation in TtsHost, a settings schema table, a zoom context, lazy fonts, collapsing copy and badges, `Library.setSettings` guards) |
| /code-review (at e5b250f) | Important: a first-paint flash (`index.html` hard-coded sky-sea until `ThemeRoot`'s layout effect); a drive-root export folder labelled "Tide". Nits: a no-op pronunciation save on unchanged blur, a preview blob leaked on a rejected `play`, radio focus lost on a failed save, the log gate never reset | 1272cef, all 6 sent to one Sonnet fix agent. Controller check: vitest 859 with 1 failure on the first run that did not reproduce in 3 reruns (all 859/859; the known jsdom flake class); typecheck clean |

### 10.4 First-paint theme flash

Told once because it came back twice. T3 fixed the first flash for dark users with `additionalArguments` and a layout effect (4442335). The final review added a runtime window background (edd31c4). /code-review found that `index.html` still painted sky-sea until the layout effect ran; 1272cef sets `dataset.theme` synchronously in `main.tsx` before React renders. Each fix was correct for the stage it looked at; the flash lived in a stage the previous fix did not cover.

### 10.5 CI failures

All macOS. Windows was green in every run. A cancelled run is "no information" (the workflow cancels an older run when a new push arrives): 45551863400, 45552283564, 45554901905 and 45556538474 were cancelled that way.

| Run id | Commit | What failed | Cause | Resolution |
|---|---|---|---|---|
| 45462204975 | d0150c9 | Packaged smoke: the jump test (10 621 ms against a limit of 9 798 ms; first audio in the test 4 899 ms) and "exporting while playing keeps playback going" (3.2 min, the Saved toast not visible after 30 s) | Runner speed (the same family as section 3). The export-while-playing failure is the same test R38b fixed in M5; why it failed again here is not stated | None specific; the next runs passed it. Not solved yet at the cause |
| 45552715631 | 9885f49 | Jump test: 11 552 ms against a limit of 11 340 ms (twice the test's own first audio) | The relative limit has no margin on a slow runner (O3) | Judged runner noise by the final reviewer. Export-while-playing passed this time |
| 45558129784 | 1272cef | Attempt 1: a "Finish in" note step (keyboard submenu navigation) failed; the controller's note says it passes locally | Not stated | Rerun of the failed job: green on both OSes |

Ruling: the macOS timing-test design (R32 relative limit, export budget) is left unchanged in M6 and surfaced to Yasin. The reviewer recommended an absolute limit; changing R32 is outside M6's plan. Cost if wrong: occasional red macOS CI. Not solved yet (O15).

### 10.6 Tooling

| Problem | Cause | How we solved it |
|---|---|---|
| Playwright cannot press the native menu accelerator for Settings (Ctrl+,) | Native accelerators are handled by the OS menu, not the page, so `page.keyboard` never reaches them | T12 tests the command by clicking the real menu item from the main process, and a renderer test covers the Ctrl+, route to the same command. The accelerator itself is not tested end to end |

---

## 11. M7 (Ship), 2026-11-27 to 2026-11-28

Branch `feat/m7-ship`, cut from `main` at 1272cef; 24 commits `1272cef..39974bf` before this log. Scope (Yasin, 2026-11-27): core ship items, FFmpeg source attached to releases, first-launch polish only, icon from the wordmark. Out of scope: her guides, Windows Open With, parked fixes, tagging and publishing, hand-off. Six tasks, then a final Opus review, /simplify, /code-review, /security-review (run as a subagent) and an installer size pass. Rulings: R-M7-1 (Task 4's "fresh clone" is made from the local repo, because GitHub was unreachable and the check was about the README's commands); keep the Electron version line in the About box; keep the dimmed idle player bar on the empty shelf although the mockup omits it; fix the focus ring inside M7 although the plan said Task 6 would not touch product code (spec section 8 is the binding acceptance bar); keep "ffmpeg.org down blocks the release" (no verified source means no release); revert the menu-item ring exclusion (see 11.5).

How we solved it (summary): every finding got a commit; dry runs were green after each workflow change. Not solved yet: the tag path (O16), custom FFmpeg (O17), manual acceptance rows (O18).

### 11.1 Per-task review findings (fixed)

Task 2 (About box) was clean; its deferred minors are in O20.

| Task | Finding | How we solved it (fix, commit, verification) |
|---|---|---|
| T1 icon | Contrast too low: the pale tile vanished on white and the sun was close to the sky. The controller found it by looking at the render at 16, 32 and 512 px | 5ced52a: deep sky gradient, warm sun, white front wave. Controller approved at all sizes and on dark |
| T1 | `resources/icon.png` was stale in HEAD (the regenerated file was missed in 5ced52a) | d2179da: committed, and `icons.test.ts` now checks the icns magic bytes and that the png is byte-identical to a fresh render. The file turned out to be unused at runtime and was deleted in /simplify (56e8e65) |
| T3 CI | Draft-by-tag upload was unproven: `gh release upload` by tag name is unreliable for drafts | 4287f0c: look up the draft explicitly with retries (6 attempts, 10 s apart), fail with `::error::` if absent. Still untested live (O16) |
| T3 | The `dry_run` input was inert but described as if it did something | 4287f0c: honest description (removed outright in /simplify) |
| T3 | Workflow-level `contents: write` | 4287f0c: workflow-level read; write only on the jobs that need it |
| T3 | A no-op `sed` in the workflow | 4287f0c: removed |
| T4 README | The `fetch-model` row gave the wrong dtype (fp32 is the default; `--dtype all` adds q8) | fdc0c29 |
| T4 | The scripts table was missing 3 scripts (the reviewer's Important) | fdc0c29: 18 of 18 listed |
| T4 | "Match my Mac" is "Match my PC" on Windows | fdc0c29 |
| T4 | A claim that dry runs merge to `main` | fdc0c29: removed |
| T4 | The dry-run command carried `-f dry_run=true` although a manual run never publishes | fdc0c29: `gh workflow run release.yml --ref <branch>` |
| T4 | The model-size claim and verification wording were not exact | fdc0c29: "verified" (size always; sha256 when listed) |
| T4 (found by following the README in a fresh clone) | Dev e2e fails (2 passed, the rest failed, 18 min) unless `npm run build` runs first | README fixed; after a build, `smoke` passed 3/3 |
| T4 (same) | The clone URL used the wrong repo name | README uses the real remote |
| T4 (same) | `npm run package` fails at the publish-info step ("Cannot detect repository by .git/config") in a clone whose origin is a local path | Not a product problem; the README notes `package` needs a git origin |
| T5 first launch | The Finder tip was 13 px against the mockup's 12.5 px (the only gap among everything compared in two themes and two widths) | f2dd5da with a test (RED shown). The macOS-only tip is not visible in Windows screenshots |
| T6 acceptance | **Gap, spec section 8 row 10b:** no visible keyboard focus on the player controls. Cause: Tailwind 4 `outline-none focus-visible:outline-2` leaves `--tw-outline-style` at none | e6c0a93: one global `:focus-visible` rule with a `--focus-ring` token. The e2e had been written with `test.fail()`; removed once fixed |
| T6 | The global ring on bubble surfaces (Toast) was about 2.1-2.5:1 | 64dfa24: the `.on-bubble` ring uses `--bg`; a unit test of contrast against `--bubble` in all 4 themes |
| T6 | The acceptance doc's row 10b wording claimed more than the e2e asserts | 3e38e08 |
| T6 | One "Page crashed" in the save-audio "exporting while playing" test; it passed alone and on a full rerun | Flagged to the final review, which judged it pre-existing |

### 11.2 Tools and process

| Problem | Detail | How we solved it |
|---|---|---|
| GitHub unreachable from this machine at the start of the session (2026-11-27) | Task 1's push was deferred (connection reset); the first push had to be `git push -u origin feat/m7-ship` | Pushed once GitHub was back (origin at d2179da). R-M7-1 made Task 4's clone local so it did not depend on it. How long it was down: not stated |
| The /security-review skill cannot run when the session's cwd is another repo | It diffs `origin/HEAD` of the working directory, which here was a different repository | Run as a subagent over the branch instead |
| First dry run failed on the CI hosts (46032497501) | "on win32 Help ends with About Tide" failed on macOS because the test did not pin `process.platform`; the PNG render test in `icons.test.ts` hit its 5 s limit on Windows. The tests assumed the dev machine | 3153f0f: pin the platform in the test; 30 s timeout. Dry run 46033063021 green on macOS, Windows and the FFmpeg-source job. (Later the platform pin became a `withPlatform` helper, and the icon render test left with its file in /simplify) |
| A one-off failure in a full vitest run (Task 1 and Task 5 reports; also once in M6 at 1272cef) | Not diagnosed; passed on rerun | Known jsdom flake class (F12). Not solved yet |

### 11.3 Release workflow, five passes of finding holes

The FFmpeg source obligation (O12) turned into a release pipeline. Each pass of review found a different hole.

| Pass | Hole | Fix |
|---|---|---|
| Task 3 review | The attach job's lookup by tag was unproven for drafts | Explicit lookup with retries (4287f0c) |
| Final review (Opus) | **Important:** the source job ran after the matrix, so a draft could hold installers with no FFmpeg source, and the README said to publish by hand. Also: tag need not equal the `package.json` version; `persist-credentials` left on | 457cabc: a new first job `ffmpeg-source-fetch` (download, sha256 check, write `FFMPEG-SOURCE.md`, upload as an artifact); the matrix `needs` it; `ffmpeg-source-attach` runs on tags only. `persist-credentials: false`. README publish gate. Dry run 46046066717 green |
| /simplify (c05cbda) | Not holes, but two new guards: tag equals package version, and the locked `ffmpeg-static` version equals the pinned source (5.3.0 for both). Also one build step, one `jq` pass, no hard-coded tarball, an Electron cache | Dry run 46048011130 green |
| /code-review | Pre-existing: a concurrent matrix publish could create two drafts, so the source attached to the wrong one. The `jq` filter concatenated the tag into the string | 0f68ed5: a `create-draft` job (tag only) creates the single draft; the attach step fails if more than one release matches; `jq --arg`. Checked in `electron-publish` (`getOrCreateRelease`) that the matrix reuses the existing draft. `release-workflow.test.ts` parses the YAML and evaluates the job conditions over 6 result combinations. Dry run 46049949335 green |
| /security-review | No high-confidence vulnerability. Areas checked: script injection, token permissions, dispatch, checksum, artifacts, pinned refs (a nit), cache, `shell.openPath` fixed paths, `extraResources`, renderer, dev dependencies | Nothing to fix |

FFmpeg source integrity: ffmpeg.org publishes no `.sha256` (404), so the pinned tarball's hash (8684f4b0...) was cross-checked against the signature from ffmpeg.org (a good signature from the FFmpeg release signing key; the key itself is not trust-anchored). CI re-downloads and verifies the same hash on every run.

### 11.4 Final review, /simplify, /code-review

| Pass | Items | Result |
|---|---|---|
| Final review (Opus, `1272cef..3e38e08`) | 5: the draft without source (above); the acceptance Counts line; Pixel Quest "Back to reading" ring 1.37:1 on the page; `persist-credentials: false`; macOS had no in-app licences (add Help > View licences on all platforms) | 457cabc; re-review approved 5 of 5 (minor: View licences appeared in File and Help, and the test hit File first). Flake judged pre-existing |
| /simplify (A-M) | Workflow, about blurb constants, licences only in Help, `.on-page-float` class, test helpers, delete the unused icon | c05cbda, e7cd336, cb8aa11, 56e8e65, 0d412f5. Skipped: a two-tone universal ring, dropping release typecheck and test, running the fetch in parallel, a shared `renderIcon`, `noticePath` through `resourcePath`, `gh release upload` by tag |
| /code-review (2 Important + 4 nits) | View licences does nothing when no `.md` handler exists (the `openPath` error was ignored); the duplicate-draft race (11.3); the Pixel Quest floating-button ring about 1.4:1 on the stage; menu items show a ring plus the highlight fill on mouse-after-keyboard; release blocked if ffmpeg.org is down; `void showAbout()` could raise an unhandled rejection into `onFatal` | 0f68ed5: licences ship as `.txt` and fall back to `showItemInFolder`; the two-tone float ring (13.33:1 and 17.95:1, tones differ 17.95:1); `.catch(logError)`. ffmpeg.org down: kept on purpose. Menu items: see 11.5 |

### 11.5 Focus ring, continued

A focus ring is a contrast problem on every surface (lesson 20). After e6c0a93 and 64dfa24: Pixel Quest's back-to-reading ring (1.37:1) became `--border` (about 19:1 on the page) in 457cabc; its floating button needed a two-tone ring in 0f68ed5. The fix agent excluded menu items from the global ring; the controller reverted that in 8300fc5 because Radix's highlight fill is only 1.14 to 1.49:1 against the menu background in the four themes, and a keyboard user needs a visible indicator more than a mouse-after-keyboard user needs a tidy one. Cost accepted: a slightly busier menu.

### 11.6 Acceptance checklist

Task 6 wrote `docs/acceptance-v1.md`: 5 rows automated, 5 manual pending, 1 gap (10b) at first; after the focus fix, 6 automated, 5 manual, 0 gaps. Packaged offline suite: 44 passed, 1 skipped (a macOS-only hidden-window test), 0 failed; local-readings 5 of 5 (render, step, resume only; the at least 95% junk check stays manual at hand-off). vitest 884 at the end; typecheck clean; lint 0 errors.

### 11.7 CI and dry runs

| Run id | What | Result |
|---|---|---|
| 46032497501 | First dry run | Failed: 2 CI-host tests (11.2) |
| 46033063021 | After 3153f0f | Green: macOS, Windows, ffmpeg source. Installers 478 958 030 B (Windows) and 478 523 563 B (macOS); source artifact 10 462 522 B |
| 46033838862 | After 4287f0c | Green |
| 46046066717 | After 457cabc | Green (fetch first, then matrix; attach skipped as intended) |
| 46048011130 | After /simplify | Green |
| 46049949335 | After 0f68ed5 | Green (create-draft skipped on dispatch) |
| 46052301977 | After 39974bf (size) | Green |

### 11.8 Installer size

Baseline Windows installer 478.9 MB (unpacked 870 MiB). Installer sizes are decimal MB; unpacked is MiB. Candidates were sized from file sizes in `win-unpacked`, not built one by one (each package build is about 2 minutes). Commit 39974bf.

| # | Candidate | Verdict | Why and how much |
|---|---|---|---|
| 1 | Keep only the en-US Electron locale | Applied | 55 `.pak` files (49 MB) down to 1; about -48 MB unpacked, about -10 MB installer |
| 2 | Prune browser-only transformers.js files and all `*.map` and `*.d.ts` | Applied | Node resolves the `node` export; the web, wasm and jsep builds are unused; about -45 MB unpacked (that dist went from 45 to about 7 MB) |
| 3 | Drop `sharp` | Skipped | `transformers.node.mjs` has a static `import ... from "sharp"` evaluated at load; the 19 MB stays |
| 4 | Drop `DirectML.dll` (18.5 MB) | Applied | Neither `onnxruntime.dll` nor the binding imports it, and the worker pins `device: 'cpu'`; packaged e2e synthesises offline without it |
| 5 | Maximum compression | Applied | NSIS LZMA; the dmg switches to UDBZ. Windows package build 2 m 11 s. The separate gain was not isolated |
| 6 | Custom minimal LGPL FFmpeg (PCM in, `libmp3lame` and native AAC out, `ipod` and `mp3` muxers, no x264 or x265) | Not done | Estimated 3-6 MB per platform against 79 MB; about -73 MB unpacked and 25-30 MB of installer per OS; 1-2 days of CI work. It would also simplify the source offer. Decision for Yasin (O17) |
| 7 | Compress `model.onnx` losslessly | Skipped | gzip -9 gives 301.4 MB from 325.5 MB (-7.4%), and the installer already compresses it, so the installer gain is about 0; a smaller installed copy would need decompression at first run. onnxruntime cannot read compressed external data |
| 8 | Remove Chromium's `dxcompiler.dll` (25 MB) and `vk_swiftshader` (5 MB) | Not attempted | Risk to GPU and WebGPU fallbacks |

| | Before | After | Delta |
|---|---|---|---|
| Windows installer | 478.9 MB | 454.2 MB | -24.7 MB (-5.2%) |
| Windows unpacked | 870 MiB | 757 MiB | -113 MiB |
| macOS installer (CI artifact) | 478.5 MB | 462.3 MB | -16.2 MB |

Verification: packaged e2e 44 passed, 1 skipped, 0 failed offline (reading plays; first audio 3 043 ms and jump 3 553 ms against the 4 500 ms local limit; MP3 and m4b exports; `ffmpegHasMp3: true`); vitest 884; dry run 46052301977. What remains: Electron 239 MB, the fp32 model 311 MB (fixed since M0e, because the quantised model was too slow), FFmpeg 79 MB, `dxcompiler.dll` 25 MB, `sharp` 19 MB.

### 11.9 Not solved yet from M7

Section 8 rows O15 to O22: the tag path (O16), custom FFmpeg (O17), the manual acceptance rows (O18), the deferred minors (O20), `npm audit` (O21).
