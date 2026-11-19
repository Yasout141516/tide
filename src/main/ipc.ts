import { isAbsolute } from 'path'
import { ipcMain } from 'electron'
import type { ExportM4bResult, TtsAudio } from '../shared/ipc-types'
import { SAMPLE_RATE } from '../shared/pcm'
import { DEFAULT_VOICE, VOICE_IDS } from '../shared/voices'
import type { TtsHost } from './tts-host'
import { assembleChapters, exportM4b, ffmpegHasMp3 } from './audio-export'

/** Registers the renderer-facing IPC handlers. `e2e` adds test-only hooks (TIDE_E2E=1). */
export function registerIpc(host: TtsHost, { e2e }: { e2e: boolean }): void {
  ipcMain.handle('tts:synthesize', (_e, text: unknown, o: unknown) => {
    const { voice, speed, priority, gen } = (o ?? {}) as {
      voice?: unknown
      speed?: unknown
      priority?: unknown
      gen?: unknown
    }
    // Speed steps are 0.8x-2x; 0.5 leaves room for previews. NaN, 0 or negative must not reach Kokoro.
    if (
      typeof text !== 'string' ||
      typeof voice !== 'string' ||
      !VOICE_IDS.has(voice) ||
      (priority !== undefined && priority !== 'live' && priority !== 'preview') ||
      (gen !== undefined && (typeof gen !== 'string' || gen.length > 64)) ||
      typeof speed !== 'number' ||
      !Number.isFinite(speed) ||
      speed < 0.5 ||
      speed > 2
    ) {
      throw new Error(
        'tts:synthesize expects (text: string, { voice: one of the ten voices, speed: a number from 0.5 to 2, priority?: live | preview, gen?: string up to 64 characters })'
      )
    }
    return host.synthesize(text, {
      voice,
      speed,
      ...(priority !== undefined && { priority }),
      ...(gen !== undefined && { gen })
    })
  })

  ipcMain.handle('tts:cancel', (_e, gen: unknown) => {
    if (typeof gen !== 'string' || gen.length > 64) {
      throw new Error('tts:cancel expects (gen: string up to 64 characters)')
    }
    host.cancel(gen)
  })

  if (e2e) {
    ipcMain.handle('tts:test-load', () => host.start())
    ipcMain.handle('test:export-m4b', (_e, outPath: unknown) => {
      if (typeof outPath !== 'string' || !isAbsolute(outPath)) {
        throw new Error('test:export-m4b expects an absolute output path')
      }
      return exportTwoPageM4b(host, outPath)
    })
  }
}

/** Speak two short "pages" and save them as a 2-chapter .m4b: the M0d audiobook spike. */
async function exportTwoPageM4b(host: TtsHost, outPath: string): Promise<ExportM4bResult> {
  const pages = ['This is the first page.', 'And this is the second page.']
  const audio: TtsAudio[] = []
  for (const text of pages)
    audio.push(await host.synthesize(text, { voice: DEFAULT_VOICE, speed: 1 }))
  const { pcm, chapters } = assembleChapters(
    audio,
    pages.map((_, i) => `Page ${i + 1}`)
  )
  const t0 = performance.now()
  await exportM4b(
    pcm,
    SAMPLE_RATE,
    chapters,
    { title: 'Tide smoke', album: 'Tide smoke', artist: 'Tide' },
    outPath
  )
  return {
    audioSec: pcm.length / SAMPLE_RATE,
    chapters: chapters.length,
    exportMs: Math.round(performance.now() - t0),
    ffmpegHasMp3: await ffmpegHasMp3()
  }
}
