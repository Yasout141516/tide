import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSentencesInWorker } from '../../../src/renderer/src/reader/pipeline-client'
import type { PageText } from '../../../src/shared/text/types'
import { DEFAULT_FILTERS } from '../../../src/shared/text/types'

class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  terminated = false
  posted: Array<{ id: number }> = []
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(m: { id: number }): void {
    this.posted.push(m)
  }
  terminate(): void {
    this.terminated = true
  }
}

const pages: PageText[] = []
const result = { sentences: [], textlessPages: [], skippedPages: [] }

afterEach(() => {
  FakeWorker.all = []
  vi.unstubAllGlobals()
})

describe('buildSentencesInWorker', () => {
  it('ignores a reply with another request id, then resolves and terminates on its own', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const p = buildSentencesInWorker(pages, DEFAULT_FILTERS)
    const w = FakeWorker.all[0]
    const id = w.posted[0].id
    let settled = false
    void p.then(() => (settled = true))
    w.onmessage?.({ data: { id: id + 100, ok: true, result: { stale: true } } })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(w.terminated).toBe(false)
    w.onmessage?.({ data: { id, ok: true, result } })
    await expect(p).resolves.toBe(result)
    expect(w.terminated).toBe(true)
  })

  it('uses one worker per call', () => {
    vi.stubGlobal('Worker', FakeWorker)
    void buildSentencesInWorker(pages, DEFAULT_FILTERS)
    void buildSentencesInWorker(pages, DEFAULT_FILTERS)
    expect(FakeWorker.all).toHaveLength(2)
    expect(FakeWorker.all[0].posted[0].id).not.toBe(FakeWorker.all[1].posted[0].id)
  })

  it('rejects and terminates when the worker reports an error or fails', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const a = buildSentencesInWorker(pages, DEFAULT_FILTERS)
    const wa = FakeWorker.all[0]
    wa.onmessage?.({ data: { id: wa.posted[0].id, ok: false, error: 'boom' } })
    await expect(a).rejects.toThrow('boom')
    expect(wa.terminated).toBe(true)

    const b = buildSentencesInWorker(pages, DEFAULT_FILTERS)
    const wb = FakeWorker.all[1]
    wb.onerror?.({ message: 'crashed' })
    await expect(b).rejects.toThrow('crashed')
    expect(wb.terminated).toBe(true)
  })

  it('aborting the signal terminates the superseded worker and rejects the call', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const ctl = new AbortController()
    const p = buildSentencesInWorker(pages, DEFAULT_FILTERS, ctl.signal)
    const w = FakeWorker.all[0]
    expect(w.terminated).toBe(false)
    ctl.abort()
    expect(w.terminated).toBe(true)
    await expect(p).rejects.toThrow(/abort/i)
  })

  it('an already aborted signal never starts a worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const ctl = new AbortController()
    ctl.abort()
    await expect(buildSentencesInWorker(pages, DEFAULT_FILTERS, ctl.signal)).rejects.toThrow(
      /abort/i
    )
    expect(FakeWorker.all).toHaveLength(0)
  })
})
