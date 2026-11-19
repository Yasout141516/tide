import { describe, expect, it } from 'vitest'
import { pcmToWav } from '../../../src/renderer/src/player/wav'

describe('wav', () => {
  it('pcmToWav writes a valid RIFF header and clamps samples', () => {
    const buf = pcmToWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 24000)
    const v = new DataView(buf)
    const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(buf.byteLength).toBe(44 + 12)
    expect(tag(0)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(36 + 12)
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(24000)
    expect(v.getUint32(28, true)).toBe(48000)
    expect(v.getUint16(32, true)).toBe(2)
    expect(v.getUint16(34, true)).toBe(16)
    expect(tag(36)).toBe('data')
    expect(v.getUint32(40, true)).toBe(12)
    const s = (i: number): number => v.getInt16(44 + i * 2, true)
    expect([s(0), s(1), s(2), s(3), s(4), s(5)]).toEqual([0, 32767, -32768, 32767, -32768, 16383])
  })
})
