# M0 spike results and go/no-go gate

Date: 2026-11-17. Branch `feat/m0-m1-foundation`. Sources: CI run 43896305932 (M0a/M0b), CI run 44031220120 (M0d), local runs on the developer laptop (Ryzen 3 5300U, no GPU).

**Gate verdict: PASS. M0/M1 are done.** M0a RTF on the macOS runner is 0.84-0.85 (target < 1), but first audio < 2 s is not met on the CI runner (re-check on her M5; mitigation in M4); M0d shows 2 chapters in AVFoundation (target >= 2). One voice decision (M0e) is still pending a listening session, and one new open decision (q8 vs fp32) comes out of the spikes.

| Spike | Question | Result |
|---|---|---|
| M0a | Is the packaged voice fast enough? | RTF pass on macOS runner (0.84-0.85); first-audio < 2 s not met on the CI runner (re-check on her M5; mitigation in M4); RTF fail on Windows (1.25-1.40) |
| M0b | Does an ad-hoc signed Mac build verify? | Pass; Open Anyway check stays at hand-off |
| M0c | Does the text pipeline read real course readings cleanly? | Mostly; known issues listed below |
| M0d | Does `.m4b` export give chapters Apple can read? | Pass (2 chapters), lamejs dropped |
| M0e | Which voices? q8 or fp32? | Samples rendered; choice pending |

## M0a: voice speed and load time (packaged app, offline)

Sentence of 3.825 s of audio, af_heart, q8 model. RTF = synthesis time / audio time. Rows marked "earlier run" are earlier runs of the same CI job (run 1 vs run 2).

| Machine | loadMs | cold synth ms | RTF cold | warm synth ms | RTF warm |
|---|---|---|---|---|---|
| macOS runner, Apple M1 (virtual), 3 vCPU | 1438 | 3236 | 0.85 | 3225 | 0.84 |
| macOS runner, earlier run | 1927 | 4336 | 1.13 | n/a | n/a |
| Windows runner, AMD EPYC 7763, 4 vCPU | 1220 | 4784 | 1.25 | 5350 | 1.40 |
| Windows runner, earlier run | 1191 | 5125 | 1.34 | n/a | n/a |
| Dev laptop, Ryzen 3 5300U | n/a | n/a | 1.31-1.59 (M0a runs; M0e samples measured 1.2-1.4 on a different run and CPU load) | n/a | n/a |

Against "first audio < 2 s, RTF < 1":
- **RTF < 1: PASS on macOS** (0.84-0.85 in the latest run). The earlier macOS run was 1.13, so runner noise is large and the pass is not by a wide margin.
- **RTF < 1: FAIL on Windows** (1.25-1.40) and on the dev laptop. Warm is no faster than cold, so this is steady-state inference cost, not warm-up. See the fp32 finding under M0e.
- **First audio < 2 s: not met as measured.** Model load is 1.2-1.4 s, and the first 3.8 s sentence then takes 3.2 s (macOS) to 4.8 s (Windows) to synthesize. The 3-core virtual M1 is slower than the MacBook Air M5 she will use; CI cannot prove the real figure. Mitigation for M4: make the first chunk short and warm the model at app start.
- Packaged and offline: synthesis works with the network blocked and with onnxruntime-node unpacked from the asar.

## M0b: signing and Gatekeeper (macOS arm64 runner)

```
$ codesign --verify --deep --strict Tide.app
release/mac-arm64/Tide.app: valid on disk
release/mac-arm64/Tide.app: satisfies its Designated Requirement
$ codesign -dv Tide.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 flags=0x2(adhoc)
Signature=adhoc
TeamIdentifier=not set
$ xattr -p com.apple.quarantine Tide.app   (quarantine flag set)
$ spctl --assess --type execute -vv Tide.app
release/mac-arm64/Tide.app: rejected
```

