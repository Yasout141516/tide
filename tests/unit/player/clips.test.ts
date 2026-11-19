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
})
