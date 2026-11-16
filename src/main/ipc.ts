import { ipcMain } from 'electron'
import type { TtsHost } from './tts-host'

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
  }
}
