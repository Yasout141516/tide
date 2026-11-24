// One export run: synthesise the sentences one at a time at export priority and feed a writer.
import type { Chapter } from './ffmpeg'
import { SAMPLE_RATE } from '../../shared/pcm'
import { makeAbortError } from '../../shared/abort'
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
}

const abortError = (): Error => makeAbortError('export cancelled')

/**
 * Resolves once the writer has finished the file. On abort or any failure it cancels the generation,
 * aborts the writer (so no part or temp file is left) and rejects; an abort rejects with an
 * AbortError. Blank sentences are skipped, so a page with no text gets no chapter.
 */
export async function runExport(
  spec: ExportSpec,
  { jobId, synthesize, cancel, writer }: ExportDeps,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<void> {
  const gen = `export-${jobId}`
  const onAbort = (): void => cancel(gen)
  signal.addEventListener('abort', onAbort, { once: true })
  const chapters: Chapter[] = []
  const total = spec.sentences.length
  let samples = 0
  let lastPage: number | null = null
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw abortError()
      const { text, page } = spec.sentences[i]
      if (text.trim() !== '') {
        const audio = await synthesize(text, {
          voice: spec.voice,
          speed: spec.speed,
          priority: 'export',
          gen
        })
        if (signal.aborted) throw abortError()
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
    await writer.finish(chapters)
  } catch (err) {
    cancel(gen)
    await writer.abort()
    throw signal.aborted ? abortError() : err
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
