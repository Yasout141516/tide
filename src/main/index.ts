import { resolveInitialTheme, windowBackground } from './window-bg'
import { createLog, createRendererGate, diagnosticInfo, logError, setLog } from './log'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerSaveBlocker
} from 'electron'
import { join } from 'path'
import { arch, release } from 'os'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { TtsHost } from './tts-host'
import { registerIpc } from './ipc'
import { makeSpeak } from './speak'
import { registerExportIpc, type ExportController } from './export/ipc'
import { PlayingBlocker, releaseWhenRendererLost } from './playing'
import { resourcePath } from './paths'
import { Library } from './library/library'
import { courseNameOf } from '../shared/library/shelf'
import { registerLibraryIpc } from './library/ipc'
import { buildMenu } from './menu'
import { filesFromArgv, openWithHandler, OpenWithQueue } from './open-with'
import {
  createFatalHandler,
  createQuitHandler,
  createShowWindow,
  openLibraryOrReport
} from './startup'

// Accepted risk: the test-only IPC hooks are reachable in a packaged build too, but only when the app
// is launched with TIDE_E2E=1. That is required so CI smoke-tests the real installer artifact.
const e2e = process.env.TIDE_E2E === '1'
/** e2e only: the last text main sent to the TTS host (after pronunciation fixes). */
let lastSynthText = ''
// Same gate: e2e tests give each launch its own userData dir so they never touch a real shelf.
if (e2e && process.env.TIDE_USER_DATA) app.setPath('userData', process.env.TIDE_USER_DATA)

const QUIT_FLUSH_TIMEOUT_MS = 3000

let quitting = false
let mainWindow: BrowserWindow | null = null
// True once any window has been made: after that, a stray error is only logged (never "could not start").
let windowEverCreated = false
let ttsHost: TtsHost | null = null
const playing = new PlayingBlocker(powerSaveBlocker)
let library: Library | null = null
let libraryIpc: ReturnType<typeof registerLibraryIpc> | null = null
let exportCtl: ExportController | null = null
const openWith = new OpenWithQueue()

// macOS delivers Open With / drop-on-Dock as `open-file`, possibly before `ready`: queue it.
app.on('open-file', (e, path) => {
  e.preventDefault()
  openWith.push(path)
})

// One Tide at a time: a second launch hands its files to the running one and quits. The lock is
// keyed by userData, so it comes after the TIDE_USER_DATA hook above.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function createWindow(): BrowserWindow {
  // The library is open before any window is made, so the stored theme paints from the first frame.
  const stored = library?.snapshot().settings.theme
  const initialTheme = resolveInitialTheme(stored, nativeTheme.shouldUseDarkColors)
  const win = new BrowserWindow({
    title: 'Tide',
    backgroundColor: windowBackground(stored, nativeTheme.shouldUseDarkColors),
    // Content size: the shelf needs 1100 px of content to sit beside the page, so don't count the frame.
    useContentSize: true,
    width: 1200,
    height: 800,
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
      additionalArguments: [`--tide-theme=${initialTheme}`, ...(e2e ? ['--tide-e2e'] : [])]
    }
  })
  mainWindow = win
  windowEverCreated = true
  libraryIpc?.attachWindow(win)

  win.on('ready-to-show', () => win.show())
  releaseWhenRendererLost(win.webContents, playing)

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
    ttsHost?.start().catch((err) => logError('voice engine failed to load', err))
  })
}

app.on('before-quit', (e) => {
  quitting = true
  quitHandler(e)
})

const quitHandler = createQuitHandler({
  getLibrary: () => library,
  // Restart Tide goes through app.quit() too, so one hook covers both.
  beforeQuit: () => exportCtl?.abortAndWait() ?? Promise.resolve(),
  quit: () => app.quit(),
  timeoutMs: QUIT_FLUSH_TIMEOUT_MS
})

app.on('will-quit', () => {
  ttsHost?.dispose()
  playing.dispose()
})

let windowsReady = false
const showWindow = createShowWindow({
  isReady: () => windowsReady,
  getWindow: () => mainWindow,
  create: () => startTtsWhenLoaded(createWindow())
})

app.on('second-instance', (_e, argv, workingDirectory) => {
  showWindow()
  for (const p of filesFromArgv(argv, workingDirectory)) openWith.push(p)
})

// Unexpected errors go to the log, never to a dialog. Handlers log through logError, which is
// console-only until the log below is installed.
const onFatal = createFatalHandler({
  hasWindow: () => windowEverCreated,
  showError: (title, body) => dialog.showErrorBox(title, body),
  exit: (code) => app.exit(code)
})
process.on('uncaughtException', (err) => onFatal('uncaught exception', err))
process.on('unhandledRejection', (reason) => onFatal('unhandled rejection', reason))

app.whenReady().then(async () => {
  if (!gotLock) return
  const log = createLog(join(app.getPath('userData'), 'logs'))
  setLog(log)
  // Renderer errors arrive here. Anything but a 'renderer' scope and a string is ignored silently.
  const rendererGate = createRendererGate(log)
  ipcMain.on('app:log', (_e, scope: unknown, message: unknown) => {
    if (scope !== 'renderer' || typeof message !== 'string') return
    rendererGate.push(message.slice(0, 4000))
  })
  ipcMain.handle('app:copy-diagnostics', async () => {
    rendererGate.flush()
    const text = await log.diagnostics(
      diagnosticInfo({
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        os: process.platform,
        osRelease: release(),
        arch: arch(),
        voice: ttsHost?.status() ?? 'not started',
        settings: library?.snapshot().settings ?? null
      })
    )
    clipboard.writeText(text)
    return true
  })
  app.setAppUserModelId('com.yasout141516.tide')

  ttsHost = new TtsHost({
    workerPath: join(__dirname, 'tts-worker.js'),
    modelDir: resourcePath('models')
  })
  const host = ttsHost
  // The library opens after this; until then there are no rules.
  const speak = makeSpeak(
    host,
    () => library?.pronunciations() ?? [],
    e2e ? (t) => (lastSynthText = t) : undefined
  )
  registerIpc(host, { e2e, window: () => mainWindow, speak })
  if (e2e) ipcMain.handle('test:last-synth-text', () => lastSynthText)
  ipcMain.on('app:playing', (_e, on: unknown) => {
    if (typeof on === 'boolean') playing.set(on)
  })
  // quit() runs the before-quit flush, so a relaunch keeps the latest position.
  ipcMain.on('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  // If the store cannot open, still show a window (never a windowless app) and leave library.json alone.
  library = await openLibraryOrReport(
    () => Library.open(app.getPath('userData')),
    (title, body) => dialog.showErrorBox(title, body)
  )
  if (library) {
    const lib = library
    libraryIpc = registerLibraryIpc(lib, { window: () => mainWindow })
    exportCtl = registerExportIpc({
      host: { synthesize: speak, cancel: (g) => host.cancel(g) },
      window: () => mainWindow,
      defaultFolder: () => lib.exportFolder(),
      albumFor: (id) => {
        return courseNameOf(lib.snapshot(), id)
      }
    })
    const { send } = libraryIpc
    Menu.setApplicationMenu(buildMenu(send))
    lib.checkMissing().catch((err) => logError('missing-file check failed', err))
    openWith.attach(openWithHandler({ pick: (p) => lib.pick(p), send, show: showWindow }))
    for (const p of filesFromArgv(process.argv, process.cwd())) openWith.push(p)
  }

  windowsReady = true
  startTtsWhenLoaded(createWindow())

  app.on('activate', showWindow)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
