/**
 * Generates the text-pipeline PDF fixtures in tests/fixtures/pdfs/.
 *
 *   npx tsx scripts/make-fixtures.ts
 *
 * Every fixture is a deterministic, letter-size PDF drawn with pdf-lib in standard Helvetica
 * (no embedded font files). Each `<name>.pdf` gets a `<name>.json` sidecar describing, per page:
 *   - `lines`:  what `buildLines(page).map(l => l.text)` must return (normalized text, reading order)
 *   - `spoken`: the text that SHOULD be spoken with DEFAULT_FILTERS
 *   - `spokenReadEverything`: the text that should be spoken with READ_EVERYTHING
 *   - `skipped`: what DEFAULT_FILTERS drop from that page, and why
 * Spoken text is the page's spoken lines joined with single spaces, with a line ending in "-" joined
 * to a following line that starts lowercase (de-hyphenation), and normalized (ligatures expanded,
 * soft hyphens removed, no-break/thin spaces as plain spaces, runs of spaces collapsed).
 *
 * The expected strings are computed here independently of src/shared/text so that the tests check
 * the pipeline against an oracle rather than against itself.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFPage,
  StandardFonts,
  beginText,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  showText
} from 'pdf-lib'

const OUT_DIR = join(__dirname, '..', 'tests', 'fixtures', 'pdfs')
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z')
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 72
const BODY_W = PAGE_W - 2 * MARGIN

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

/** Why a line (or part of one) is not spoken with DEFAULT_FILTERS. */
type SkipReason =
  | 'running header'
  | 'page number footer'
  | 'footnote'
  | 'footnote marker'
  | 'figure/table caption'
  | 'table'
  | 'cover page'
  | 'references'
  | 'citation'

interface Seg {
  text: string
  /** Font size; defaults to the line's size. */
  size?: number
  /** Baseline shift upwards in points (superscripts). */
  rise?: number
  /** Leave one space (at the line's size) before this segment. */
  gap?: boolean
  /** Inline footnote marker: drawn and in `lines`, never spoken by default. */
  marker?: boolean
}

interface FLine {
  segs: Seg[]
  x: number
  /** Baseline distance from the page top. */
  top: number
  size: number
  font?: 'helv' | 'lig'
  /** Absolute x of each segment (separate text runs, e.g. table cells); overrides `x` and `gap` spacing. */
  xs?: number[]
  /** Set when DEFAULT_FILTERS should drop the whole line. */
  skip?: SkipReason
}

interface Rect {
  x: number
  top: number
  w: number
  h: number
}

interface FPage {
  /** In expected reading order. Drawing order is irrelevant to pdf.js positions. */
  lines: FLine[]
  rects?: Rect[]
  /** Removals applied to this page's default spoken text (e.g. citations): [find, replace]. */
  spokenEdits?: Array<[string, string, SkipReason]>
}

interface Fixture {
  name: string
  title: string
  description: string
  pages: FPage[]
  notes?: string[]
  extra?: Record<string, unknown>
}

// ---------------------------------------------------------------------------------------------
// Text helpers (independent oracle for normalization and de-hyphenation)
// ---------------------------------------------------------------------------------------------

function plain(s: string): string {
  return s
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\u00AD/g, '')
    .replace(/[\u00A0\u2009]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function joinSpoken(parts: string[]): string {
  let out = ''
  for (const p of parts) {
    if (!p) continue
    if (!out) out = p
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(p)) out = out.slice(0, -1) + p
    else out += ' ' + p
  }
  return out
}

function lineText(l: FLine, spokenOnly: boolean): string {
  let s = ''
  for (const seg of l.segs) {
    if (spokenOnly && seg.marker) continue
    s += (seg.gap && s ? ' ' : '') + seg.text
  }
  return plain(s)
}

// ---------------------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------------------

let helv: PDFFont // set per document in build()

function width(text: string, size: number): number {
  return helv.widthOfTextAtSize(text, size)
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + ' ' + word : word
    if (cur && width(next, size) > maxWidth) {
      out.push(cur)
      cur = word
    } else cur = next
  }
  if (cur) out.push(cur)
  return out
}

function simple(text: string, x: number, top: number, size: number, skip?: SkipReason): FLine {
  return { segs: [{ text }], x, top, size, skip }
}

function centered(text: string, top: number, size: number, skip?: SkipReason): FLine {
  return simple(text, (PAGE_W - width(text, size)) / 2, top, size, skip)
}

