import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeCitations } from '../../../src/shared/text/citations'
import { extractPages } from '../../../src/shared/text/extract'
import { buildSentences, renderSentences } from '../../../src/shared/text/pipeline'
import { segmentSentences } from '../../../src/shared/text/sentences'
import { SpokenText } from '../../../src/shared/text/spoken'
import { READ_EVERYTHING, type PageText } from '../../../src/shared/text/types'
import { FIXTURES, line, readFixture } from './helpers'

const SPOKEN = join(__dirname, '..', '..', 'fixtures', 'spoken')
const GOLDEN = [
  'single-column',
  'two-column',
  'captions-tables',
  'cover-refs',
  'citations',
  'ligatures',
  'long-sentence'
]

const sidecar = (name: string): { pages: Array<Record<string, string>> } =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
const pagesOf = (name: string): Promise<PageText[]> => extractPages(readFixture(`${name}.pdf`))

describe('golden spoken text', () => {
  for (const f of GOLDEN)
    it(`golden spoken text: ${f}`, async () => {
      const got = renderSentences(buildSentences(await pagesOf(f)).sentences)
      expect(got).toBe(readFileSync(join(SPOKEN, `${f}.txt`), 'utf8'))
    })
})

describe('citations', () => {
  it('removes citations but keeps "(born 1990 in Leeds)"', async () => {
    const { sentences } = buildSentences(await pagesOf('citations'))
    const text = sentences.map((s) => s.text).join(' ')
    expect(text).toBe(sidecar('citations').pages[0].spoken)
    expect(text).toContain('(born 1990 in Leeds)')
    expect(text).not.toMatch(/\(Smith|\[\d|2019|2020|2021|\(\s*\)/)
  })

  it('removes nothing when citations are read', async () => {
    const { sentences } = buildSentences(await pagesOf('citations'), {
      ...READ_EVERYTHING,
      readCitations: true
    })
    expect(sentences.map((s) => s.text).join(' ')).toBe(
      sidecar('citations').pages[0].spokenWithCitations
    )
  })

  it('keeps a narrative year that does not follow a capitalised name', () => {
    const s = new SpokenText()
    s.appendLine(line('In the study (2019) we and smith (2020) found [a] effect.'))
    removeCitations(s)
    expect(s.blocks()[0].text).toBe('In the study (2019) we and smith (2020) found [a] effect.')
  })

  it('removes "et al." narrative years and page-numbered years', () => {
    const s = new SpokenText()
    s.appendLine(line('Lee et al. (2020) and Kim (2021, p. 12) agree [1, 4–6].'))
    removeCitations(s)
    expect(s.blocks()[0].text).toBe('Lee et al. and Kim agree.')
  })
})

describe('sentences', () => {
  it('does not split on "e.g." or "et al."', async () => {
    // With citations read, "(e.g., Lee et al., 2020; ...)" and "p. 4" stay in the text.
    const { sentences } = buildSentences(await pagesOf('citations'), READ_EVERYTHING)
    expect(sentences).toHaveLength(7)
    expect(sentences[1].text).toBe(
      'Chunking extends this limit considerably (Smith & Jones, 2019, p. 4).'
    )
    expect(sentences[2].text).toBe(
      'Several studies replicate the effect (e.g., Lee et al., 2020; Kim, 2021).'
    )
  })

  it('merges abbreviation-ended and tiny segments into the next one', () => {
    const text = 'See Fig. 2 for details. Dr. Smith agreed, i.e. mostly. A. Then more vs. less.'
    const got = segmentSentences(text).map((r) => text.slice(r.start, r.end))
    expect(got).toEqual([
      'See Fig. 2 for details.',
      'Dr. Smith agreed, i.e. mostly.',
      'A. Then more vs. less.'
    ])
  })

  it('does not split after a single-letter initial', () => {
    const text = 'Early researcher J. K. Rowan proposed a model. Barlow, T. M. (2003). Next.'
    const got = segmentSentences(text).map((r) => text.slice(r.start, r.end))
    expect(got).toEqual([
      'Early researcher J. K. Rowan proposed a model.',
      'Barlow, T. M. (2003).',
      'Next.'
    ])
  })

  it('keeps a quoted question with the lowercase words that follow it', () => {
    const text =
      '“Is anyone listening?” the tutor asked. “Fine!” she said. Why? Because. ' +
      '“Wait!” (inner voice), which slowed things down.'
    const got = segmentSentences(text).map((r) => text.slice(r.start, r.end))
    expect(got).toEqual([
      '“Is anyone listening?” the tutor asked.',
      '“Fine!” she said.',
      'Why?',
      'Because.',
      '“Wait!” (inner voice), which slowed things down.'
    ])
  })

  it('returns trimmed ranges and drops whitespace-only segments', () => {
    expect(segmentSentences('   ')).toEqual([])
    const text = 'One here.   Two there.  '
    expect(segmentSentences(text)).toEqual([
      { start: 0, end: 9 },
      { start: 12, end: 22 }
    ])
  })
})

describe('buildSentences', () => {
  it('Read everything keeps headers, footnotes, captions, references and citations', async () => {
    for (const f of ['cover-refs', 'citations', 'single-column', 'captions-tables']) {
      const { sentences } = buildSentences(await pagesOf(f), READ_EVERYTHING)
      const expected = sidecar(f)
        .pages.map((p) => p.spokenReadEverything)
        .filter(Boolean)
        .join(' ')
      expect(sentences.map((s) => s.text).join(' '), f).toBe(expected)
    }
  })

  it('no-text pdf', async () => {
    const r = buildSentences(await pagesOf('no-text'))
    expect(r.sentences).toEqual([])
    expect(r.textlessPages).toEqual([1, 2])
  })

  it('lists textless pages among pages with text', () => {
    const blank = (page: number): PageText => ({ page, width: 612, height: 792, items: [] })
    const withText: PageText = {
      page: 2,
      width: 612,
      height: 792,
      items: [
        { page: 2, index: 0, str: 'Only words here.', x: 72, y: 100, width: 80, fontSize: 10 }
      ]
    }
    // READ_EVERYTHING: by default a 3-word page among the first three is a cover page.
    const r = buildSentences([blank(1), withText, blank(3)], READ_EVERYTHING)
    expect(r.textlessPages).toEqual([1, 3])
    expect(r.sentences.map((s) => s.text)).toEqual(['Only words here.'])
  })

  it('reads a short handout whose every page looks like a cover page', () => {
    // Two short pages (each under 60 words and at most 2 sentences): on their own each would count
    // as a cover page, but skipping both would leave nothing to read.
    const shortPage = (n: number, text: string[]): PageText => ({
      page: n,
      width: 612,
      height: 792,
      items: text.map((str, index) => ({
        page: n,
        index,
        str,
        x: 72,
        y: 300 + 14 * index,
        width: str.length * 5,
        fontSize: 10
      }))
    })
    const r = buildSentences([
      shortPage(1, ['Bring a pencil and your notes to the review session.', 'It starts at noon.']),
      shortPage(2, ['The quiz covers chapters one to three.'])
    ])
    expect(r.sentences.map((s) => s.text)).toEqual([
      'Bring a pencil and your notes to the review session.',
      'It starts at noon.',
      'The quiz covers chapters one to three.'
    ])
    expect(r.skippedPages).toEqual([])
  })

  it('reports the pages skipped as cover pages and References', async () => {
    const r = buildSentences(await pagesOf('cover-refs'))
    expect(r.skippedPages).toEqual([
      { page: 1, reason: 'cover' },
      { page: 6, reason: 'references' }
    ])
    expect(buildSentences(await pagesOf('cover-refs'), READ_EVERYTHING).skippedPages).toEqual([])
  })

  it('keeps a heading wrapped over two lines together, apart from the body', () => {
    const p: PageText = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        { str: 'Why Do Some Study Habits Outlast', y: 100, fontSize: 18 },
        { str: 'Others', y: 123, fontSize: 18 },
        { str: 'Spaced practice beats cramming for most learners.', y: 150, fontSize: 12 },
        { str: 'Sleep helps it stick.', y: 165, fontSize: 12 },
        { str: 'Short Heading', y: 195, fontSize: 18 },
        { str: 'Body text again, for a while.', y: 220, fontSize: 12 }
      ].map((i, index) => ({ ...i, page: 1, index, x: 72, width: i.str.length * 6 }))
    }
    const { sentences } = buildSentences([p], READ_EVERYTHING)
    expect(sentences.map((s) => s.text)).toEqual([
      'Why Do Some Study Habits Outlast Others',
      'Spaced practice beats cramming for most learners.',
      'Sleep helps it stick.',
      'Short Heading',
      'Body text again, for a while.'
    ])
  })

  it('numbers sentences from 0 in reading order', async () => {
    const { sentences } = buildSentences(await pagesOf('single-column'))
    expect(sentences.map((s) => s.id)).toEqual(sentences.map((_, i) => i))
  })

  it('every sentence maps to at least one span on a real item', async () => {
    for (const f of [...GOLDEN, 'no-text']) {
      const pages = await pagesOf(f)
      for (const filters of [undefined, READ_EVERYTHING]) {
        for (const s of buildSentences(pages, filters).sentences) {
          expect(s.spans.length, `${f}: "${s.text}"`).toBeGreaterThan(0)
          for (const sp of s.spans) {
            const item = pages[sp.page - 1].items.find((i) => i.index === sp.itemIndex)
            expect(item, `${f}: "${s.text}"`).toBeDefined()
            expect(sp.start).toBeGreaterThanOrEqual(0)
            expect(sp.start).toBeLessThan(sp.end)
            expect(sp.end).toBeLessThanOrEqual(item!.str.length)
          }
        }
      }
    }
  })

  it('maps a sentence to the text it was spoken from', async () => {
    const pages = await pagesOf('citations')
    const { sentences } = buildSentences(pages)
    const s = sentences[5] // "Smith argues that rehearsal is the key mechanism."
    const source = s.spans
      .map((sp) =>
        pages[0].items.find((i) => i.index === sp.itemIndex)!.str.slice(sp.start, sp.end)
      )
      .join(' ')
    expect(source).toContain('Smith')
    expect(source).toContain('argues that rehearsal is the key mechanism.')
    expect(source).not.toContain('2019')
  })
})
