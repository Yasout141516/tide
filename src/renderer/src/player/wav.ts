import { toS16 } from '../../../shared/pcm'

/** Wrap mono Float32 PCM as a 16-bit PCM WAV (44-byte header). */
export function pcmToWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const tag = (o: number, s: string): void => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  tag(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, dataBytes, true)
  toS16(pcm).forEach((s, i) => v.setInt16(44 + i * 2, s, true))
  return buf
}