/** Lays out a paragraph; returns the lines and the baseline `top` for the line after it. */
function para(
  text: string,
  top: number,
  opts: { x?: number; size?: number; leading?: number; maxWidth?: number; skip?: SkipReason } = {}
): { lines: FLine[]; next: number } {
  const { x = MARGIN, size = 11, leading = 15, maxWidth = BODY_W, skip } = opts
  const lines = wrap(text, size, maxWidth).map((t, i) =>
    simple(t, x, top + i * leading, size, skip)
  )
  return { lines, next: top + lines.length * leading }
}

const header = (text: string): FLine => simple(text, MARGIN, 40, 9, 'running header')
const footer = (n: number): FLine => centered(`Page ${n}`, 760, 9, 'page number footer')

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/** Byte codes used by the ligature font's /Differences (on top of WinAnsiEncoding). */
const LIG_CODES: Record<string, [number, string]> = {
  '\uFB01': [128, 'fi'],
  '\uFB02': [129, 'fl'],
  '\uFB00': [130, 'ff'],
  '\uFB03': [131, 'ffi'],
  '\uFB04': [132, 'ffl'],
  '\u00AD': [133, 'sfthyphen'],
  '\u00A0': [160, 'space']
}

/**
 * Standard (non-embedded) Helvetica can only show WinAnsi characters through pdf-lib's high-level
 * API, and WinAnsi has no ligatures. This registers a second, still non-embedded Helvetica whose
 * encoding maps spare byte codes to the ligature / soft-hyphen glyph names, so pdf.js extracts the
 * real U+FB0x / U+00AD code points, exactly like a typeset PDF would.
 */
function registerLigatureFont(doc: PDFDocument, page: PDFPage): string {
  const first = 32
  const last = 160
  const widths: number[] = []
  for (let c = first; c <= last; c++) {
    const entry = Object.values(LIG_CODES).find(([code]) => code === c)
    let w = 0
    if (entry) {
      const glyph = entry[1]
      w = glyph === 'sfthyphen' ? 0 : glyph === 'space' ? width(' ', 1000) : width(glyph, 1000)
    } else if (c < 127) w = width(String.fromCharCode(c), 1000)
    widths.push(Math.round(w))
  }
  const differences: Array<number | string> = []
  for (const [code, name] of Object.values(LIG_CODES)) differences.push(code, name)
  const dict = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    FirstChar: first,
    LastChar: last,
    Widths: widths,
    Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: differences }
  })
  const key = 'TideLig'
  page.node.setFontDictionary(PDFName.of(key), doc.context.register(dict))
  return key
}

function ligHex(text: string): PDFHexString {
  const hex = Array.from(text)
    .map((ch) => {
      const code = LIG_CODES[ch]?.[0] ?? ch.charCodeAt(0)
      if (code > 255 || (code > 126 && !LIG_CODES[ch]))
        throw new Error(`lig font cannot encode ${ch}`)
      return code.toString(16).padStart(2, '0')
    })
    .join('')
  return PDFHexString.of(hex)
}

function drawLine(page: PDFPage, l: FLine, ligKey: () => string): void {
  let x = l.x
  for (const [i, seg] of l.segs.entries()) {
    const size = seg.size ?? l.size
    if (l.xs) x = l.xs[i]
    else if (seg.gap) x += width(' ', l.size)
    const y = PAGE_H - l.top + (seg.rise ?? 0)
    if (l.font === 'lig') {
      page.pushOperators(
        pushGraphicsState(),
        beginText(),
        setFontAndSize(ligKey(), size),
        moveText(x, y),
        showText(ligHex(seg.text)),
        endText(),
        popGraphicsState()
      )
      x += Array.from(seg.text).reduce((sum, ch) => {
        const lig = LIG_CODES[ch]
        if (!lig) return sum + width(ch, size)
        return (
          sum +
          (lig[1] === 'sfthyphen' ? 0 : lig[1] === 'space' ? width(' ', size) : width(lig[1], size))
        )
      }, 0)
    } else {
      page.drawText(seg.text, { x, y, size, font: helv, color: rgb(0, 0, 0) })
      x += width(seg.text, size)
    }
  }
  if (x > PAGE_W - MARGIN + 0.01 && l.font !== 'lig')
    throw new Error(`line runs into the right margin: "${lineText(l, false)}"`)
}

