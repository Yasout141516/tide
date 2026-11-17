import { describe, expect, it } from 'vitest'
import { readingTitle } from '../../../src/shared/library/title'

describe('readingTitle', () => {
  it.each([
    ['Memory and Attention', 'x.pdf', 'Memory and Attention'],
    ['Microsoft Word - ch2.docx', 'Week_4_Institutions.pdf', 'Week 4 Institutions'],
    [undefined, 'ch2.PDF', 'ch2'],
    ['  ', '__.pdf', 'Untitled reading'],
    ['Untitled', 'a_b.pdf', 'a b'],
    ['Title IX and Campus Policy', 'x.pdf', 'Title IX and Campus Policy'],
    ['Document Design Basics', 'x.pdf', 'Document Design Basics'],
    ['Document3', 'doc_3.pdf', 'doc 3'],
    ['Slide 4', 's.pdf', 's'],
    ['Microsoft PowerPoint - week1', 'w1.pdf', 'w1'],
    ['Chapter 2.pdf', 'c.pdf', 'c'],
    ['abc', 'f.pdf', 'f'],
    ['1234 56', 'f.pdf', 'f'],
    ['x'.repeat(121), 'f.pdf', 'f'],
    ['  Padded title  ', 'f.pdf', 'Padded title']
  ])('readingTitle(%j, %j) → %j', (m, f, want) => expect(readingTitle(m, f)).toBe(want))
})
