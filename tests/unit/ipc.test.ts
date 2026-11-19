import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { TtsHost as RealTtsHost, type TtsHost } from '../../src/main/tts-host'

// Capture the handlers registerIpc gives ipcMain.handle; no Electron runs.
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  }
}))

const { registerIpc } = await import('../../src/main/ipc')

describe('tts:synthesize', () => {
  const synthesize = vi.fn(() => Promise.resolve('audio'))
  registerIpc({ synthesize } as unknown as TtsHost, { e2e: false })
  const call = (text: unknown, o: unknown): unknown => handlers.get('tts:synthesize')!({}, text, o)

  it('passes a valid request on to the host', async () => {
    for (const speed of [0.5, 0.8, 1, 2]) {
      expect(await call('Hello there.', { voice: 'bf_emma', speed })).toBe('audio')
      expect(synthesize).toHaveBeenLastCalledWith('Hello there.', { voice: 'bf_emma', speed })
    }
  })

  it('rejects a speed that is not a finite number from 0.5 to 2', () => {
    synthesize.mockClear()
    for (const speed of [NaN, Infinity, -Infinity, 0, -1, 0.49, 2.01, '1', undefined])
      expect(() => call('Hello there.', { voice: 'bf_emma', speed }), `speed ${speed}`).toThrow(
        /speed: a number from 0\.5 to 2/
      )
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('passes priority and gen on, with defaults when absent', async () => {
    await call('Hi.', { voice: 'bf_emma', speed: 1, priority: 'preview', gen: 'g1' })
    expect(synthesize).toHaveBeenLastCalledWith('Hi.', {
      voice: 'bf_emma',
      speed: 1,
      priority: 'preview',
      gen: 'g1'
    })
  })

  it('rejects a voice outside VOICES', () => {
    synthesize.mockClear()
    for (const voice of ['af_heart', 'x', '../etc'])
      expect(() => call('Hi.', { voice, speed: 1 }), voice).toThrow(/tts:synthesize expects/)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('rejects export priority and bad gen from the renderer', () => {
    synthesize.mockClear()
    expect(() => call('Hi.', { voice: 'bf_emma', speed: 1, priority: 'export' })).toThrow()
    expect(() => call('Hi.', { voice: 'bf_emma', speed: 1, priority: 'x' })).toThrow()
    expect(() => call('Hi.', { voice: 'bf_emma', speed: 1, gen: 'a'.repeat(65) })).toThrow()
    expect(() => call('Hi.', { voice: 'bf_emma', speed: 1, gen: 5 })).toThrow()
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('tts:cancel forwards a valid gen to the host', () => {
    const cancel = vi.fn()
    handlers.clear()
    registerIpc({ synthesize, cancel } as unknown as TtsHost, { e2e: false })
    handlers.get('tts:cancel')!({}, 'g1')
    expect(cancel).toHaveBeenCalledWith('g1')
    expect(() => handlers.get('tts:cancel')!({}, 5)).toThrow()
    expect(() => handlers.get('tts:cancel')!({}, 'a'.repeat(65))).toThrow()
  })

  it('rejects a missing text or voice', () => {
    expect(() => call(42, { voice: 'bf_emma', speed: 1 })).toThrow(/tts:synthesize expects/)
    expect(() => call('Hi.', { speed: 1 })).toThrow(/tts:synthesize expects/)
    expect(() => call('Hi.', null)).toThrow(/tts:synthesize expects/)
  })
})

describe('tts status forwarding', () => {
  function setup(): {
    emit: (s: string) => void
    send: ReturnType<typeof vi.fn>
  } {
    handlers.clear()
    let cb: (s: string) => void = () => {}
    const send = vi.fn()
    const host = {
      onStatus: (fn: (s: string) => void) => {
        cb = fn
        return () => {}
      },
      status: () => 'ready'
    } as unknown as TtsHost
    const win = { isDestroyed: () => false, webContents: { send } }
    registerIpc(host, { e2e: false, window: () => win as never })
    return { emit: (s) => cb(s), send }
  }

  it('tts status changes are forwarded to the window on tts:status', () => {
    const { emit, send } = setup()
    emit('loading')
    emit('ready')
    expect(send.mock.calls).toEqual([
      ['tts:status', 'loading'],
      ['tts:status', 'ready']
    ])
    expect(handlers.get('tts:status')!({})).toBe('ready')
  })

  it('tts status is sent to the window before a pending synthesize rejects on a crash', async () => {
    handlers.clear()
    const sent: string[] = []
    const child = Object.assign(new EventEmitter(), {
      postMessage: (msg: { id: number; type: string }) => {
        sent.push(msg.type)
        if (msg.type === 'load')
          queueMicrotask(() =>
            child.emit('message', { id: msg.id, type: 'loaded', loadMs: 1, warmMs: 1 })
          )
      },
      kill: () => true
    })
    const host = new RealTtsHost({
      workerPath: 'w.js',
      modelDir: '/m',
      fork: () => child as never
    })
    const order: string[] = []
    const send = vi.fn((_c: string, s: string) => order.push(`status:${s}`))
    const win = { isDestroyed: () => false, webContents: { send } }
    registerIpc(host, { e2e: false, window: () => win as never })
    await host.start()
    order.length = 0
    const pending = host
      .synthesize('Hi.', { voice: 'bf_emma', speed: 1 })
      .catch(() => order.push('rejected'))
    await vi.waitFor(() => expect(sent).toContain('synthesize'))
    child.emit('exit', 1)
    await pending
    expect(order[0]).toBe('status:restarting')
    expect(order.indexOf('rejected')).toBeGreaterThan(0)
    host.dispose()
  })
})
