// Raw mono PCM helpers shared by the TTS worker, the main process and the scripts.

/** Kokoro's output rate: every PCM buffer in Tide is 24 kHz mono. */
export const SAMPLE_RATE = 24000

/** Joins PCM parts end to end. A single part is returned as is (no copy). */
export function concatPcm(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** Float32 [-1, 1] → signed 16-bit little-endian (every supported target is little-endian). */
export function toS16le(pcm: Float32Array): Buffer {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}
