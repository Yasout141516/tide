import { describe, it, expect } from 'vitest'
import { splitForSpeech } from '../../src/tts/split'
import { countTokens } from '../../src/tts/tokens'

const c = (s: string): Promise<number> => Promise.resolve(s.length)

describe('splitForSpeech', () => {
  it('keeps short text whole', async () =>
    expect(await splitForSpeech('Hi there.', c, 400)).toEqual(['Hi there.']))

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
