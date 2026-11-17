import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { TtsHost } from './tts-host'
import { registerIpc } from './ipc'
import { resourcePath } from './paths'

// Accepted risk: the test-only IPC hooks are reachable in a packaged build too, but only when the app
// is launched with TIDE_E2E=1. That is required so CI smoke-tests the real installer artifact.
const e2e = process.env.TIDE_E2E === '1'

let quitting = false
let mainWindow: BrowserWindow | null = null
let ttsHost: TtsHost | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'Tide',
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // The sandboxed preload reads this from process.argv to expose test-only hooks.
      additionalArguments: e2e ? ['--tide-e2e'] : []
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())

  // macOS: closing the window hides it so playback keeps running.
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Tide never opens windows or navigates anywhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const indexFile = join(__dirname, '../renderer/index.html')
  const ownUrl = devUrl ?? pathToFileURL(indexFile).toString()
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== ownUrl) e.preventDefault()
  })

  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(indexFile)
  }
  return win
}

/** Warm the voice engine once the window has loaded, so first playback is quick. */
function startTtsWhenLoaded(win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => {
    ttsHost?.start().catch((err) => console.error('[tide] voice engine failed to load:', err))
  })
}

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  ttsHost?.dispose()
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.yasout141516.tide')

  ttsHost = new TtsHost({
    workerPath: join(__dirname, 'tts-worker.js'),
    modelDir: resourcePath('models')
  })
  registerIpc(ttsHost, { e2e })

  startTtsWhenLoaded(createWindow())

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    else startTtsWhenLoaded(createWindow())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
