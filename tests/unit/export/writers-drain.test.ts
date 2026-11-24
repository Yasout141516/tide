import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A fake ffmpeg whose stdin is always full, so every write waits for 'drain'.
class FakeChild extends EventEmitter {
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  stdin = Object.assign(new EventEmitter(), {
    write: () => false,
    end: () => {}
  })
  kill(): boolean {
    this.emit('close', null, 'SIGKILL')
    return true
  }
}
let child: FakeChild
vi.mock('child_process', () => ({
  spawn: () => {
    child = new FakeChild()
    return child
  }
}))

const { createMp3Writer } = await import('../../../src/main/export/writers')
const pcm = new Float32Array(10)
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('FfmpegRun write backpressure', () => {
  const realThen = Promise.prototype.then
  afterEach(() => {
    Promise.prototype.then = realThen
  })

  it('does not pile up a handler per drain wait', async () => {
    const w = createMp3Writer(
      'out.mp3',
      { title: 'T', album: 'A', artist: 'B' },
      new AbortController().signal
    )
    let thens = 0
    Promise.prototype.then = function (this: Promise<unknown>, ...a: never[]) {
      thens += 1
      return realThen.apply(this, a)
    } as typeof Promise.prototype.then
    const cycles = 200
    for (let i = 0; i < cycles; i++) {
      const p = w.write(pcm)
      await tick()
      child.stdin.emit('drain')
      await p
    }
    Promise.prototype.then = realThen
    expect(thens).toBeLessThan(cycles / 2)
    expect(child.stdin.listenerCount('drain')).toBe(0)
    expect(child.listenerCount('close')).toBe(1) // only the run's own
  })

  it('still rejects a write that is waiting when ffmpeg dies', async () => {
    const w = createMp3Writer(
      'out2.mp3',
      { title: 'T', album: 'A', artist: 'B' },
      new AbortController().signal
    )
    const p = w.write(pcm)
    p.catch(() => {})
    await tick()
    child.stderr.emit('data', 'no space left on device')
    child.emit('close', 1, null)
    await expect(p).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(child.stdin.listenerCount('drain')).toBe(0)
  })
})
