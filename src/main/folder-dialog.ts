import { dialog } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'

/** Shows a folder picker; the chosen path, or null when cancelled. `dialog` is read at call time so e2e can replace it. */
export async function pickFolder(win: BrowserWindow | null, title: string): Promise<string | null> {
  const opts: OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] }
  const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
}