async function build(f: Fixture): Promise<void> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  helv = await doc.embedFont(StandardFonts.Helvetica)
  // Pages were laid out with the measuring font from main(); standard Helvetica metrics are identical.
  const pages = f.pages
  for (const p of pages) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    let lig: string | undefined
    const ligKey = (): string => (lig ??= registerLigatureFont(doc, page))
    for (const r of p.rects ?? [])
      page.drawRectangle({
        x: r.x,
        y: PAGE_H - r.top - r.h,
        width: r.w,
        height: r.h,
        borderColor: rgb(0.3, 0.3, 0.3),
        borderWidth: 1,
        color: rgb(0.92, 0.92, 0.92)
      })
    for (const l of p.lines) drawLine(page, l, ligKey)
  }
  doc.setTitle(f.title)
  doc.setAuthor('Tide test fixtures')
  doc.setProducer('pdf-lib (Tide scripts/make-fixtures.ts)')
  doc.setCreator('Tide scripts/make-fixtures.ts')
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(join(OUT_DIR, `${f.name}.pdf`), bytes)

  const sidecar = {
    fixture: `${f.name}.pdf`,
    description: f.description,
    pageCount: pages.length,
    pageSize: [PAGE_W, PAGE_H],
    format:
      'Per page: `lines` = expected buildLines(page).map(l => l.text) in reading order; `spoken` = text to speak with DEFAULT_FILTERS; `spokenReadEverything` = text to speak with READ_EVERYTHING; `skipped` = what DEFAULT_FILTERS drop. Spoken text joins lines with single spaces, de-hyphenates "-" + lowercase line starts, and is normalized (ligatures expanded, soft hyphens removed, NBSP/thin space -> space).',
    ...(f.notes ? { notes: f.notes } : {}),
    ...(f.extra ?? {}),
    pages: pages.map((p, i) => {
      const skipped: Array<{ text: string; reason: SkipReason }> = []
      for (const l of p.lines) {
        if (l.skip) skipped.push({ text: lineText(l, false), reason: l.skip })
        else
          for (const s of l.segs)
            if (s.marker) skipped.push({ text: s.text, reason: 'footnote marker' })
      }
      const unedited = joinSpoken(p.lines.filter((l) => !l.skip).map((l) => lineText(l, true)))
      let spoken = unedited
      for (const [find, replace, reason] of p.spokenEdits ?? []) {
        if (spoken.split(find).length !== 2)
          throw new Error(`${f.name} p${i + 1}: "${find}" must occur exactly once`)
        spoken = spoken.replace(find, replace)
        skipped.push({ text: find.trim(), reason })
      }
      return {
        page: i + 1,
        lines: p.lines.map((l) => lineText(l, false)),
        spoken,
        // Only citation edits exist so far, so "with citations" is the page before its edits.
        ...(p.spokenEdits ? { spokenWithCitations: unedited } : {}),
        spokenReadEverything: joinSpoken(p.lines.map((l) => lineText(l, false))),
        skipped
      }
    })
  }
  writeFileSync(join(OUT_DIR, `${f.name}.json`), JSON.stringify(sidecar, null, 2) + '\n')
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function singleColumn(): Fixture {
  const HEADER = 'PSYC 201 — Week 4'
  const bodyPages: string[][] = [
    [],
    [
      'Attention is often compared to a spotlight that moves across a scene. Objects inside the spotlight are processed quickly and in detail. Objects outside it are processed slowly, if at all.',
      'A second view treats attention as a limited pool of resources. Hard tasks draw heavily on the pool and leave little for anything else. This explains why talking on the phone makes driving more dangerous.'
    ],
    [
      'Memory researchers separate encoding, storage and retrieval. Encoding turns an experience into a lasting trace. Storage keeps the trace over time, and retrieval brings it back when it is needed.',
      'Each stage can fail on its own. A student who never encoded a fact cannot retrieve it, no matter how hard they try. A student who encoded it well may still fail to retrieve it under stress.'
    ],
    [
      'Practice testing is one of the most reliable ways to improve retrieval. Each attempt to recall strengthens the path back to the memory. Spacing practice over several days works better than cramming the night before.',
      'Next week we turn to long-term memory and the ways it can be distorted.'
    ]
  ]
  const pages: FPage[] = []

  // Page 1: title, a normal paragraph, a hyphenated line break, an inline footnote marker and a
  // 7pt footnote above the footer.
  {
    const lines: FLine[] = [header(HEADER), simple('Week 4: Attention and Memory', MARGIN, 90, 16)]
    const p1 = para(
      'This week we look at how attention shapes what we remember. Attention acts as a filter that decides which parts of the world reach awareness. Information that is never attended to is rarely stored for long.',
      120
    )
    lines.push(...p1.lines)
    let top = p1.next + 10
    for (const t of [
      'Psychologists have long argued that memory depends on selective atten-',
      'tion to the right details at the right moment. When attention is divided,',
      'people encode less and later recall fewer of the items they saw.'
    ]) {
      lines.push(simple(t, MARGIN, top, 11))
      top += 15
    }
    top += 10
    lines.push({
      segs: [
        { text: 'Working memory capacity' },
        { text: '¹', size: 7, rise: 4, marker: true },
        { text: 'is limited to a few items at once.', gap: true }
      ],
      x: MARGIN,
      top,
      size: 11
    })
    lines.push(
      simple('Most adults can hold about four chunks of information in mind.', MARGIN, top + 15, 11)
    )
    lines.push(simple('¹ See Miller (1956).', MARGIN, 735, 7, 'footnote'))
    lines.push(footer(1))
    pages.push({ lines, rects: [{ x: MARGIN, top: 724, w: 144, h: 0.5 }] })
  }
  for (let n = 2; n <= 4; n++) {
    const lines: FLine[] = [header(HEADER)]
    let top = 90
    for (const text of bodyPages[n - 1]) {
      const p = para(text, top)
      lines.push(...p.lines)
      top = p.next + 10
    }
    lines.push(footer(n))
    pages.push({ lines })
  }
  return {
    name: 'single-column',
    title: 'PSYC 201 Week 4',
    description:
      '4 pages, one column of 11pt body text. Running header "PSYC 201 — Week 4" (9pt, top) and footer "Page N" (9pt, centered, bottom) on every page. Page 1: a 16pt title, a hyphenated line break "atten-" / "tion", an inline 7pt raised footnote marker "¹" after "capacity", and a 7pt footnote "¹ See Miller (1956)." under a short rule above the footer.',
    pages
  }
}

