import { describe, expect, it, vi } from 'vitest'
import { runExport } from '../../../src/main/export/job'
import type { AudioWriter } from '../../../src/main/export/writers'
import type { ExportSpec, TtsAudio } from '../../../src/shared/ipc-types'

const audio = (n: number): TtsAudio => ({
  pcm: new Float32Array(n),
  sampleRate: 24000,
  synthMs: 1,
  chunks: 1
})
const spec = (sentences: ExportSpec['sentences']): ExportSpec => ({
  readingId: 'r1',
  format: 'm4b',
  baseName: 'Notes',
  title: 'Notes',
  sentences,
  voice: 'bf_emma',
  speed: 1.25
})
const makeWriter = (): AudioWriter => ({
  write: vi.fn(() => Promise.resolve()),
  finish: vi.fn(() => Promise.resolve()),
  abort: vi.fn(() => Promise.resolve())
})

describe('runExport', () => {
  it('synthesises at export priority and makes one chapter per page with text', async () => {
    const writer = makeWriter()
    const synthesize = vi.fn(() => Promise.resolve(audio(24000)))
    const progress: [number, number][] = []
    await runExport(
      spec([
        { text: 'One.', page: 3 },
        { text: 'Two.', page: 3 },
        { text: '   ', page: 4 },
        { text: 'Three.', page: 5 }
      ]),
      { jobId: 'j1', synthesize, cancel: vi.fn(), writer },
      (d, t) => progress.push([d, t]),
      new AbortController().signal
    )
    expect(synthesize).toHaveBeenCalledTimes(3)
    expect(synthesize).toHaveBeenCalledWith('One.', {
      voice: 'bf_emma',
      speed: 1.25,
      priority: 'export',
      gen: 'export-j1'
    })
    expect(writer.write).toHaveBeenCalledTimes(3)
    expect(writer.finish).toHaveBeenCalledWith([
      { title: 'Page 3', startSec: 0 },
      { title: 'Page 5', startSec: 2 }
    ])
    expect(progress.at(-1)).toEqual([4, 4])
  })

  it('a sentence that fails twice is left out and the export carries on (RS-3)', async () => {
    const writer = makeWriter()
    const skipped: number[] = []
    const synthesize = vi.fn((text: string) =>
      text === 'Bad.' ? Promise.reject(new Error('timed out')) : Promise.resolve(audio(24000))
    )
    const n = await runExport(
      spec([
        { text: 'One.', page: 1 },
        { text: 'Bad.', page: 1 },
        { text: 'Three.', page: 2 }
      ]),
      { jobId: 'j1', synthesize, cancel: vi.fn(), writer, onSkip: (i) => skipped.push(i) },
      () => undefined,
      new AbortController().signal
    )
    expect(n).toBe(1)
    expect(skipped).toEqual([1])
    expect(synthesize.mock.calls.filter(([t]) => t === 'Bad.')).toHaveLength(2) // tried twice
    expect(writer.write).toHaveBeenCalledTimes(2)
    expect(writer.finish).toHaveBeenCalled()
    expect(writer.abort).not.toHaveBeenCalled()
  })

  it('a sentence that fails once and then works is kept', async () => {
    const writer = makeWriter()
    let calls = 0
    const synthesize = vi.fn(() =>
      ++calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve(audio(24000))
    )
    const n = await runExport(
      spec([{ text: 'One.', page: 1 }]),
      { jobId: 'j1', synthesize, cancel: vi.fn(), writer },
      () => undefined,
      new AbortController().signal
    )
    expect(n).toBe(0)
    expect(writer.write).toHaveBeenCalledTimes(1)
  })

  it('three sentences in a row failing is a broken voice: the export fails and the file is removed', async () => {
    const writer = makeWriter()
    const logged: number[] = []
    const synthesize = vi.fn(() => Promise.reject(new Error('voice engine stopped')))
    await expect(
      runExport(
        spec([
          { text: 'A.', page: 1 },
          { text: 'B.', page: 1 },
          { text: 'C.', page: 1 },
          { text: 'D.', page: 1 }
        ]),
        { jobId: 'j1', synthesize, cancel: vi.fn(), writer, onSkip: (i) => logged.push(i) },
        () => undefined,
        new AbortController().signal
      )
    ).rejects.toThrow('voice engine stopped')
    expect(logged).toEqual([0, 1, 2]) // every left-out sentence is reported
    expect(writer.abort).toHaveBeenCalled()
    expect(synthesize).toHaveBeenCalledTimes(6)
  })

  it('cancelling mid-export cancels the generation and aborts the writer', async () => {
    const writer = makeWriter()
    const ac = new AbortController()
    const cancel = vi.fn()
    const synthesize = vi.fn(
      () =>
        new Promise<TtsAudio>((_, reject) => {
          cancel.mockImplementation(() =>
            reject(Object.assign(new Error('synthesis cancelled'), { name: 'AbortError' }))
          )
        })
    )
    const p = runExport(
      spec([{ text: 'One.', page: 1 }]),
      { jobId: 'j2', synthesize, cancel, writer },
      () => {},
      ac.signal
    )
    await Promise.resolve()
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledWith('export-j2')
    expect(writer.abort).toHaveBeenCalled()
    expect(writer.finish).not.toHaveBeenCalled()
  })

  it('aborts the writer when synthesis fails', async () => {
    const writer = makeWriter()
    await expect(
      runExport(
        spec([{ text: 'One.', page: 1 }]),
        {
          jobId: 'j3',
          synthesize: () => Promise.reject(new Error('engine')),
          cancel: vi.fn(),
          writer
        },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow('engine')
    expect(writer.abort).toHaveBeenCalled()
  })
})
