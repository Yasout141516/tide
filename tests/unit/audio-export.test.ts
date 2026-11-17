import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportM4b, exportMp3, ffmpegHasMp3, ffmpegPath } from '../../src/main/audio-export'

// Runs the real ffmpeg-static binary in plain Node.
const sine = (sec: number): Float32Array =>
  Float32Array.from({ length: 24000 * sec }, (_, i) => 0.2 * Math.sin(i / 10))
const meta = { title: 'Working Memory', album: 'PSYC 201 readings', artist: 'Tide' }
const hasMp3 = await ffmpegHasMp3()

/** The file's metadata (global tags and chapters) as ffmpeg reads it back. */
const readMeta = (file: string): string =>
  execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-f', 'ffmetadata', '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

describe('audio export (real ffmpeg)', () => {
  let dir: string
  let out: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tide-export-'))
    out = join(dir, 'reading.m4b')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes an m4b whose chapters ffmpeg reads back', async () => {
    await exportM4b(
      sine(6),
      24000,
      [
        { title: 'Page 1', startSec: 0 },
        { title: 'Page 2', startSec: 3 }
      ],
      meta,
      out
    )
    const meta2 = readMeta(out)
    expect(meta2.match(/\[CHAPTER\]/g)).toHaveLength(2)
    expect(meta2).toContain('title=Page 1')
    expect(meta2).toContain('title=Page 2')
    expect(meta2).toContain('title=Working Memory')
    expect(meta2).toContain('album=PSYC 201 readings')
    expect(existsSync(out + '.part')).toBe(false)
  })

  it('abort deletes the .part and rejects', async () => {
    const ac = new AbortController()
    const p = exportM4b(sine(30), 24000, [{ title: 'Page 1', startSec: 0 }], meta, out, ac.signal)
    setTimeout(() => ac.abort(), 20)
    await expect(p).rejects.toThrow(/abort/i)
    expect(existsSync(out)).toBe(false)
    expect(existsSync(out + '.part')).toBe(false)
  })

  it('an already-aborted signal rejects without writing anything', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(exportM4b(sine(1), 24000, [], meta, out, ac.signal)).rejects.toThrow(/abort/i)
    expect(existsSync(out)).toBe(false)
    expect(existsSync(out + '.part')).toBe(false)
  })

  it('an ffmpeg error deletes the .part and rejects', async () => {
    const bad = join(dir, 'no-such-dir', 'reading.m4b')
    await expect(exportM4b(sine(1), 24000, [], meta, bad)).rejects.toThrow(/ffmpeg/)
    expect(existsSync(bad + '.part')).toBe(false)
  })

  it.skipIf(!hasMp3)('exportMp3 works when libmp3lame is present', async () => {
    const mp3 = join(dir, 'reading.mp3')
    await exportMp3(sine(2), 24000, meta, mp3)
    expect(statSync(mp3).size).toBeGreaterThan(0)
    expect(readMeta(mp3)).toContain('title=Working Memory')
    expect(existsSync(mp3 + '.part')).toBe(false)
  })

  it('zero chapters becomes one chapter named after the title', async () => {
    await exportM4b(sine(2), 24000, [], meta, out)
    const meta2 = readMeta(out)
    expect(meta2.match(/\[CHAPTER\]/g)).toHaveLength(1)
    expect(meta2).toMatch(/\[CHAPTER\][^[]*title=Working Memory/)
  })
})
