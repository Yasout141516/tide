import { spawn } from 'child_process'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const root = resolve(__dirname, '..', '..')

/** The packaged binary electron-builder writes to release/ (see electron-builder.yml). */
export function packagedExecutable(): string {
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
export async function launchTide(env: Record<string, string> = {}): Promise<ElectronApplication> {
  // Each launch gets a fresh userData dir (a new, empty shelf) unless the test passes one, e.g. to restart.
  const userData = env.TIDE_USER_DATA ?? (await mkdtemp(join(tmpdir(), 'tide-e2e-')))
  const fullEnv = {
    ...(process.env as Record<string, string>),
    TIDE_E2E: '1',
    ...env,
    TIDE_USER_DATA: userData
  }
  if (process.env.TIDE_PACKAGED === '1') {
    return electron.launch({ executablePath: packagedExecutable(), env: fullEnv })
  }
  return electron.launch({ args: [resolve(root, 'out/main/index.js')], env: fullEnv })
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
