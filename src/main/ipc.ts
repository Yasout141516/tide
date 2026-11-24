import { isAbsolute } from 'path'
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ExportM4bResult, TtsAudio } from '../shared/ipc-types'
import { SAMPLE_RATE } from '../shared/pcm'
import { DEFAULT_VOICE, VOICE_IDS } from '../shared/voices'
import type { TtsHost } from './tts-host'
import { assembleChapters, ffmpegHasMp3 } from './audio-export'
import { boundedId, isStr } from './validate'
import { createM4bWriter } from './export/writers'

/** Registers the renderer-facing IPC handlers. `e2e` adds test-only hooks (TIDE_E2E=1). */
export function registerIpc(
  host: TtsHost,
  { e2e, window }: { e2e: boolean; window?: () => BrowserWindow | null }
): void {
  // Sent synchronously, never batched: on a crash the host emits 'restarting' before it rejects
  // pending jobs, and the renderer must learn that no later than it sees the rejection.
  if (window) {
    host.onStatus((s) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send('tts:status', s)
    })
    ipcMain.handle('tts:status', () => host.status())
  }

  ipcMain.handle('tts:synthesize', (_e, text: unknown, o: unknown) => {
    const { voice, speed, priority, gen, front } = (o ?? {}) as {
      voice?: unknown
      speed?: unknown
      priority?: unknown
      gen?: unknown
      front?: unknown
    }
    // Speed steps are 0.8x-2x; 0.5 leaves room for previews. NaN, 0 or negative must not reach Kokoro.
    if (
      typeof text !== 'string' ||
      typeof voice !== 'string' ||
      !VOICE_IDS.has(voice) ||
      (priority !== undefined && priority !== 'live' && priority !== 'preview') ||
      (gen !== undefined && !isStr(gen, 64)) ||
      (front !== undefined && typeof front !== 'boolean') ||
      typeof speed !== 'number' ||
      !Number.isFinite(speed) ||
      speed < 0.5 ||
      speed > 2
    ) {
      throw new Error(
        'tts:synthesize expects (text: string, { voice: one of the ten voices, speed: a number from 0.5 to 2, priority?: live | preview, gen?: string up to 64 characters, front?: boolean })'
      )
    }
    return host.synthesize(text, {
      voice,
      speed,
      ...(priority !== undefined && { priority }),
      ...(gen !== undefined && { gen }),
      ...(front === true && { front })
    })
  })

  ipcMain.handle('tts:cancel', (_e, gen: unknown) => {
    host.cancel(boundedId('tts:cancel', 'gen', gen))
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
  const writer = createM4bWriter(
    outPath,
    { title: 'Tide smoke', album: 'Tide smoke', artist: 'Tide' },
    new AbortController().signal
  )
  try {
    await writer.write(pcm)
    await writer.finish(chapters)
  } catch (err) {
    await writer.abort()
    throw err
  }
  return {
    audioSec: pcm.length / SAMPLE_RATE,
    chapters: chapters.length,
    exportMs: Math.round(performance.now() - t0),
    ffmpegHasMp3: await ffmpegHasMp3()
  }
}