const TWO_COL_TEXT = [
  'Working memory is the small mental workspace we use to hold and change information for a few seconds. It lets us follow a conversation, do sums in our heads and keep track of a plan while we carry it out. Early models treated it as a single store with a fixed number of slots. Later work showed that it is better described as a set of parts that cooperate. A phonological loop holds sounds and words, a visuospatial sketchpad holds images, and a central executive directs attention between them. Attention and working memory are closely linked. When we attend to something, it is far more likely to enter working memory. When working memory is full, our ability to attend to new events drops sharply. This link helps to explain everyday slips, such as walking into a room and forgetting why we came. It also explains why people who are tired or anxious find it harder to concentrate. Researchers measure working memory with span tasks. In a simple span task, a person hears a list of digits and repeats them in order. In a complex span task, the person must also solve a small problem between items. Scores on complex span tasks predict reading comprehension, reasoning and exam results. Training studies have tried to raise these scores through daily practice. Most find that people improve on the trained task but not on other tasks.',
  'The idea of a limited capacity has a long history. In 1956, George Miller suggested that people can hold about seven items at once. Later researchers argued that the true limit is closer to four once rehearsal and chunking are taken into account. Chunking groups separate items into larger meaningful units. A string of twelve letters is hard to remember, but the same letters grouped into four familiar acronyms are easy. Experts rely heavily on chunking. A chess master can glance at a board from a real game and rebuild it almost perfectly. When the pieces are placed at random, the master does no better than a beginner. This shows that expertise works by building larger chunks, not by enlarging the store itself. Forgetting in working memory has two main explanations. Decay theory says that traces fade with time unless they are refreshed. Interference theory says that new information pushes out or blurs the old. Experiments that control both time and the number of intervening items tend to favour interference. Even so, many researchers think both processes play a part. The practical lesson is that rehearsal helps, and that switching between similar tasks makes forgetting worse. Spacing similar topics apart in a study plan reduces this kind of interference. It also helps to vary the setting in which material is studied. Memories tied to many cues are easier to find later.',
  'Attention can be directed in two broad ways. Top-down attention is guided by our goals, as when we search a crowded room for a friend. Bottom-up attention is captured by the world, as when a loud noise makes us turn our heads. The two systems often compete. Advertisers exploit bottom-up capture with bright colours and motion, while good study habits rely on top-down control. Divided attention has clear costs. People who try to read while listening to speech remember less of both. Students who study with their phones nearby check them often, and each check breaks the flow of encoding. The cost is not only the time lost. After a switch, it takes several seconds to rebuild the mental context of the task. These findings suggest simple strategies. Remove distractions before starting a hard task. Work in focused blocks with short breaks between them. Test yourself rather than rereading, because retrieval practice strengthens memory more than passive review. Finally, sleep well, since sleep helps to consolidate what was learned. Short walks and a glass of water between study blocks also help many students stay alert. None of these habits is dramatic on its own, but together they can change how much is remembered a week later. Small changes, kept up over a whole term, add up to large gains.'
]

