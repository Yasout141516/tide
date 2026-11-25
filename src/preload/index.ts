// Sandboxed preload: only `electron` can be required. Exposes a narrow bridge (typed in index.d.ts).
import { contextBridge, ipcRenderer } from 'electron'
import type { ExportEvent, ExportSpec, SynthesizeOptions, TtsStatus } from '../shared/ipc-types'
import { LIBRARY_ERROR_PREFIX } from '../shared/ipc-types'
import type {
  AddReadingInput,
  LibrarySnapshot,
  PdfRef,
  Pronunciation,
  ReadingPatch,
  SettingsPatch
} from '../shared/library/types'
import type { AppCommand } from '../shared/ipc-types'

/** Invoke a channel; a library failure reaches the renderer as just `tide-error:<code>`. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    // Rethrow with only the code: the original message may name a path.
    const m = /tide-error:[a-z-]+/.exec(err instanceof Error ? err.message : '')
    // eslint-disable-next-line preserve-caught-error
    throw new Error(m ? m[0] : `${LIBRARY_ERROR_PREFIX}failed`)
  }
}

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Main passes the theme it will paint first as --tide-theme=<id>; anything else falls back to sky-sea.
const THEMES = ['sky-sea', 'deep-sea', 'pixel-quest', 'kitty']
const themeArg = process.argv.find((a) => a.startsWith('--tide-theme='))?.slice(13) ?? ''
const initialTheme = THEMES.includes(themeArg) ? themeArg : 'sky-sea'

contextBridge.exposeInMainWorld('tide', {
  platform: process.platform,
  initialTheme,
  ready: () => ipcRenderer.send('app:ready'),
  onCommand: (cb: (c: AppCommand) => void) => subscribe<AppCommand>('app:command', cb),
  tts: {
    synthesize: (text: string, o: SynthesizeOptions) =>
      ipcRenderer.invoke('tts:synthesize', text, o),
    cancel: (gen: string) => ipcRenderer.invoke('tts:cancel', gen),
    status: () => ipcRenderer.invoke('tts:status'),
    onStatus: (cb: (s: TtsStatus) => void) => subscribe<TtsStatus>('tts:status', cb)
  },
  export: {
    start: (spec: ExportSpec, o?: { chooseFolder?: boolean }) =>
      ipcRenderer.invoke('export:start', spec, o),
    cancel: (jobId: string) => ipcRenderer.invoke('export:cancel', jobId),
    reveal: (jobId: string) => ipcRenderer.invoke('export:reveal', jobId),
    onEvent: (cb: (e: ExportEvent) => void) => subscribe<ExportEvent>('export:event', cb)
  },
  app: {
    setPlaying: (on: boolean) => ipcRenderer.send('app:playing', on),
    relaunch: () => ipcRenderer.send('app:relaunch'),
    log: (scope: 'renderer', message: string) => ipcRenderer.send('app:log', scope, message),
    copyDiagnostics: () => invoke<boolean>('app:copy-diagnostics')
  },
  library: {
    get: () => invoke<LibrarySnapshot>('library:get'),
    onChanged: (cb: (s: LibrarySnapshot) => void) =>
      subscribe<LibrarySnapshot>('library:changed', cb),
    pickPdf: () => invoke('library:pick'),
    readPdf: (ref: PdfRef) => invoke('library:read', ref),
    add: (i: AddReadingInput) => invoke('library:add', i),
    update: (id: string, p: ReadingPatch) => invoke('library:update', id, p),
    remove: (id: string) => invoke('library:remove', id),
    findFile: (id: string) => invoke('library:find', id),
    useDifferentFile: (id: string, pickId: string) => invoke('library:use-different', id, pickId),
    setCollapsed: (key: string, collapsed: boolean) => invoke('library:collapse', key, collapsed),
    setZoom: (zoom: number) => invoke('library:zoom', zoom),
    setVoice: (voice: string, speed: number) => invoke('library:voice', voice, speed),
    setSettings: (p: SettingsPatch) => invoke('library:settings', p),
    setPronunciations: (list: Pronunciation[]) => invoke('library:pronunciations', list),
    chooseExportFolder: () => invoke('library:choose-export-folder'),
    resetExportFolder: () => invoke('library:reset-export-folder'),
    flush: () => invoke('library:flush'),
    tipSeen: (key: string) => invoke('library:tip-seen', key)
  }
})

// Main passes --tide-e2e via webPreferences.additionalArguments only when TIDE_E2E=1.
if (process.argv.includes('--tide-e2e')) {
  contextBridge.exposeInMainWorld('tideTest', {
    ttsLoad: () => ipcRenderer.invoke('tts:test-load'),
    lastSynthText: (): Promise<string> => ipcRenderer.invoke('test:last-synth-text'),
    exportM4b: (outPath: string) => ipcRenderer.invoke('test:export-m4b', outPath)
  })
}
