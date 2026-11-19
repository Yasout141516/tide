// The ten Kokoro voices Tide offers, plus the speed steps and the preview sentence.
export interface Voice {
  id: string
  name: string
  description: string
}

export const VOICES: readonly Voice[] = [
  { id: 'af_kore', name: 'Kore', description: 'Clear, steady' },
  { id: 'af_nicole', name: 'Nicole', description: 'Soft, hushed' },
  { id: 'af_sarah', name: 'Sarah', description: 'Bright, friendly' },
  { id: 'am_fenrir', name: 'Fenrir', description: 'Deep, strong' },
  { id: 'am_michael', name: 'Michael', description: 'Deep, relaxed' },
  { id: 'am_puck', name: 'Puck', description: 'Lively, upbeat' },
  { id: 'bf_emma', name: 'Emma', description: 'Calm, British' },
  { id: 'bf_isabella', name: 'Isabella', description: 'Warm, British' },
  { id: 'bm_fable', name: 'Fable', description: 'Storyteller, British' },
  { id: 'bm_george', name: 'George', description: 'Steady, British' }
]

export const VOICE_IDS: ReadonlySet<string> = new Set(VOICES.map((v) => v.id))
export const DEFAULT_VOICE = 'bf_emma'
export const SPEEDS = [0.8, 1, 1.25, 1.5, 2] as const
export const PREVIEW_SENTENCE = 'Hello! I can read your notes aloud, one calm sentence at a time.'

/** Display name for a voice id; an unknown id falls back to the default voice's name. */
export function voiceName(id: string): string {
  return (VOICES.find((v) => v.id === id) ?? VOICES.find((v) => v.id === DEFAULT_VOICE)!).name
}

export function speedLabel(s: number): string {
  return `${s}×`
}
