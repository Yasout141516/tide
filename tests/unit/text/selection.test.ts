import { describe, expect, it } from 'vitest'
import { selectionSentences, type Point } from '../../../src/shared/text/selection'
import type { Sentence } from '../../../src/shared/text/types'

// Sentence 0: page 1 item 0 [0,10). Sentence 1: page 1 item 1 [0,8) + item 2 [0,5).
// Sentence 2: page 2 item 0 [0,12). Sentence 3: page 2 item 3 [4,9) (item 1-2 and 3[0,4) are skipped text).
const sentences: Sentence[] = [
  { id: 0, text: 'a', spans: [{ page: 1, itemIndex: 0, start: 0, end: 10 }] },
  {
    id: 1,
    text: 'b',
    spans: [
      { page: 1, itemIndex: 1, start: 0, end: 8 },
      { page: 1, itemIndex: 2, start: 0, end: 5 }
    ]
  },
  { id: 2, text: 'c', spans: [{ page: 2, itemIndex: 0, start: 0, end: 12 }] },
  { id: 3, text: 'd', spans: [{ page: 2, itemIndex: 3, start: 4, end: 9 }] }
]
const p = (page: number, itemIndex: number, offset: number): Point => ({ page, itemIndex, offset })

describe('selectionSentences', () => {
  it('a selection inside one sentence maps to that sentence', () => {
    expect(selectionSentences(sentences, p(1, 1, 2), p(1, 1, 6))).toEqual([1, 1])
  })

  it('a selection across three sentences on two pages maps to the first and last', () => {
    expect(selectionSentences(sentences, p(1, 2, 3), p(2, 3, 6))).toEqual([1, 3])
  })

  it('reversed points give the same result', () => {
    expect(selectionSentences(sentences, p(2, 3, 6), p(1, 2, 3))).toEqual([1, 3])
  })

  it('a selection inside skipped text maps to no sentences', () => {
    expect(selectionSentences(sentences, p(2, 1, 0), p(2, 2, 3))).toBeNull()
    expect(selectionSentences(sentences, p(2, 3, 0), p(2, 3, 3))).toBeNull()
  })

  it('a selection ending exactly at a sentence start does not include that sentence', () => {
    expect(selectionSentences(sentences, p(1, 0, 2), p(2, 0, 0))).toEqual([0, 1])
    expect(selectionSentences(sentences, p(1, 0, 2), p(1, 1, 0))).toEqual([0, 0])
  })
})
