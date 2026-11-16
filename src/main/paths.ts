import { join } from 'path'
import { app } from 'electron'

/** Resolve a path inside the app's resources dir (dev: <repo>/resources, packaged: process.resourcesPath). */
export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, ...segments)
}

/** Native modules and binaries are asarUnpack'd; map an asar path to its unpacked twin. */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
}
