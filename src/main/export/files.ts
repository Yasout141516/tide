// File naming and error mapping for "Save as audio".
import { join } from 'path'
import type { ExportFailure } from '../../shared/ipc-types'

/** Saved audio goes in a Tide folder inside the music folder. */
export const exportDir = (musicDir: string): string => join(musicDir, 'Tide')

/** A name safe on Windows and macOS: no reserved characters, no edge dots or spaces, at most 120 long. */
export function safeFileName(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/^[ .]+|[ .]+$/g, '')
  return cleaned === '' ? 'Tide audio' : cleaned
}

/** `dir/base.ext`, or `dir/base (2).ext`, `(3)`... for the first name that does not exist yet. */
export async function uniquePath(
  dir: string,
  base: string,
  ext: string,
  exists: (p: string) => Promise<boolean>
): Promise<string> {
  let candidate = join(dir, `${base}.${ext}`)
  for (let n = 2; await exists(candidate); n++) candidate = join(dir, `${base} (${n}).${ext}`)
  return candidate
}

export function failureReason(err: unknown): ExportFailure {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOSPC') return 'disk-full'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'no-permission'
  if (code === 'ENOENT') return 'folder-missing'
  return 'failed'
}