- Verify passes and the signature is ad-hoc, as intended. electron-builder's ad-hoc signing also covered the bundled ffmpeg binary (checked again in M0d).
- `spctl` "rejected" on a quarantined copy is the expected state that offers **Open Anyway**. On macOS 15+ right-click > Open no longer works, so onboarding must point to System Settings > Privacy & Security > Open Anyway.
- The real Open Anyway check on a Mac stays at hand-off (no real Mac before then). The fallback (Terminal step vs Developer ID) remains deferred.

## M0c: text pipeline on real readings

Five readings, 169 pages, about 3,350 sentences in total (3,354 before the caption fix, 3,356 after). No crashes, no pages without text. Labels are neutral; page numbers are PDF pages. In all five, the DOI line on page 1 is spoken. No reading text is reproduced here (the readings are copyrighted and kept local).

What works in all five: the publisher watermark is removed on every page, sentences cut by page breaks are rejoined across pages, the References section is cut at the right place (an outline line reading "References" at 50% of the document is correctly not treated as the cut), figure-only pages produce nothing, and no running headers, page numbers or footnotes leaked.

Fixed during M0c: split initials (52 splits to 0), question-mark plus lowercase continuations, two-line headings, and a high-severity bug where body lines starting with a decimal figure reference were dropped as captions (Reading B, p11; 7 lines restored, 713 to 715 sentences). Regression tests use made-up text.

| Reading | Pages | Sentences | Open issues (pages) |
|---|---|---|---|
| Reading A | 30 | 552 | Table with multi-word cells leaks (p7). Figure source notes leak after captions are dropped (p21-22). A country abbreviation splits a sentence. Outline numerals detach or attach to the wrong line (p14-15). Spacing artifacts in a few words (p3, p4, p15). Page locator left after a block quote (p20). Hard break where a block quote starts mid-sentence (p20). |
| Reading B | 37 | 715 | Block-quote hard breaks split sentences (several). End-of-chapter further-reading, audiovisual and website lists spoken, with URLs split at "?" (p34-35). A non-author-year citation left. |
| Reading C | 33 | 593 | Tables with multi-word cells leak (p1-2, p11). Multi-letter initials split. Run-in box headings merge into the next sentence. End-of-chapter lists spoken (p29-30). |
| Reading D | 43 | 884 | Table partly leaks (p9). Run-in bold headings at body size merge into the first sentence (p8, p11); needs font weight. Some citation shapes missed (multiple years, possessive "et al.", bracketed group authors). 5 "sentences" over 600 characters from list text without punctuation (TTS chunking handles length). End-of-chapter lists spoken (p40-41). |
| Reading E | 26 | 612 | Page-only locators left after narrative quotes (p9). List letters missing even with all filters off (extraction, p9). End-of-chapter lists spoken with bibliographic fragments (p23-24). |

Other known rules problems: the initials rule over-merges real sentence ends (a roman numeral or single letter before a capitalised word); the "No." abbreviation merges standalone answers; table-of-contents dot leaders split into fragments; the strict caption rule needs a space after the full stop.

## M0d: audiobook and MP3 export (packaged, CI run 44031220120)

- **AVFoundation chapter count: 2** (expected 2) on the packaged app's `.m4b`, using `loadChapterMetadataGroups` with English preferred. First attempt gave 0: ffmpeg writes the chapter text track with language code 0, which Apple treats as undetermined. Fix: keep `-f ipod` and patch the chapter track language to `eng` after encoding (covered by a unit test that decodes `mdhd` itself, since ffmpeg cannot see the problem).
- **`ffmpegHasMp3`: true on macOS and Windows** (libmp3lame in the bundled binary).
- **Decision: lamejs is dropped.** ffmpeg does both `.m4b` and `.mp3`.
- ffmpeg-static 5.3.0 (ffmpeg 6.1.1), pinned exactly. Binary size 43.2 MiB (mac) and 79.0 MiB (win). Test export of 4.35 s with 2 chapters took 192 ms (mac) and 148 ms (win).
- Installers: dmg 323.3 MiB (+19.1 MB from ffmpeg), exe 312.4 MiB (+22.5 MB).
- Limit of the proxy: AVFoundation is Apple's framework, but Apple Books on a real iPhone is **still untested**. Check at hand-off.
- The bundled ffmpeg binaries are GPL builds, so shipping them carries a source-offer obligation (see follow-ups).

