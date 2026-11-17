import { describe, expect, it, vi } from 'vitest'
import { createQuitHandler, openLibraryOrReport } from '../../src/main/startup'

describe('openLibraryOrReport', () => {
  it('returns the library when it opens', async () => {
    const lib = {}
    const report = vi.fn()
    expect(await openLibraryOrReport(async () => lib, report)).toBe(lib)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports a plain message and returns null when the store cannot open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = vi.fn()
    const r = await openLibraryOrReport(
      async () => Promise.reject(new Error('EPERM C:/secret/library.json')),
      report
    )
    expect(r).toBeNull()
    expect(report).toHaveBeenCalledTimes(1)
    const [title, body] = report.mock.calls[0]
    expect(title).toMatch(/shelf/i)
    expect(`${title} ${body}`).not.toMatch(/secret|EPERM/)
  })
})

describe('createQuitHandler', () => {
  const ev = (): { preventDefault: () => void } => ({ preventDefault: vi.fn() })

  it('lets the quit through when no library is loaded (second instance)', () => {
    const quit = vi.fn()
    const handler = createQuitHandler({ getLibrary: () => null, quit, timeoutMs: 50 })
    const e = ev()
    handler(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('holds the quit until the flush finishes, then quits once', async () => {
    const quit = vi.fn()
    let done!: (v: boolean) => void
    const flush = vi.fn(() => new Promise<boolean>((r) => (done = r)))
    const handler = createQuitHandler({ getLibrary: () => ({ flush }), quit, timeoutMs: 1000 })
    const e1 = ev()
    handler(e1)
    handler(ev()) // a second before-quit while flushing
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(1)
    done(true)
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    const e3 = ev()
    handler(e3) // the quit it triggered
    expect(e3.preventDefault).not.toHaveBeenCalled()
  })

  it('quits anyway when the flush hangs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const quit = vi.fn()
    const handler = createQuitHandler({
      getLibrary: () => ({ flush: () => new Promise<boolean>(() => {}) }),
      quit,
      timeoutMs: 20
    })
    handler(ev())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })
})
