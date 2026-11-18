import { describe, expect, it } from 'vitest'
import { anchorOf, resolveAnchor, type Anchor } from '../../../src/shared/text/anchor'
import { extractPages } from '../../../src/shared/text/extract'
import { buildSentences } from '../../../src/shared/text/pipeline'
import {
  DEFAULT_FILTERS,
  READ_EVERYTHING,
  type ReadingFilters,
  type Sentence
} from '../../../src/shared/text/types'
import { readFixture } from './helpers'

const sentencesOf = async (
  name: string,
  filters: ReadingFilters = DEFAULT_FILTERS
): Promise<Sentence[]> =>
  buildSentences(await extractPages(readFixture(`${name}.pdf`)), filters).sentences

const covers = (s: Sentence, a: Anchor): boolean =>
  s.spans.some(
    (p) =>
      p.page === a.page &&
      p.itemIndex === a.textItemIndex &&
      p.start <= a.charOffset &&
      a.charOffset < p.end
  )

describe('resume anchor', () => {
  it('anchorOf is the first span of the sentence', async () => {
    const s = (await sentencesOf('single-column'))[1]
    expect(anchorOf(s)).toEqual({
      page: s.spans[0].page,
      textItemIndex: s.spans[0].itemIndex,
      charOffset: s.spans[0].start
    })
  })

  it('anchor survives flipping "read citations"', async () => {
    const before = await sentencesOf('citations')
    const after = await sentencesOf('citations', { ...DEFAULT_FILTERS, readCitations: true })
    expect(before.length).toBeGreaterThan(0)
    before.forEach((s, k) => {
      const a = anchorOf(s)
      const i = resolveAnchor(after, a)
      expect(covers(after[i], a), `sentence ${k}`).toBe(true)
    })
  })

  it('anchor survives Read everything on and off', async () => {
    const all = await sentencesOf('cover-refs', READ_EVERYTHING)
    const def = await sentencesOf('cover-refs')
    const k = def.findIndex((s) => s.spans[0].page === 4)
    expect(k).toBeGreaterThanOrEqual(0)
    const a = anchorOf(def[k])
    const on = resolveAnchor(all, a)
    expect(covers(all[on], a)).toBe(true)
    expect(resolveAnchor(def, anchorOf(all[on]))).toBe(k)
  })

  it('falls forward when the anchored text is now skipped', async () => {
    const all = await sentencesOf('cover-refs', READ_EVERYTHING)
    const def = await sentencesOf('cover-refs')
    const cover = all.find((s) => s.spans[0].page === 1)!
    expect(def.some((s) => covers(s, anchorOf(cover)))).toBe(false)
    const i = resolveAnchor(def, anchorOf(cover))
    expect(i).toBe(0)
    expect(def[i].spans[0].page).toBeGreaterThan(1)
  })

  it('an anchor past the last sentence resolves to the last sentence', async () => {
    const all = await sentencesOf('cover-refs', READ_EVERYTHING)
    const def = await sentencesOf('cover-refs')
    const refs = all[all.length - 1]
    expect(refs.spans[0].page).toBe(6)
    expect(resolveAnchor(def, anchorOf(refs))).toBe(def.length - 1)
  })

  it('resolveAnchor of an empty list is -1', () => {
    expect(resolveAnchor([], { page: 1, textItemIndex: 0, charOffset: 0 })).toBe(-1)
  })
})