## M0e: voices and model precision

- 24 samples rendered from one opening page of a reading, q8 and fp32 (local-only, in `local-fixtures/voice-samples/`; open `index.html` to listen).
- **Decided 2026-11-19 (Yasin):** 10 voices (af_kore, af_nicole, af_sarah, am_fenrir, am_michael, am_puck, bf_emma, bf_isabella, bm_fable, bm_george); default **bf_emma**; model precision **fp32** on both OSes.
- Speed: on the dev x86 CPU, q8 RTF is about 1.2-1.4 (a different run from the M0a laptop figure of 1.31-1.59; CPU load varies) and **fp32 about 0.5**, so fp32 is about 2.5x faster (q8 pays for dequantization). The model file is about 325 MB vs about 92 MB, so **fp32 adds about 233 MB** to the installer. fp32 would fix the Windows RTF > 1. **fp32 chosen** (2026-11-19).

## Final review fixes (packaging, pdf.js, text)

- **Installer contents trimmed.** onnxruntime-node binaries for other OSes and arches, onnxruntime-web, pdf.js (now a dev dependency) with its optional `@napi-rs/canvas`, and the fp32 `model.onnx` no longer ship. sharp and its `@img/sharp-*` native binary stay: transformers.js imports sharp at load time and sharp throws without its binary (kokoro-js then fails to load).
- Installer sizes (CI): dmg 323.3 MiB to **246.3 MiB**, exe 312.4 MiB to **241.2 MiB** (run 44031220120 before, run 44036153231 after). In the Windows app, `app.asar` fell from 132 to 9 MiB and the unpacked modules from 420 to 209 MiB.
- **pdf.js 6.5.438** (exact pin; 5.7.x was affected by GHSA-hq66-cqwq-w95j, fixed in 6.2.108). Spoken text of the fixtures and of the five readings is unchanged by the upgrade.
- Text fixes: compound hyphens at line breaks are kept ("self-concept"; 38 lines changed across the five readings, sentence counts unchanged), and a short handout is no longer filtered to nothing by the cover-page rule. `BuildResult.skippedPages` lists cover and References pages for a future "Read everything" offer. `PIPELINE_VERSION` is 2.
- **Accepted risk:** the test-only IPC hooks are reachable in a packaged build, but only when it is launched with `TIDE_E2E=1`; this is required so CI smoke-tests the real installer artifact.

## Decisions recorded (also in spec section 12)

- Gate passed; M0/M1 done.
- lamejs dropped; ffmpeg-static does both export formats.
- Voice choice pending; default Heart.
- New open decision: model precision q8 vs fp32.
- GPL ffmpeg in the installers: handle the source-offer obligation before any public release.
- Apple Books on a real iPhone untested.

## Follow-ups for M2+

**Text pipeline**
- Table detection for multi-word cells (word-salad leaks in A, C, D).
- Stop-at rule for end-of-chapter further-reading, audiovisual and website lists (B, C, D, E).
- Block quotes: no gap hard break when the previous line has no end punctuation and the next starts lowercase.
- Figure source notes, DOI lines, URL splitting and spoken form.
- Run-in bold headings (needs `fontName`/weight from pdf.js).
- Citation patterns: multiple years, possessive "et al.", bracketed group authors, "personal communication", page-only locators.
- Abbreviations (country names, multi-letter initials); narrow the initials rule; "No." merge; TOC dot leaders; outline numerals; item-spacing artifacts.
- From earlier reviews: roman-numeral page-number rule drops single-word zone titles, U+2010 de-hyphenation, footnote overlap and two-column footnotes, rotated pages, batch `remove()` patterns. Bump `PIPELINE_VERSION` whenever output changes.
- ~~Two-column pages with a full-width line mid-page collapse to one column: split the page into bands (M3).~~ Done in M3 (reader e2e passes on the two-column and layout fixtures).

