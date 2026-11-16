import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let quitting = false
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
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
      backgroundThrottling: false
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

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', () => {
  quitting = true
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.yasout141516.tide')
  createWindow()

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    else createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
