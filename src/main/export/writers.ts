// Streaming audio writers for "Save as audio": PCM goes to ffmpeg's stdin as it is synthesised, so a
// long reading never sits in memory. Both write to `<out>.part` and rename on success; abort or any
// failure removes every file the writer made.
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SAMPLE_RATE, toS16le } from '../../shared/pcm'
import { makeAbortError } from '../../shared/abort'
import {
  ffmetadata,
  ffmpegBaseArgs,
  ffmpegPath,
  pcmInputArgs,
  setChapterTrackLanguage,
  type AudioMeta,
  type Chapter
} from './ffmpeg'

export interface AudioWriter {
  /** Append PCM (24 kHz mono). Resolves once ffmpeg has taken it (backpressure). */
  write(pcm: Float32Array): Promise<void>
  /** Close the stream and put the finished file at its final path. */
  finish(chapters: Chapter[]): Promise<void>
  /** Stop ffmpeg and delete the part and temp files. Safe to call more than once. */
  abort(): Promise<void>
}

/** An ffmpeg failure, with the errno its stderr implies so `failureReason` can classify it. */
function ffmpegError(code: number | string | null, stderr: string): Error {
  const err: Error & { code?: string } = new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)
  if (/no space left on device/i.test(stderr)) err.code = 'ENOSPC'
  else if (/permission denied|read-only file system/i.test(stderr)) err.code = 'EACCES'
  else if (/no such file or directory/i.test(stderr)) err.code = 'ENOENT'
  return err
}

/** One ffmpeg run. `closed` settles when it exits: resolved on code 0, else rejected. */
class FfmpegRun {
  readonly closed: Promise<void>
  private readonly child: ChildProcess
  private exited = false

  constructor(args: string[], stdin: boolean) {
    this.child = spawn(ffmpegPath(), [...ffmpegBaseArgs, ...args], {
      stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    this.child.stderr!.setEncoding('utf8')
    this.child.stderr!.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
    })
    // ffmpeg exiting early closes the pipe: EPIPE here is expected, the exit code tells.
    this.child.stdin?.on('error', () => {})
    this.closed = new Promise<void>((resolve, reject) => {
      this.child.on('error', (err) => {
        this.exited = true
        reject(new Error(`ffmpeg failed to start: ${err.message}`))
      })
      this.child.on('close', (code, sig) => {
        this.exited = true
        if (code === 0) resolve()
        else reject(ffmpegError(code ?? sig, stderr))
      })
    })
    this.closed.catch(() => {}) // the owner awaits it; never an unhandled rejection
  }

  /** Write to stdin, waiting for 'drain' when its buffer is full. Rejects if ffmpeg dies meanwhile. */
  async write(buf: Buffer): Promise<void> {
    const stdin = this.child.stdin!
    if (stdin.write(buf)) return
    if (this.exited) return this.closed
    // One pair of listeners per wait, each removed when either fires (none pile up over a long export).
    await new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        stdin.off('drain', onDrain)
        this.child.off('close', onExit)
        this.child.off('error', onExit)
      }
      const onDrain = (): void => {
        stop()
        resolve()
      }
      const onExit = (): void => {
        stop()
        this.closed.then(resolve, reject) // ffmpeg died while waiting: its error, or fine on code 0
      }
      stdin.once('drain', onDrain)
      this.child.once('close', onExit)
      this.child.once('error', onExit)
    })
  }

  end(): void {
    this.child.stdin?.end()
  }

  kill(): void {
    this.child.kill('SIGKILL')
  }
}

/**
 * Shared lifecycle: abort (by signal or call) kills the current ffmpeg and runs `cleanup`; after an
 * abort every call rejects with an AbortError.
 */
