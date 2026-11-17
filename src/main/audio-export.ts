// Whole-reading export: .m4b audiobook (AAC-LC 64 kbps mono, one chapter per page) and .mp3.
// Runs the bundled ffmpeg-static binary; PCM is streamed on stdin, never written to disk.
import { execFile, spawn } from 'child_process'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { unpackedPath } from './paths'

export interface Chapter {
  title: string
  startSec: number
}

export interface AudioMeta {
  title: string
  album: string
  artist: string
}

/** The ffmpeg binary. Packaged, ffmpeg-static resolves inside app.asar; the real file is unpacked. */
export function ffmpegPath(): string {
  if (!ffmpegStatic)
    throw new Error(`ffmpeg-static has no binary for ${process.platform}-${process.arch}`)
  return unpackedPath(ffmpegStatic)
}

let mp3Probe: Promise<boolean> | null = null

/** Whether this ffmpeg build can encode MP3 (libmp3lame). Probed once per process. */
export function ffmpegHasMp3(): Promise<boolean> {
  mp3Probe ??= new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-encoders'], { windowsHide: true }, (err, stdout) =>
      resolve(!err && stdout.includes('libmp3lame'))
    )
  })
  return mp3Probe
}

export function exportM4b(
  pcm: Float32Array,
  sampleRate: number,
  chapters: Chapter[],
  meta: AudioMeta,
  outPath: string,
  signal?: AbortSignal
): Promise<void> {
  const durationSec = pcm.length / sampleRate
  const list = chapters.length > 0 ? chapters : [{ title: meta.title, startSec: 0 }]
  return runFfmpeg(
    pcm,
    sampleRate,
    ffmetadata(meta, list, durationSec),
    ['-map_chapters', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'ipod'],
    outPath,
    signal
  )
}

export function exportMp3(
  pcm: Float32Array,
  sampleRate: number,
  meta: AudioMeta,
  outPath: string,
  signal?: AbortSignal
): Promise<void> {
  return runFfmpeg(
    pcm,
    sampleRate,
    ffmetadata(meta, [], pcm.length / sampleRate),
    ['-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3'],
    outPath,
    signal
  )
}

/** FFMETADATA1 values escape '=', ';', '#', '\' and newlines with a backslash. */
function escapeMeta(s: string): string {
  return s.replace(/[=;#\\\n]/g, (c) => '\\' + c)
}

/** An FFMETADATA1 file: global tags, then one [CHAPTER] per entry (ms timebase, END = next START). */
function ffmetadata(meta: AudioMeta, chapters: Chapter[], durationSec: number): string {
  const totalMs = Math.round(durationSec * 1000)
  const lines = [
    ';FFMETADATA1',
    `title=${escapeMeta(meta.title)}`,
    `album=${escapeMeta(meta.album)}`,
    `artist=${escapeMeta(meta.artist)}`
  ]
  chapters.forEach((c, i) => {
    const start = Math.min(Math.round(c.startSec * 1000), totalMs)
    const next = chapters[i + 1]
    const end = next ? Math.min(Math.round(next.startSec * 1000), totalMs) : totalMs
    lines.push('', '[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${end}`)
    lines.push(`title=${escapeMeta(c.title)}`)
  })
  return lines.join('\n') + '\n'
}

/** Float32 [-1, 1] → signed 16-bit little-endian (every supported target is little-endian). */
function toS16le(pcm: Float32Array): Buffer {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}

const abortError = (): Error => Object.assign(new Error('export aborted'), { name: 'AbortError' })

/**
 * Encode `pcm` to `<outPath>.part` with the given output options, then rename it to `outPath`.
 * Abort or any ffmpeg failure kills ffmpeg, deletes the .part and rejects.
 */
async function runFfmpeg(
  pcm: Float32Array,
  sampleRate: number,
  metadata: string,
  outputArgs: string[],
  outPath: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw abortError()
  const part = outPath + '.part'
  const dir = await mkdtemp(join(tmpdir(), 'tide-ffmeta-'))
  try {
    const metaFile = join(dir, 'meta.txt')
    await writeFile(metaFile, metadata, 'utf8')
    if (signal?.aborted) throw abortError()
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
      '-i', metaFile,
      '-map', '0:a',
      '-map_metadata', '1',
      ...outputArgs,
      part
    ] // prettier-ignore
    await encode(args, toS16le(pcm), signal)
    if (signal?.aborted) throw abortError()
    await rename(part, outPath)
  } catch (err) {
    await rm(part, { force: true })
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Spawn ffmpeg, stream `input` on stdin, resolve on exit code 0. Abort kills the process. */
function encode(args: string[], input: Buffer, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
    })
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // ffmpeg exiting early (error or kill) closes the pipe: EPIPE here is expected, the exit code tells.
    child.stdin.on('error', () => {})
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error(`ffmpeg failed to start: ${err.message}`))
    })
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(abortError())
      else if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code ?? sig}: ${stderr.trim()}`))
    })
    child.stdin.end(input)
  })
}
