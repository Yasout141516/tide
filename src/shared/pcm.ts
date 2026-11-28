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

/** Float32 [-1, 1] → signed 16-bit samples (clamped). */
export function toS16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Float32 [-1, 1] → signed 16-bit little-endian (every supported target is little-endian). */
export function toS16le(pcm: Float32Array): Buffer {
  const out = toS16(pcm)
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}

/** Silence kept on each side of a clip after trimming (ms): a natural, short sentence-end pause. */
export const TRIM_KEEP_MS = 70
/** A sample counts as sound from this fraction of the clip's own peak, so quiet voices are not over-trimmed. */
export const TRIM_REL_THRESHOLD = 0.01
/** The cut points fade over this long (ms) so a trim never clicks. */
const TRIM_FADE_MS = 5
/** Below this peak a clip is treated as silent (and an absolute floor for the threshold). */
const TRIM_PEAK_FLOOR = 1e-4

export interface TrimOptions {
  /** Silence kept before the first sound (ms, default 70). */
  keepLeadMs?: number
  /** Silence kept after the last sound (ms, default 70). */
  keepTrailMs?: number
}

/**
 * Cuts the leading and trailing silence of one clip down to `keepLeadMs` / `keepTrailMs`. Sound is
 * any sample of at least 1% of the clip's peak, so no sample above that is ever removed; less silence
 * than the margin is left as is. A cut edge fades over 5 ms. An all-silent clip shrinks to the lead margin.
 * Returns a view of the input (the input is only changed inside the fades, so it is copied then).
 */
export function trimSilence(pcm: Float32Array, opts: TrimOptions = {}): Float32Array {
  const lead = Math.round(((opts.keepLeadMs ?? TRIM_KEEP_MS) * SAMPLE_RATE) / 1000)
  const trail = Math.round(((opts.keepTrailMs ?? TRIM_KEEP_MS) * SAMPLE_RATE) / 1000)
  let peak = 0
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]))
  if (peak < TRIM_PEAK_FLOOR) return pcm.slice(0, Math.min(pcm.length, lead))
  const th = Math.max(peak * TRIM_REL_THRESHOLD, TRIM_PEAK_FLOOR)
  let first = 0
  while (Math.abs(pcm[first]) < th) first++
  let last = pcm.length - 1
  while (Math.abs(pcm[last]) < th) last--
  const from = Math.max(0, first - lead)
  const to = Math.min(pcm.length, last + 1 + trail)
  if (from === 0 && to === pcm.length) return pcm
  const out = pcm.slice(from, to)
  const fade = Math.min(
    Math.round((TRIM_FADE_MS * SAMPLE_RATE) / 1000),
    first - from,
    to - (last + 1)
  )
  // the fades sit inside the kept silence (below the threshold), never on a sound sample
  if (from > 0) for (let i = 0; i < fade; i++) out[i] *= i / fade
  if (to < pcm.length) for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
  return out
}
