import { describe, expect, it } from 'vitest'
import { SAMPLE_RATE, trimSilence } from '../../src/shared/pcm'

const ms = (n: number): number => Math.round((n * SAMPLE_RATE) / 1000)
/** lead ms of faint noise, a 440 Hz tone of the given amplitude, trail ms of faint noise. */
function clip(
  leadMs: number,
  toneMs: number,
  trailMs: number,
  amp = 0.5,
  noise = 0.0005
): Float32Array {
  const out = new Float32Array(ms(leadMs) + ms(toneMs) + ms(trailMs))
  for (let i = 0; i < out.length; i++) out[i] = noise * (i % 2 ? 1 : -1)
  for (let i = 0; i < ms(toneMs); i++)
    out[ms(leadMs) + i] = amp * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  return out
}
const durMs = (p: Float32Array): number => (p.length / SAMPLE_RATE) * 1000

describe('trimSilence', () => {
  it('trims 310 ms lead and 470 ms trail to about 70 ms each side', () => {
    const out = trimSilence(clip(310, 500, 470))
    expect(durMs(out)).toBeCloseTo(70 + 500 + 70, -1)
    expect(Math.abs(durMs(out) - 640)).toBeLessThan(1)
  })
  it('never removes a sample above the threshold', () => {
    const src = clip(310, 500, 470)
    const out = trimSilence(src)
    const loud = (p: Float32Array): number => p.filter((x) => Math.abs(x) >= 0.005).length
    expect(loud(out)).toBe(loud(src))
    // a very soft onset (2% of peak) right at the edge of the sound survives
    const soft = clip(310, 500, 470)
    soft[ms(310) - 1] = 0.011
    expect(trimSilence(soft).some((x) => x === Math.fround(0.011))).toBe(true)
  })
  it('scales the threshold to a quiet voice', () => {
    const out = trimSilence(clip(310, 500, 470, 0.02, 0.00005))
    expect(Math.abs(durMs(out) - 640)).toBeLessThan(1)
  })
  it('fades the cut edges to zero', () => {
    const out = trimSilence(clip(310, 500, 470, 0.5, 0.004))
    expect(Math.abs(out[0])).toBeLessThan(1e-9)
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01 / 100)
  })
  it('leaves a clip with less silence than the margin untouched', () => {
    const src = clip(20, 300, 30)
    expect(trimSilence(src)).toEqual(src)
  })
  it('keeps an all-silent clip valid and short', () => {
    const out = trimSilence(new Float32Array(ms(800)))
    expect(out.length).toBe(ms(70))
    expect(trimSilence(new Float32Array(0)).length).toBe(0)
    expect(trimSilence(new Float32Array(ms(30))).length).toBe(ms(30))
  })
  it('takes separate lead and trail margins', () => {
    const out = trimSilence(clip(310, 500, 470), { keepLeadMs: 35, keepTrailMs: 0 })
    expect(Math.abs(durMs(out) - 535)).toBeLessThan(1)
  })
})
