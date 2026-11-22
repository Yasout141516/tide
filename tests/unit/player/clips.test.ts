import { describe, expect, it } from 'vitest'
import { firstClips } from '../../../src/renderer/src/player/clips'

describe('clips', () => {
  it('firstClips splits at the first clause boundary and rejoins exactly', () => {
    const text =
      'When the morning light finally reached the valley, the farmers began to gather near the old well.'
    const parts = firstClips(text)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBe('When the morning light finally reached the valley,')
    expect(parts.join('')).toBe(text)
  })

  it('firstClips keeps short or unpunctuated sentences whole', () => {
    expect(firstClips('Well, that was fast and fun.')).toEqual(['Well, that was fast and fun.'])
    expect(firstClips('No punctuation here at all just words running on')).toEqual([
      'No punctuation here at all just words running on'
    ])
    const late = 'word '.repeat(40) + 'one two three four, five six seven'
    expect(firstClips(late)).toEqual([late])
  })

  it('firstClips does not split inside numbers or times', () => {
    const a = 'We paid about 1,000 dollars to the old man at the gate today'
    expect(firstClips(a)).toEqual([a])
    const b = 'The train leaves at 12:30 from the quiet station nearby'
    expect(firstClips(b)).toEqual([b])
    const c = 'We paid about 1,000 dollars, then walked to the old gate today'
    expect(firstClips(c)).toEqual([
      'We paid about 1,000 dollars,',
      ' then walked to the old gate today'
    ])
  })

  it('firstClips with maxFirstWords splits early at a clause boundary', () => {
    const a = 'In fact, the farmers began to gather near the old well today.'
    expect(firstClips(a)).toEqual([a]) // the usual rule wants 4 words first
    expect(firstClips(a, { maxFirstWords: 8 })).toEqual([
      'In fact,',
      ' the farmers began to gather near the old well today.'
    ])
    // a boundary later than the limit falls back to the usual rule
    const b = 'The farmers on the far side of the river, gathered near the old well today.'
    expect(firstClips(b, { maxFirstWords: 5 })).toEqual(firstClips(b))
    expect(firstClips(b, { maxFirstWords: 8 })).toEqual([
      'The farmers on the far side of the river,',
      ' gathered near the old well today.'
    ])
    // R5 still holds: never inside numbers or times
    const c = 'About 1,000 people came at 12:30 to see the old harbour lights.'
    expect(firstClips(c, { maxFirstWords: 8 })).toEqual([c])
    // a one-word lead-in is too short to be a clip
    const d = 'Well, that was a very fast and fun ride today.'
    expect(firstClips(d, { maxFirstWords: 8 })).toEqual([d])
    for (const t of [a, b, c, d]) expect(firstClips(t, { maxFirstWords: 8 }).join('')).toBe(t)
  })
})