**TTS and performance**
- TTS protocol: cancel/generation ids, timeout from job start, recycle the worker on a hang (first task of M4).
- ~~Decide q8 vs fp32~~ fp32 on both OSes (2026-11-19).
- Short first chunk and model warm-up at start for first-audio latency; re-measure on the M5 Air at hand-off.
- Deferred minors: tts-host error/exit handling, phonemizer re-count per chunk, missing edge-case tests (very long token, whitespace-only input), `npm audit` unreviewed, fetch error-path tests (the per-file fetch timeout is in), NODE_EXTRA_CA_CERTS note for intercepting proxies.

**Export**
- Verify `.m4b` chapters in Apple Books on a real iPhone.
- Keep the `eng` chapter-language patch covered by tests when changing the muxer.

**Packaging and CI**
- GPL ffmpeg: `NOTICE.md` now names the licences and links the FFmpeg sources; confirm the source-offer route before public release.
- Onboarding page for Open Anyway on macOS 15+.
- `will-redirect` guard and navigation-guard tests, package metadata.
- Optional further trim: transformers.js ships its web builds, `.wasm` and source maps unpacked (about 46 MiB in all).

**M3 status (2026-11-18)**
- Done in M3: shelf, library, reader view with highlight, stepping and resume; reader end-to-end tests; CI installer budget (baselines dmg 246.3 MiB, exe 241.2 MiB, warn above +15 MiB).
- Still deferred (text): multi-letter initials, country abbreviations and the "No." merge; run-in bold headings (needs font weight); citation shapes (multiple years, possessive "et al.", group authors, page-only locators); figure source notes, DOI lines, URL speech; outline numerals and item-spacing artifacts; superscript exponents; rotated pages, U+2010 de-hyphenation, compound-prefix syllable splits, roman-numeral zone titles.
- Text cache (`userData/cache/`, spec 6.3) deferred: warm 0.23-0.35 s per reading, cold 1.07 s (Node numbers; the renderer adds worker spawn and structured clone).
- Owner decisions 2026-11-17: Windows Open With moves to M7; resource lists sit under Stop at References; courses alphabetical with Other last; TOC pages skipped like cover pages; Open With tip macOS only.

**M4 status (2026-11-22): voice player, fp32**
- Measured on the Windows dev machine, one worker, with the player e2e run against `npm run build` (dev) and the packaged app (offline guard on).
- **First audio** (the player e2e "Play speaks and the highlight advances", time from the Play click to the player reporting `playing`, first Play of a launch so it includes the model load): **3.6 s dev, 3.6 s packaged** (3580 ms and 3555 ms). The M0 target is under 2 s after load; here the load (about 2-2.6 s) is inside the figure, so the post-load part is about 1-1.5 s. Under heavy load (three parallel Playwright workers) the same test took 6.8 s to 14.5 s, so treat parallel runs as noisy.
- **fp32 RTF** (the smoke test's 4.075 s sentence, bf_emma): dev cold 2525 ms (RTF 0.62), warm 2609 ms (0.64); packaged cold 2987 ms (0.73), warm 3024 ms (0.74). Both under 1; q8 was 1.2-1.4 here.
- **Installer sizes:** Windows `Tide Setup 1.0.0.exe` **456.6 MiB** (478,737,912 bytes; M1 was 241.2, +215.4). The macOS dmg is estimated at 461.7 MiB (M1 246.3 plus the same delta); the CI baselines are set to those values and the dmg figure needs confirming on the first CI run.
- **macOS runner and Windows runner first-audio and RTF numbers:** not measured here (no push from this task). CI now writes `test-results/first-audio.json` in the packaged run and prints it in the job summary ("M4: first-audio latency"); the existing "Packaged voice smoke" summary gives the RTF. Fill these in from the first CI run.
- Packaged e2e: 29 of 29 pass offline, including the seven new player tests (Play, Space pause and restart, arrow skips, minimised playback, Now Playing metadata, speed change, end of reading offers the next). The dev run is 29 of 29 as well.
- Real audio was used locally; `TIDE_FAKE_AUDIO` was not needed and is not implemented. If a CI runner has no sound device and the highlight never advances, add it as the task brief describes.
