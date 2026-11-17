// Sandboxed preload: only `electron` can be required. Exposes a narrow bridge (typed in index.d.ts).
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tide', {
  tts: {
    synthesize: (text: string, o: { voice: string; speed: number }) =>
      ipcRenderer.invoke('tts:synthesize', text, o)
  }
})

// Main passes --tide-e2e via webPreferences.additionalArguments only when TIDE_E2E=1.
if (process.argv.includes('--tide-e2e')) {
  contextBridge.exposeInMainWorld('tideTest', {
    ttsLoad: () => ipcRenderer.invoke('tts:test-load'),
    exportM4b: (outPath: string) => ipcRenderer.invoke('test:export-m4b', outPath)
  })
}