function lifecycle(
  signal: AbortSignal,
  current: () => FfmpegRun | null,
  cleanup: () => Promise<void>
): {
  aborted: () => boolean
  abort: () => Promise<void>
  guard: <T>(fn: () => Promise<T>) => Promise<T>
} {
  let aborted = signal.aborted
  let aborting: Promise<void> | null = null
  const abort = (): Promise<void> => {
    aborted = true
    aborting ??= (async () => {
      const run = current()
      run?.kill()
      await run?.closed.catch(() => {})
      await cleanup()
    })()
    return aborting
  }
  if (aborted) void abort()
  else signal.addEventListener('abort', () => void abort(), { once: true })
  return {
    aborted: () => aborted,
    abort,
    // A failure after abort is the kill, not a real error. A real failure cleans up before it rejects.
    async guard(fn) {
      if (aborted) throw abortError()
      try {
        return await fn()
      } catch (err) {
        if (aborted) throw abortError()
        await abort()
        throw err
      }
    }
  }
}

/**
 * Rename the finished part into place. An abort that lands during the rename must leave nothing
 * behind: abort() only removes the part, so remove the output here and report the abort.
 */
async function publish(part: string, outPath: string, aborted: () => boolean): Promise<void> {
  await rename(part, outPath)
  if (aborted()) {
    await rm(outPath, { force: true })
    throw abortError()
  }
}

const abortError = (): Error => makeAbortError('export aborted')

const pcmInput = pcmInputArgs()

export function createMp3Writer(
  outPath: string,
  meta: AudioMeta,
  signal: AbortSignal
): AudioWriter {
  const part = outPath + '.part'
  const run = new FfmpegRun(
    [
      ...pcmInput,
      '-metadata', `title=${meta.title}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `artist=${meta.artist}`,
      '-id3v2_version', '3',
      '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3',
      part
    ],
    true
  ) // prettier-ignore
  const life = lifecycle(
    signal,
    () => run,
    () => rm(part, { force: true })
  )
  return {
    write: (pcm) => life.guard(() => run.write(toS16le(pcm))),
    finish: () =>
      life.guard(async () => {
        run.end()
        await run.closed
        if (life.aborted()) throw abortError()
        await publish(part, outPath, life.aborted)
      }),
    abort: life.abort
  }
}

export function createM4bWriter(
  outPath: string,
  meta: AudioMeta,
  signal: AbortSignal
): AudioWriter {
  const part = outPath + '.part'
  // The temp folder is made without blocking the event loop; pass 1 starts on the first write or finish.
  const dirReady = mkdtemp(join(tmpdir(), 'tide-m4b-'))
  dirReady.catch(() => {}) // a failure surfaces from the first write; never an unhandled rejection
  let run: FfmpegRun | null = null
  let pass1 = ''
  let samples = 0
  const life = lifecycle(
    signal,
    () => run,
    async () => {
      await rm(part, { force: true })
      const dir = await dirReady.catch(() => null)
      if (dir) await rm(dir, { recursive: true, force: true })
    }
  )
  /** The pass-1 encoder, started once the temp folder exists (never after an abort). */
  const pass1Run = async (): Promise<FfmpegRun> => {
    if (run) return run
    const dir = await dirReady
    if (life.aborted()) throw abortError()
    pass1 = join(dir, 'pass1.m4a')
    run = new FfmpegRun([...pcmInput, '-c:a', 'aac', '-b:a', '64k', '-f', 'ipod', pass1], true)
    return run
  }
  return {
    write: (pcm) =>
      life.guard(async () => {
        await (await pass1Run()).write(toS16le(pcm))
        samples += pcm.length
      }),
    finish: (chapters) =>
      life.guard(async () => {
        const first = await pass1Run()
        first.end()
        await first.closed
        const dir = await dirReady
        const list = chapters.length > 0 ? chapters : [{ title: meta.title, startSec: 0 }]
        const metaFile = join(dir, 'meta.txt')
        await writeFile(metaFile, ffmetadata(meta, list, samples / SAMPLE_RATE), 'utf8')
        if (life.aborted()) throw abortError()
        run = new FfmpegRun(
          [
            '-i', pass1, '-i', metaFile,
            '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1',
            '-c', 'copy', '-movflags', '+faststart', '-f', 'ipod',
            part
          ],
          false
        ) // prettier-ignore
        await run.closed
        if (life.aborted()) throw abortError()
        await setChapterTrackLanguage(part, 'eng')
        await publish(part, outPath, life.aborted)
        await rm(dir, { recursive: true, force: true })
      }),
    abort: life.abort
  }
}
