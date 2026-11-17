import { describe, it, expect, vi } from 'vitest'
import { splitForSpeech } from '../../src/tts/split'
import { countTokens } from '../../src/tts/tokens'

const c = (s: string): Promise<number> => Promise.resolve(s.length)

describe('splitForSpeech', () => {
  it('keeps short text whole', async () =>
    expect(await splitForSpeech('Hi there.', c, 400)).toEqual(['Hi there.']))

  it('does not phonemize a short digit-free sentence, but counts one with digits', async () => {
    const count = vi.fn(c)
    expect(await splitForSpeech('Most adults keep about four items in mind.', count)).toEqual([
      'Most adults keep about four items in mind.'
    ])
    expect(count).not.toHaveBeenCalled()
    expect(await splitForSpeech('Seven of 12 adults recalled 4 items.', count)).toEqual([
      'Seven of 12 adults recalled 4 items.'
    ])
    expect(count).toHaveBeenCalled()
  })

  it('counts a short sentence with acronyms, symbols, Greek or math characters', async () => {
    const counted = async (t: string): Promise<boolean> => {
      const count = vi.fn(c)
      expect(await splitForSpeech(t, count)).toEqual([t])
      return count.mock.calls.length > 0
    }
    expect(await counted('The WHO and UNESCO agreed.')).toBe(true)
    expect(await counted('Growth was 5% higher.')).toBe(true)
    expect(await counted('Profit & loss both rose.')).toBe(true)
    for (const ch of '%&$#@+=<>/\\^~|€£§°')
      expect(await counted(`A word ${ch} a word.`), `symbol ${ch}`).toBe(true)
    expect(await counted('The alpha level α held.')).toBe(true)
    expect(await counted('Take the ∑ of the parts.')).toBe(true)
    // A plain sentence, curly quotes and dashes included, is not counted.
    expect(await counted('A plain sentence about rivers.')).toBe(false)
    expect(await counted('She said “yes” – then left — quietly.')).toBe(false)
    expect(await counted('It’s a Big Day for Anna.')).toBe(false)
  })

  it('prefers semicolons over commas', async () => {
    const t = 'a'.repeat(250) + '; ' + 'b'.repeat(250) + ', c.'
    const out = await splitForSpeech(t, c, 400)
    expect(out[0].endsWith('; ')).toBe(true)
    expect(out.join('')).toBe(t)
  })

  it('splits at commas when a semicolon piece is still too long', async () => {
    const t = ('x'.repeat(150) + ', ').repeat(5) + 'end.'
    const out = await splitForSpeech(t, c, 400)
    for (const ch of out) expect(ch.length).toBeLessThanOrEqual(400)
    expect(out.join('')).toBe(t)
    expect(out.length).toBeGreaterThan(1)
  })

  it('word-boundary fallback', async () => {
    const t = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ')
    const out = await splitForSpeech(t, c, 400)
    for (const ch of out) expect(ch.length).toBeLessThanOrEqual(400)
    expect(out.join('')).toBe(t)
  })

  it('real phonemizer: a 120-word academic sentence stays within budget', async () => {
    const t =
      'Although the longitudinal study of urban pedestrian behaviour, conducted across eleven metropolitan districts over a period of nearly fourteen years, revealed substantial heterogeneity in how residents perceive and negotiate shared public space, the authors argue that the prevailing theoretical frameworks, which were developed primarily from small cross-sectional samples in northern European cities, systematically underestimate the influence of infrastructural constraints, socioeconomic stratification, and historical patterns of municipal investment; consequently, any attempt to generalise these findings to rapidly growing cities in the developing world, where informal settlements, irregular transport networks, and contested land tenure fundamentally reshape everyday mobility, must be treated with considerable caution, and should be accompanied by careful, locally grounded empirical validation before policy recommendations are drawn.'
    expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(110)
    const out = await splitForSpeech(t, countTokens, 400)
    expect(out.join('')).toBe(t)
    for (const ch of out) expect(await countTokens(ch)).toBeLessThanOrEqual(400)
  }, 60000)
})
