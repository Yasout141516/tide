import { describe, expect, it, vi } from 'vitest'
import { makeSpeak } from '../../src/main/speak'
import type { TtsHost } from '../../src/main/tts-host'

describe('makeSpeak', () => {
  it('live and export requests get the rules; preview requests do not', async () => {
    const synthesize = vi.fn<TtsHost['synthesize']>(() =>
      Promise.resolve({ pcm: new Float32Array(0), sampleRate: 24000, synthMs: 0, chunks: 1 })
    )
    const rules = [{ word: 'schema', sayAs: 'SKEE-muh' }]
    const speak = makeSpeak({ synthesize } as never, () => rules)
    const base = { voice: 'bf_emma', speed: 1 }
    await speak('The schema.', { ...base, priority: 'live' })
    await speak('The schema.', base)
    await speak('schema', { ...base, priority: 'preview' })
    expect(synthesize.mock.calls.map((c) => c[0])).toEqual([
      'The SKEE-muh.',
      'The SKEE-muh.',
      'schema'
    ])
  })
  it('reads the rules at each request', async () => {
    const synthesize = vi.fn<TtsHost['synthesize']>(() =>
      Promise.resolve({ pcm: new Float32Array(0), sampleRate: 24000, synthMs: 0, chunks: 1 })
    )
    let rules: { word: string; sayAs: string }[] = []
    const speak = makeSpeak({ synthesize } as never, () => rules)
    await speak('a', { voice: 'bf_emma', speed: 1 })
    rules = [{ word: 'a', sayAs: 'ay' }]
    await speak('a', { voice: 'bf_emma', speed: 1 })
    expect(synthesize.mock.calls.map((c) => c[0])).toEqual(['a', 'ay'])
  })
})