function twoColumn(): Fixture {
  const COL_W = 216
  const LEFT_X = MARGIN
  const RIGHT_X = PAGE_W - MARGIN - COL_W // 324: gutter is 288..324
  const SIZE = 10
  const LEADING = 13
  const CAP = 16 // lines per column
  const pages: FPage[] = []
  TWO_COL_TEXT.forEach((text, i) => {
    const lines: FLine[] = []
    let top = 72
    let left: string[]
    let right: string[]
    const wrapped = wrap(text, SIZE, COL_W)
    if (i === 0) {
      lines.push(centered('Attention and Working Memory: A Review', 72, 18))
      lines.push(centered('Department of Psychology, Course Reader', 96, 10))
      top = 130
      left = [...wrapped.slice(0, CAP - 1), 'LEFT-END']
      right = ['RIGHT-START', ...wrapped.slice(CAP - 1)]
    } else {
      left = wrapped.slice(0, CAP)
      right = wrapped.slice(CAP)
    }
    // A short right column would drop below the 70% two-sided coverage that marks a two-column page.
    if (right.length > CAP || right.length < 13)
      throw new Error(
        `two-column page ${i + 1}: right column has ${right.length} lines; adjust the text`
      )
    left.forEach((t, k) => lines.push(simple(t, LEFT_X, top + k * LEADING, SIZE)))
    right.forEach((t, k) => lines.push(simple(t, RIGHT_X, top + k * LEADING, SIZE)))
    pages.push({ lines })
  })
  return {
    name: 'two-column',
    title: 'Attention and Working Memory',
    description:
      '3 pages of two 216pt columns (10pt, 13pt leading) at x=72 and x=324 (gutter 288..324). Page 1 has a full-width 18pt centered title and a 10pt centered subtitle above the columns; its left column ends with the marker line "LEFT-END" and its right column starts with "RIGHT-START". Left and right baselines are aligned. On pages 2 and 3 sentences run on from the bottom of the left column to the top of the right. No headers or footers.',
    extra: {
      markers: { leftColumnLastLine: 'LEFT-END', rightColumnFirstLine: 'RIGHT-START', page: 1 }
    },
    notes: ['LEFT-END and RIGHT-START are ordinary words on page 1 and are spoken.'],
    pages
  }
}

function captionsTables(): Fixture {
  const pages: FPage[] = []
  {
    const lines: FLine[] = [simple('Results', MARGIN, 90, 14)]
    const p1 = para(
      'Participants studied word lists of different lengths and then recalled as many words as they could. As Figure 1 shows, recall fell steadily as the lists grew longer.',
      118
    )
    lines.push(...p1.lines)
    const figTop = p1.next + 6
    const fig: Rect = { x: 156, top: figTop, w: 300, h: 140 }
    lines.push(
      simple(
        'Figure 1. Recall by list length.',
        156,
        figTop + fig.h + 16,
        9,
        'figure/table caption'
      )
    )
    const p2 = para(
      'The pattern held for every age group we tested. Table 1 lists the mean number of words recalled in each condition.',
      figTop + fig.h + 44
    )
    lines.push(...p2.lines)
    const capTop = p2.next + 10
    lines.push(
      simple(
        'Table 1. Mean words recalled by list length and age group.',
        156,
        capTop,
        9,
        'figure/table caption'
      )
    )
    const rows = [
      ['5', '4.8', '4.6', '4.1'],
      ['10', '7.2', '6.9', '6.0'],
      ['15', '8.1', '7.7', '6.8'],
      ['20', '8.4', '8.0', '7.1']
    ]
    const colRight = [180, 260, 340, 420] // right-aligned numeric columns
    rows.forEach((row, r) => {
      const xs = row.map((cell, c) => colRight[c] - width(cell, 9))
      lines.push({
        segs: row.map((text, c) => ({ text, gap: c > 0 })),
        x: xs[0],
        xs,
        top: capTop + 20 + r * 14,
        size: 9,
        skip: 'table'
      })
    })
    const p3 = para(
      'Longer lists also produced more intrusions, which we discuss below.',
      capTop + 20 + 4 * 14 + 20
    )
    lines.push(...p3.lines)
    pages.push({ lines, rects: [fig] })
  }
  {
    const p4 = para('Recall was best for words at the start and end of each list.', 90)
    const figTop = p4.next + 6
    const fig: Rect = { x: 156, top: figTop, w: 300, h: 140 }
    const capTop = figTop + fig.h + 16
    const capText = wrap(
      'Figure 2. Serial position curves for the 20-word lists, showing strong primacy and recency effects in every age group we tested.',
      9,
      300
    )
    const caps = capText.map((t, k) => simple(t, 156, capTop + k * 11, 9, 'figure/table caption'))
    const p5 = para(
      'These results match the classic serial position effect.',
      capTop + caps.length * 11 + 20
    )
    pages.push({ lines: [...p4.lines, ...caps, ...p5.lines], rects: [fig] })
  }
  return {
    name: 'captions-tables',
    title: 'Results with figures and a table',
    description:
      '2 pages, 11pt body. Page 1: 14pt heading "Results", a paragraph that mentions Figure 1 mid-sentence, a drawn figure box with the 9pt caption "Figure 1. Recall by list length.", a paragraph, the 9pt caption "Table 1. Mean words recalled by list length and age group." and a 4x4 table of short numbers (9pt, each cell its own text run, right-aligned columns ending at x=180/260/340/420). Page 2: a figure box with a two-line 9pt caption "Figure 2. ..." (the second line is a continuation at the same small size) between two body paragraphs.',
    pages
  }
}

