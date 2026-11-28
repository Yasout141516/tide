// One export run: synthesise the sentences one at a time at export priority and feed a writer.
import type { Chapter } from './ffmpeg'
import { SAMPLE_RATE } from '../../shared/pcm'
import { isAbortError, makeAbortError } from '../../shared/abort'
import type { ExportSpec, TtsAudio } from '../../shared/ipc-types'
import type { TtsSynthesizeOptions } from '../tts-host'
import type { AudioWriter } from './writers'

export interface ExportDeps {
  jobId: string
  synthesize(
    text: string,
    o: TtsSynthesizeOptions & { priority: 'export'; gen: string }
  ): Promise<TtsAudio>
  /** Cancel every queued or running synthesis of this generation (TtsHost.cancel). */
  cancel(gen: string): void
  writer: AudioWriter
  /** Called for each sentence left out because it failed twice (RS-3). */
  onSkip?(index: number, err: unknown): void
}

/** This many sentences in a row failing means the voice is broken, not the sentences: the export fails. */
const MAX_CONSECUTIVE_SKIPS = 3

const abortError = (): Error => makeAbortError('export cancelled')

/**
 * Resolves once the writer has finished the file. On abort or any failure it cancels the generation,
 * aborts the writer (so no part or temp file is left) and rejects; an abort rejects with an
 * AbortError. Blank sentences are skipped, so a page with no text gets no chapter. A sentence that
 * fails is tried once more, then left out (reported through `onSkip`) so one bad sentence does not
 * lose the whole export; three left out in a row fail the export. Returns how many were left out.
 */
export async function runExport(
  spec: ExportSpec,
  { jobId, synthesize, cancel, writer, onSkip }: ExportDeps,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<number> {
  const gen = `export-${jobId}`
  const onAbort = (): void => cancel(gen)
  signal.addEventListener('abort', onAbort, { once: true })
  const chapters: Chapter[] = []
  const total = spec.sentences.length
  let samples = 0
  let lastPage: number | null = null
  let skipped = 0
  let skipRun = 0
  let lastErr: unknown = null
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw abortError()
      const { text, page } = spec.sentences[i]
      if (text.trim() !== '') {
        const once = (): Promise<TtsAudio> =>
          synthesize(text, { voice: spec.voice, speed: spec.speed, priority: 'export', gen })
        let audio: TtsAudio | null = null
        try {
          audio = await once().catch((err: unknown) => {
            if (signal.aborted || isAbortError(err)) throw err
            return once()
          })
        } catch (err) {
          if (signal.aborted || isAbortError(err)) throw err
          skipped++
          lastErr = err
          onSkip?.(i, err)
          if (++skipRun >= MAX_CONSECUTIVE_SKIPS) throw err
        }
        if (signal.aborted) throw abortError()
        if (audio === null) {
          onProgress(i + 1, total)
          continue
        }
        skipRun = 0
        if (page !== lastPage) {
          chapters.push({ title: `Page ${page}`, startSec: samples / SAMPLE_RATE })
          lastPage = page
        }
        await writer.write(audio.pcm)
        samples += audio.pcm.length
      }
      onProgress(i + 1, total)
    }
    if (signal.aborted) throw abortError()
    if (skipped > 0 && samples === 0) throw lastErr // nothing could be read: no empty file
    await writer.finish(chapters)
    return skipped
  } catch (err) {
    cancel(gen)
    await writer.abort()
    throw signal.aborted ? abortError() : err
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
