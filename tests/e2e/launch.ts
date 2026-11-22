import { spawn } from 'child_process'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'

const root = resolve(__dirname, '..', '..')

/** The packaged binary electron-builder writes to release/ (see electron-builder.yml). */
export function packagedExecutable(): string {
  // TIDE_PACKAGED_EXE points at a build in another folder (e.g. when release/ holds a running Tide).
  if (process.env.TIDE_PACKAGED_EXE) return resolve(root, process.env.TIDE_PACKAGED_EXE)
  switch (process.platform) {
    case 'darwin':
      return resolve(root, 'release/mac-arm64/Tide.app/Contents/MacOS/Tide')
    case 'win32':
      return resolve(root, 'release/win-unpacked/Tide.exe')
    default:
      throw new Error(`no packaged Tide build for ${process.platform}`)
  }
}

/**
 * Launch Tide for an e2e test. TIDE_PACKAGED=1 runs the packaged app from release/
 * (`npm run package` first); otherwise the electron-vite build in out/ (`npm run build`).
 */
export async function launchTide(
  env: Record<string, string> = {},
  opts: { pinWindow?: boolean } = {}
): Promise<ElectronApplication> {
  // Each launch gets a fresh userData dir (a new, empty shelf) unless the test passes one, e.g. to restart.
  const userData = env.TIDE_USER_DATA ?? (await mkdtemp(join(tmpdir(), 'tide-e2e-')))
  const fullEnv = {
    ...(process.env as Record<string, string>),
    TIDE_E2E: '1',
    ...env,
    TIDE_USER_DATA: userData
  }
  const app =
    process.env.TIDE_PACKAGED === '1'
      ? await electron.launch({ executablePath: packagedExecutable(), env: fullEnv })
      : await electron.launch({ args: [resolve(root, 'out/main/index.js')], env: fullEnv })
  if (opts.pinWindow !== false) await pinWindow(app)
  return app
}

/** Content size every e2e window is pinned to: fits a 1024x768 CI screen and is under the 1100 px breakpoint. */
export const PINNED_SIZE = { width: 1000, height: 700 }

/**
 * CI runners have ~1024 px screens and the OS clamps Tide's 1200x800 window to them, so the layout would
 * depend on the machine. Pin the content size (from the test side) so the narrow layout is used everywhere.
 */
async function pinWindow(app: ElectronApplication): Promise<void> {
  const win = await app.firstWindow()
  // On a cold launch the window is created hidden and shown on 'ready-to-show'; a resize issued before
  // that can be lost (or undone by show() on Windows). So wait until it is visible, re-apply the size on
  // every poll until the renderer reports it, then confirm it stays put.
  await win.waitForLoadState('domcontentloaded')
  const applyAndRead = (): Promise<number> =>
    app
      .evaluate(({ BrowserWindow }, size) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (!w.isVisible()) return false
        if (w.isMaximized()) w.unmaximize()
        const [cw, ch] = w.getContentSize()
        if (cw !== size.width || ch !== size.height) w.setContentSize(size.width, size.height)
        return true
      }, PINNED_SIZE)
      .then(async (visible) => (visible ? win.evaluate(() => window.innerWidth) : -1))
  await expect.poll(applyAndRead, { timeout: 20_000 }).toBe(PINNED_SIZE.width)
  await win.waitForTimeout(300)
  await expect.poll(applyAndRead, { timeout: 10_000 }).toBe(PINNED_SIZE.width)
}

/**
 * Starts a second Tide process with `args` (e.g. a PDF path), as Explorer / Finder would, and resolves
 * with its exit code. With the single-instance lock it hands the files to the running Tide and exits.
 * `env` must carry the same TIDE_USER_DATA as the running one, since the lock is keyed by it.
 */
export async function spawnSecond(
  args: string[],
  env: Record<string, string>
): Promise<number | null> {
  const fullEnv: Record<string, string | undefined> = {
    ...(process.env as Record<string, string>),
    TIDE_E2E: '1',
    ...env
  }
  delete fullEnv.ELECTRON_RUN_AS_NODE
  let exe: string
  let full: string[]
  if (process.env.TIDE_PACKAGED === '1') {
    exe = packagedExecutable()
    full = args
  } else {
    exe = (await import('electron')).default as unknown as string
    full = [resolve(root, 'out/main/index.js'), ...args]
  }
  return new Promise((res, rej) => {
    const child = spawn(exe, full, { env: fullEnv, stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      rej(new Error('the second Tide did not exit'))
    }, 20_000)
    child.on('error', rej)
    child.on('exit', (code) => {
      clearTimeout(timer)
      res(code)
    })
  })
}