function coverRefs(): Fixture {
  const H = 14
  const pages: FPage[] = []
  pages.push({
    lines: [
      centered('Cognitive Psychology', 250, 28, 'cover page'),
      centered('Course Pack for PSYC 201', 290, 16, 'cover page'),
      centered('Fall 2026', 320, 12, 'cover page'),
      centered('© 2026 Course Pack — All rights reserved', 700, 9, 'cover page')
    ]
  })
  pages.push({
    lines: [
      simple('Contents', MARGIN, 90, 16),
      ...[
        'Introduction ........ 3',
        'Notes ........ 3',
        'Results ........ 4',
        'Discussion ........ 5',
        'References ........ 6'
      ].map((t, k) => simple(t, MARGIN, 124 + k * 18, 11))
    ]
  })
  const section = (blocks: Array<[string, string[]]>, startTop = 90): FLine[] => {
    const lines: FLine[] = []
    let top = startTop
    for (const [heading, paras] of blocks) {
      lines.push(simple(heading, MARGIN, top, H))
      top += 26
      for (const t of paras) {
        const p = para(t, top)
        lines.push(...p.lines)
        top = p.next + 10
      }
      top += 14
    }
    return lines
  }
  pages.push({
    lines: section([
      [
        'Introduction',
        [
          'This course pack collects short readings on memory and attention. Each reading is followed by questions that help you check your understanding. Read the introduction to each section before the readings themselves.'
        ]
      ],
      [
        'Notes',
        [
          'These notes explain how the readings fit together. Some readings overlap, and the notes point out where authors disagree. Use them as a guide, not as a replacement for the readings.'
        ]
      ]
    ])
  })
  pages.push({
    lines: section([
      [
        'Results',
        [
          'Students who used the questions after each reading scored higher on the final exam. The benefit was largest for students who answered the questions without looking back at the text.',
          'Students who only reread the material showed little improvement over the term.'
        ]
      ]
    ])
  })
  pages.push({
    lines: section([
      [
        'Discussion',
        [
          'Answering questions works because it forces retrieval. Each successful retrieval makes the memory easier to find the next time. Rereading feels productive, but it mostly builds familiarity rather than recall.'
        ]
      ]
    ])
  })
  {
    const p = para(
      'In short, testing yourself is one of the most useful habits a student can build.',
      90
    )
    const lines: FLine[] = [...p.lines]
    let top = p.next + 24
    lines.push(simple('References', MARGIN, top, H, 'references'))
    top += 26
    for (const entry of [
      'Baddeley, A. D. (2000). The episodic buffer: A new component of working memory? Trends in Cognitive Sciences, 4(11), 417–423.',
      'Miller, G. A. (1956). The magical number seven, plus or minus two: Some limits on our capacity for processing information. Psychological Review, 63(2), 81–97.',
      'Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. Psychological Science, 17(3), 249–255.'
    ]) {
      // Hanging indent: first line at the margin, continuation lines indented 18pt.
      const first = wrap(entry, 10, BODY_W)[0]
      const rest = wrap(entry.slice(first.length).trim(), 10, BODY_W - 18)
      lines.push(simple(first, MARGIN, top, 10, 'references'))
      top += 13
      for (const t of rest) {
        lines.push(simple(t, MARGIN + 18, top, 10, 'references'))
        top += 13
      }
      top += 6
    }
    pages.push({ lines })
  }
  return {
    name: 'cover-refs',
    title: 'Cognitive Psychology Course Pack',
    description:
      '6 pages. Page 1: cover (28/16/12pt centered title lines) with the 9pt line "© 2026 Course Pack — All rights reserved". Page 2: table of contents ("Contents" 16pt, 11pt dot-leader entries including "References ........ 6"). Page 3: 14pt headings "Introduction" and a mid-document "Notes" (page 3 of 6, before 60% of the document). Pages 4-5: 14pt headings "Results", "Discussion" with body text. Page 6: a body paragraph, then a 14pt "References" heading followed by 10pt APA entries with an 18pt hanging indent. No running headers or footers.',
    notes: [
      'Page 1 is skipped by default as a cover/copyright page (© / "all rights reserved" / "course pack" markers).',
      'Page 2 (contents) is spoken by default: the spec has no table-of-contents filter, it has no cover markers, and it has more than 2 sentences. Its "References ........ 6" line must NOT stop reading (not a standalone heading; page 2 of 6).',
      'The page 3 "Notes" heading is a standalone heading-sized line but lies before the last 40% of the document, so it must NOT stop reading.',
      'Speech stops at the page 6 "References" heading (last 40% of the document): the heading and everything after it are not spoken by default.'
    ],
    pages
  }
}

