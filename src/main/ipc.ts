import { isAbsolute } from 'path'
import { ipcMain } from 'electron'
import type { ExportM4bResult, TtsAudio } from '../shared/ipc-types'
import { SAMPLE_RATE } from '../shared/pcm'
import type { TtsHost } from './tts-host'
import { assembleChapters, exportM4b, ffmpegHasMp3 } from './audio-export'

/** Registers the renderer-facing IPC handlers. `e2e` adds test-only hooks (TIDE_E2E=1). */
export function registerIpc(host: TtsHost, { e2e }: { e2e: boolean }): void {
  ipcMain.handle('tts:synthesize', (_e, text: unknown, o: unknown) => {
    const opts = (o ?? {}) as { voice?: unknown; speed?: unknown }
    if (
      typeof text !== 'string' ||
      typeof opts.voice !== 'string' ||
      typeof opts.speed !== 'number'
    ) {
      throw new Error('tts:synthesize expects (text: string, { voice: string, speed: number })')
    }
    return host.synthesize(text, { voice: opts.voice, speed: opts.speed })
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
  for (const text of pages) audio.push(await host.synthesize(text, { voice: 'af_heart', speed: 1 }))
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
