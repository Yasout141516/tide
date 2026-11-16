import { join } from 'path'
import { app } from 'electron'

/** Resolve a path inside the app's resources dir (dev: <repo>/resources, packaged: process.resourcesPath). */
export function resourcePath(...segments: string[]): string {
  // Dev: this code is bundled into <repo>/out/main/index.js. Anchor on that file rather than
  // app.getAppPath(), which is <repo>/out/main when Electron is launched with a script path (e2e).
  const base = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'resources')
  return join(base, ...segments)
}

/** Native modules and binaries are asarUnpack'd; map an asar path to its unpacked twin. */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
}