function citations(): Fixture {
  const sentences = [
    'Short-term memory fades within seconds without rehearsal (Smith, 2019).',
    'Chunking extends this limit considerably (Smith & Jones, 2019, p. 4).',
    'Several studies replicate the effect (e.g., Lee et al., 2020; Kim, 2021).',
    'Interference, not decay, explains most forgetting [12].',
    'Earlier reviews reached the same conclusion [3–5].',
    'Smith (2019) argues that rehearsal is the key mechanism.',
    'The participant (born 1990 in Leeds) completed every session.'
  ]
  const p = para(sentences.join(' '), 90)
  const edits: Array<[string, string, SkipReason]> = [
    [' (Smith, 2019)', '', 'citation'],
    [' (Smith & Jones, 2019, p. 4)', '', 'citation'],
    [' (e.g., Lee et al., 2020; Kim, 2021)', '', 'citation'],
    [' [12]', '', 'citation'],
    [' [3–5]', '', 'citation'],
    ['Smith (2019) argues', 'Smith argues', 'citation']
  ]
  return {
    name: 'citations',
    title: 'Citations',
    description:
      '1 page, one 11pt paragraph of seven sentences containing (Smith, 2019), (Smith & Jones, 2019, p. 4), (e.g., Lee et al., 2020; Kim, 2021), [12], [3–5] (en dash), the narrative citation "Smith (2019) argues" and the non-citation "(born 1990 in Leeds)".',
    notes: [
      'Default (readCitations: false) removes the parenthetical and bracketed citations together with the space before them, and the year from the narrative citation ("Smith (2019) argues" -> "Smith argues").',
      '"(born 1990 in Leeds)" is not a citation and is always spoken.',
      "With readCitations: true (and with READ_EVERYTHING) the text is spoken unchanged: see each page's `spokenWithCitations`."
    ],
    pages: [{ lines: p.lines, spokenEdits: edits }],
    extra: { sentences }
  }
}

function noText(): Fixture {
  return {
    name: 'no-text',
    title: 'No text layer',
    description: '2 pages, each with only a drawn grey rectangle and no text at all.',
    notes: [
      'Both pages are textless: extractPages gives 0 items per page, buildLines gives [], and both pages belong in textlessPages.'
    ],
    pages: [
      { lines: [], rects: [{ x: 106, top: 196, w: 400, h: 400 }] },
      { lines: [], rects: [{ x: 156, top: 246, w: 300, h: 300 }] }
    ]
  }
}

function ligatures(): Fixture {
  const lig = (text: string, top: number): FLine => ({
    segs: [{ text }],
    x: MARGIN,
    top,
    size: 12,
    font: 'lig'
  })
  return {
    name: 'ligatures',
    title: 'Ligatures',
    description:
      '1 page, 12pt Helvetica re-encoded so the text layer holds real typographic code points: "\uFB01gure" and "bene\uFB01t" (U+FB01), "\uFB02at" (U+FB02), "E\uFB00ects" (U+FB00), "o\uFB03ce" (U+FB03), "ba\uFB04ing" (U+FB04), "o\\u00ADther" (soft hyphen) and "450\\u00A0ms" (no-break space).',
    notes: [
      'pdf.js (getTextContent with disableNormalization: true) keeps U+FB00-FB04 in item.str, maps the no-break space to a plain space, and drops U+00AD entirely (it skips Unicode format characters), so "o\\u00ADther" extracts as "other".'
    ],
    pages: [
      {
        lines: [
          lig('The \uFB01gure shows a clear bene\uFB01t for the o\u00ADther group.', 90),
          lig('E\uFB00ects were \uFB02at in the o\uFB03ce and ba\uFB04ing elsewhere.', 108),
          lig('Responses took 450\u00A0ms on average.', 126)
        ]
      }
    ]
  }
}

