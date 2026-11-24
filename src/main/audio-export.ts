// Whole-reading export helpers: per-page chapter assembly and the MP3 capability probe. The ffmpeg
// pieces live in export/ffmpeg.ts and the streaming writers in export/writers.ts.
import { execFile } from 'child_process'
import { concatPcm, SAMPLE_RATE } from '../shared/pcm'
import { ffmpegPath, type Chapter } from './export/ffmpeg'

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
