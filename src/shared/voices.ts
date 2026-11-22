// The ten Kokoro voices Tide offers, plus the speed steps and the preview sentence.
export interface Voice {
  id: string
  name: string
  description: string
  /** Characters spoken per second at 1×, measured from the bundled preview (scripts/voice-previews.ts). */
  charsPerSec: number
}

export const VOICES: readonly Voice[] = [
  { id: 'af_kore', name: 'Kore', description: 'Clear, steady', charsPerSec: 14.0 },
  { id: 'af_nicole', name: 'Nicole', description: 'Soft, hushed', charsPerSec: 9.2 },
  { id: 'af_sarah', name: 'Sarah', description: 'Bright, friendly', charsPerSec: 12.8 },
  { id: 'am_fenrir', name: 'Fenrir', description: 'Deep, strong', charsPerSec: 14.5 },
  { id: 'am_michael', name: 'Michael', description: 'Deep, relaxed', charsPerSec: 12.2 },
  { id: 'am_puck', name: 'Puck', description: 'Lively, upbeat', charsPerSec: 14.6 },
  { id: 'bf_emma', name: 'Emma', description: 'Calm, British', charsPerSec: 13.7 },
  { id: 'bf_isabella', name: 'Isabella', description: 'Warm, British', charsPerSec: 13.5 },
  { id: 'bm_fable', name: 'Fable', description: 'Storyteller, British', charsPerSec: 13.2 },
  { id: 'bm_george', name: 'George', description: 'Steady, British', charsPerSec: 12.3 }
]

export const VOICE_IDS: ReadonlySet<string> = new Set(VOICES.map((v) => v.id))
export const DEFAULT_VOICE = 'bf_emma'
export const SPEEDS = [0.8, 1, 1.25, 1.5, 2] as const
/** Minutes she can ask a reading to finish within (Finish in…). */
export const FINISH_IN_CHOICES = [30, 45, 60, 90, 120] as const
export const isFinishInChoice = (n: number): boolean =>
  (FINISH_IN_CHOICES as readonly number[]).includes(n)
export const PREVIEW_SENTENCE = 'Hello! I can read your notes aloud, one calm sentence at a time.'

/** Display name for a voice id; an unknown id falls back to the default voice's name. */
export function voiceName(id: string): string {
  return (VOICES.find((v) => v.id === id) ?? VOICES.find((v) => v.id === DEFAULT_VOICE)!).name
}

export function speedLabel(s: number): string {
  return `${Number(s.toFixed(2))}×`
}

/** Characters per second at 1× for a voice id; an unknown id uses the default voice's rate. */
export function voiceRate(id: string): number {
  return (VOICES.find((v) => v.id === id) ?? VOICES.find((v) => v.id === DEFAULT_VOICE)!)
    .charsPerSec
}