function longSentence(): Fixture {
  const sentence =
    'When students prepare for an exam in a crowded and noisy library while also answering messages on their phones, listening to music through headphones, glancing at the clock every few minutes, worrying about the other assignments that are due later in the same week, and trying to remember which chapters the instructor said would be covered, they often find that the material they read seems familiar at the time but slips away almost completely by the following morning, because divided attention prevents the careful encoding that durable memories require, and because the feeling of familiarity that comes from rereading is easily mistaken for real understanding, which is why researchers recommend quiet surroundings, focused sessions, regular self-testing and enough sleep as the most reliable ways to turn study into lasting knowledge.'
  const words = sentence.split(/\s+/).length
  if (words !== 130) throw new Error(`long sentence has ${words} words, expected 130`)
  return {
    name: 'long-sentence',
    title: 'One long sentence',
    description:
      '1 page, one 11pt paragraph that is a single 130-word sentence with commas but no other terminal punctuation.',
    extra: { wordCount: words },
    pages: [{ lines: para(sentence, 90).lines }]
  }
}

// ---------------------------------------------------------------------------------------------
// Password and damaged fixtures (no sidecars: they are not part of the text pipeline's goldens)
// ---------------------------------------------------------------------------------------------

const md5 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('md5')
  for (const p of parts) h.update(p)
  return h.digest()
}

/** RC4. Hand-rolled because OpenSSL 3 (Node 17+) no longer offers `rc4`. */
function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = Buffer.alloc(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

/** PDF 1.7 §7.6.3.3: the 32-byte password padding string. */
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
const padPassword = (pw: string): Buffer =>
  Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32)

/**
 * A one-page PDF encrypted with the Standard Security Handler V1 R2 (RC4 40-bit), user password
 * `tide`, owner password `owner`. Only the content stream is encrypted (names, /O and /U stay
 * plain). Built by hand because pdf-lib cannot encrypt.
 */
function lockedPdf(): Buffer {
  const P = -44 // all permissions of an R2 handler; its 32-bit LE bytes are D4 FF FF FF
  const pBytes = Buffer.from([0xd4, 0xff, 0xff, 0xff])
  const id = md5(Buffer.from('tide locked fixture'))
  // Algorithm 3 (R2): O = RC4(first 5 bytes of MD5(padded owner password), padded user password).
  const O = rc4(md5(padPassword('owner')).subarray(0, 5), padPassword('tide'))
  // Algorithm 2 (R2): file key = first 5 bytes of MD5(padded user pw + O + P + ID[0]).
  const key = md5(padPassword('tide'), O, pBytes, id).subarray(0, 5)
  // Algorithm 4 (R2): U = RC4(file key, padding string).
  const U = rc4(key, PAD)
  // Algorithm 1: per-object key = first min(n + 5, 16) bytes of MD5(key + objnum[3 LE] + gen[2 LE]).
  const objKey = (num: number): Buffer =>
    md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(
      0,
      Math.min(key.length + 5, 16)
    )
  const content = Buffer.from('BT /F1 18 Tf 72 700 Td (Locked fixture text.) Tj ET', 'latin1')
  const enc = rc4(objKey(4), content)
  const hex = (b: Buffer): string => `<${b.toString('hex')}>`

  const objs: Array<Buffer | string> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    Buffer.concat([
      Buffer.from(`<< /Length ${enc.length} >>\nstream\n`, 'latin1'),
      enc,
      Buffer.from('\nendstream', 'latin1')
    ]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /O ${hex(O)} /U ${hex(U)} /P ${P} >>`
  ]
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')]
  const offsets: number[] = []
  let pos = chunks[0].length
  objs.forEach((o, i) => {
    offsets.push(pos)
    const b = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      typeof o === 'string' ? Buffer.from(o, 'latin1') : o,
      Buffer.from('\nendobj\n', 'latin1')
    ])
    chunks.push(b)
    pos += b.length
  })
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref +=
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\n` +
    `startxref\n${pos}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(chunks)
}

function writeOpenFailureFixtures(): void {
  writeFileSync(join(OUT_DIR, 'not-a-pdf.pdf'), 'This file is not a PDF.')
  writeFileSync(join(OUT_DIR, 'locked.pdf'), lockedPdf())
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  // Fixtures measure text with Helvetica while being defined, so the font is loaded first.
  const measureDoc = await PDFDocument.create({ updateMetadata: false })
  helv = await measureDoc.embedFont(StandardFonts.Helvetica)
  const fixtures = [
    singleColumn,
    twoColumn,
    captionsTables,
    coverRefs,
    citations,
    noText,
    ligatures,
    longSentence
  ].map((f) => f())
  for (const f of fixtures) await build(f)
  writeOpenFailureFixtures()
  console.log(`wrote ${fixtures.length} fixtures to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
