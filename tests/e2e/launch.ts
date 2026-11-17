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
