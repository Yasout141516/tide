import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An abort that lands just as the final rename starts (hook set per test).
let atRename: (() => void) | null = null
vi.mock('fs/promises', async (orig) => {
  const real = await orig<typeof import('fs/promises')>()
  return {
    ...real,
    rename: (a: string, b: string) => {
      atRename?.()
      return real.rename(a, b)
    }
  }
})

const { ffmpegHasMp3 } = await import('../../../src/main/audio-export')
const { createM4bWriter, createMp3Writer } = await import('../../../src/main/export/writers')
const hasMp3 = await ffmpegHasMp3()
const sine = Float32Array.from({ length: 24000 }, (_, i) => 0.2 * Math.sin(i / 10))
const meta = { title: 'T', album: 'A', artist: 'B' }

describe('an abort that lands during the final rename', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tide-race-'))
  })
  afterEach(() => {
    atRename = null
    rmSync(dir, { recursive: true, force: true })
  })

  for (const [name, make] of [
    ['m4b', createM4bWriter],
    ['mp3', createMp3Writer]
  ] as const) {
    it.skipIf(name === 'mp3' && !hasMp3)(`leaves no ${name} output file`, async () => {
      const ac = new AbortController()
      const w = make(join(dir, `a.${name}`), meta, ac.signal)
      await w.write(sine)
      atRename = () => ac.abort()
      await expect(w.finish([])).rejects.toMatchObject({ name: 'AbortError' })
      await w.abort()
      expect(readdirSync(dir)).toEqual([])
    })
  }
})
