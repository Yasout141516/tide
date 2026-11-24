import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ffmpegHasMp3 } from '../../../src/main/audio-export'
import { ffmpegPath } from '../../../src/main/export/ffmpeg'
import { createM4bWriter, createMp3Writer } from '../../../src/main/export/writers'

const sine = (sec: number): Float32Array =>
  Float32Array.from({ length: Math.round(24000 * sec) }, (_, i) => 0.2 * Math.sin(i / 10))
const meta = { title: 'Notes p. 1-3', album: 'Tide', artist: 'Tide - Emma' }
const hasMp3 = await ffmpegHasMp3()

/** ffmpeg -i prints the streams and chapters (and exits 1 for want of an output). */
const probe = (file: string): string =>
  spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr
const durationSec = (text: string): number => {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text)!
  return +m[1] * 3600 + +m[2] * 60 + +m[3]
}
// The M4B writer's pass-1 temp lives in os.tmpdir(): point that at a private folder per test so
// other test files running in parallel cannot disturb the check.
const TMP_VARS = ['TMPDIR', 'TMP', 'TEMP'] as const

describe('export writers (real ffmpeg)', () => {
  let dir: string
  let tmpRoot: string
  const saved: Record<string, string | undefined> = {}
  const tideTemps = (): string[] => readdirSync(tmpRoot)
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'tide-writer-tmp-'))
    for (const v of TMP_VARS) {
      saved[v] = process.env[v]
      process.env[v] = tmpRoot
    }
    dir = mkdtempSync(join(tmpRoot, 'out-'))
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => {
    for (const v of TMP_VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it.skipIf(!hasMp3)('the MP3 writer streams PCM and leaves only the final file', async () => {
    const out = join(dir, 'a.mp3')
    const w = createMp3Writer(out, meta, new AbortController().signal)
    for (let i = 0; i < 3; i++) await w.write(sine(1))
    await w.finish([])
    expect(readdirSync(dir)).toEqual(['a.mp3'])
    const text = probe(out)
    expect(durationSec(text)).toBeGreaterThan(2.5)
    expect(text).toContain('Notes p. 1-3')
    expect(text).toContain('Tide - Emma')
  })

  it('the M4B writer remuxes chapters and leaves no temp or part file', async () => {
    const before = tideTemps()
    const out = join(dir, 'a.m4b')
    const w = createM4bWriter(out, meta, new AbortController().signal)
    for (let i = 0; i < 3; i++) await w.write(sine(1))
    await w.finish([
      { title: 'Page 1', startSec: 0 },
      { title: 'Page 2', startSec: 1 },
      { title: 'Page 3', startSec: 2 }
    ])
    expect(readdirSync(dir)).toEqual(['a.m4b'])
    expect(tideTemps()).toEqual(before)
    const text = probe(out)
    expect(text).toContain('Chapter #0:2')
    expect(durationSec(text)).toBeGreaterThan(2.5)
    expect(statSync(out).size).toBeGreaterThan(0)
  })

  it('an aborted writer deletes its part file', async () => {
    const before = tideTemps()
    const makers = [createM4bWriter, ...(hasMp3 ? [createMp3Writer] : [])]
    for (const make of makers) {
      const ac = new AbortController()
      const w = make(join(dir, 'b.out'), meta, ac.signal)
      await w.write(sine(1))
      ac.abort()
      await expect(w.write(sine(1))).rejects.toMatchObject({ name: 'AbortError' })
      await w.abort()
      expect(readdirSync(dir)).toEqual([])
    }
    expect(tideTemps()).toEqual(before)
  })

  it.skipIf(!hasMp3)('abort() on its own removes the part file', async () => {
    const w = createMp3Writer(join(dir, 'c.mp3'), meta, new AbortController().signal)
    await w.write(sine(1))
    await w.abort()
    expect(readdirSync(dir)).toEqual([])
  })

  it.skipIf(!hasMp3)('a missing folder rejects with ENOENT and leaves nothing', async () => {
    const w = createMp3Writer(join(dir, 'nope', 'x.mp3'), meta, new AbortController().signal)
    await expect(
      (async () => {
        await w.write(sine(1))
        await w.finish([])
      })()
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await w.abort()
    expect(readdirSync(dir)).toEqual([])
  })
})
