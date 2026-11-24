// Whole-reading export: .m4b audiobook (AAC-LC 64 kbps mono, one chapter per page) and .mp3.
// Runs the bundled ffmpeg-static binary; PCM is streamed on stdin. The streaming writers live in
// export/writers.ts; exportM4b and exportMp3 here are whole-buffer wrappers over them.
import { execFile } from 'child_process'
import { open } from 'fs/promises'
import ffmpegStatic from 'ffmpeg-static'
import { concatPcm, SAMPLE_RATE } from '../shared/pcm'
import { createM4bWriter, createMp3Writer, type AudioWriter } from './export/writers'
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

/**
 * Joins per-page audio (at SAMPLE_RATE) into one buffer with one chapter per page, titled by
 * `titles[i]` and starting where page i's audio starts.
 */
export function assembleChapters(
  audios: { pcm: Float32Array }[],
  titles: string[]
): { pcm: Float32Array; chapters: Chapter[] } {
  const chapters: Chapter[] = []
  let offset = 0
  audios.forEach((a, i) => {
    chapters.push({ title: titles[i], startSec: offset / SAMPLE_RATE })
    offset += a.pcm.length
  })
  return { pcm: concatPcm(audios.map((a) => a.pcm)), chapters }
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

/** Feed one whole buffer through a streaming writer; any failure aborts it (deleting its files). */
async function writeWhole(
  writer: AudioWriter,
  pcm: Float32Array,
  sampleRate: number,
  chapters: Chapter[]
): Promise<void> {
  try {
    if (sampleRate !== SAMPLE_RATE) throw new Error(`export expects ${SAMPLE_RATE} Hz audio`)
    await writer.write(pcm)
    await writer.finish(chapters)
  } catch (err) {
    await writer.abort()
    throw err
  }
}

export async function exportM4b(
  pcm: Float32Array,
  sampleRate: number,
  chapters: Chapter[],
  meta: AudioMeta,
  outPath: string,
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  if (signal.aborted) throw abortError()
  await writeWhole(createM4bWriter(outPath, meta, signal), pcm, sampleRate, chapters)
}

export async function exportMp3(
  pcm: Float32Array,
  sampleRate: number,
  meta: AudioMeta,
  outPath: string,
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  if (signal.aborted) throw abortError()
  await writeWhole(createMp3Writer(outPath, meta, signal), pcm, sampleRate, [])
}

/** FFMETADATA1 values escape '=', ';', '#', '\' and newlines with a backslash. */
function escapeMeta(s: string): string {
  return s.replace(/[=;#\\\n]/g, (c) => '\\' + c)
}

/** An FFMETADATA1 file: global tags, then one [CHAPTER] per entry (ms timebase, END = next START). */
export function ffmetadata(meta: AudioMeta, chapters: Chapter[], durationSec: number): string {
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

export const abortError = (): Error =>
  Object.assign(new Error('export aborted'), { name: 'AbortError' })

/**
 * Decodes the MP4 box header at `buf[at]`: type, total size and header length. A size of 1 means a
 * 64-bit size follows the type; 0 means the box runs to the end of its container, `remaining` bytes
 * from `at`.
 */
function boxHeader(
  buf: Buffer,
  at: number,
  remaining: number
): { type: string; size: number; header: number } {
  let size = buf.readUInt32BE(at)
  let header = 8
  if (size === 1) {
    size = Number(buf.readBigUInt64BE(at + 8))
    header = 16
  } else if (size === 0) size = remaining
  if (size < header) throw new Error('malformed mp4 box')
  return { type: buf.toString('latin1', at + 4, at + 8), size, header }
}

/** Iterate the MP4 boxes in `buf[start, end)`: type plus the body's [start, end). */
function* boxes(buf: Buffer, start: number, end: number): Generator<[string, number, number]> {
  let pos = start
  while (pos + 8 <= end) {
    const { type, size, header } = boxHeader(buf, pos, end - pos)
    if (pos + size > end) throw new Error('malformed mp4 box')
    yield [type, pos + header, pos + size]
    pos += size
  }
}

const findBox = (
  buf: Buffer,
  start: number,
  end: number,
  type: string
): [number, number] | null => {
  for (const [t, s, e] of boxes(buf, start, end)) if (t === type) return [s, e]
  return null
}

/**
 * ffmpeg writes the chapter (text) track with language code 0, which Apple reads as "und", so
 * AVFoundation lookups by preferred language (what Apple Books does) find no chapters (spike M0d).
 * Rewrite that track's mdhd language in place. Returns how many tracks were patched.
 */
export async function setChapterTrackLanguage(file: string, lang: string): Promise<number> {
  if (!/^[a-z]{3}$/.test(lang)) throw new Error(`not an ISO-639-2 code: ${lang}`)
  const packed = [...lang].reduce((v, c) => (v << 5) | (c.charCodeAt(0) - 0x60), 0)
  const fh = await open(file, 'r+')
  try {
    // Find moov among the top-level boxes by reading headers only (mdat can be large).
    const fileSize = (await fh.stat()).size
    const head = Buffer.alloc(16)
    let pos = 0
    let moov: { at: number; body: Buffer } | null = null
    while (pos + 8 <= fileSize) {
      await fh.read(head, 0, 16, pos)
      const { type, size, header } = boxHeader(head, 0, fileSize - pos)
      if (type === 'moov') {
        const body = Buffer.alloc(size - header)
        await fh.read(body, 0, body.length, pos + header)
        moov = { at: pos + header, body }
        break
      }
      pos += size
    }
    if (!moov) throw new Error('no moov box in exported file')

    const { at, body } = moov
    let patched = 0
    for (const [type, s, e] of boxes(body, 0, body.length)) {
      if (type !== 'trak') continue
      const mdia = findBox(body, s, e, 'mdia')
      const hdlr = mdia && findBox(body, mdia[0], mdia[1], 'hdlr')
      const mdhd = mdia && findBox(body, mdia[0], mdia[1], 'mdhd')
      if (!hdlr || !mdhd || body.toString('latin1', hdlr[0] + 8, hdlr[0] + 12) !== 'text') continue
      // mdhd: version/flags, then 32-bit (v0) or 64-bit (v1) times, timescale, duration, language.
      const langAt = mdhd[0] + (body[mdhd[0]] === 1 ? 32 : 20)
      const b = Buffer.alloc(2)
      b.writeUInt16BE(packed)
      await fh.write(b, 0, 2, at + langAt)
      patched++
    }
    return patched
  } finally {
    await fh.close()
  }
}
