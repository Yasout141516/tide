import { join } from 'path'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { resourcePath } from './paths'

const BLURB = 'A calm, offline PDF read-aloud app.'
const GPL = 'Free software under the GNU GPL v3'

export function aboutText(version: string): { title: string; detail: string } {
  return {
    title: `Tide ${version}`,
    detail: `${BLURB}\nThe voice (Kokoro-82M) runs on this computer; nothing is sent online.\n\n${GPL}. Includes FFmpeg (GPL) and other open-source parts — see the licences.`
  }
}

/** Packaged: NOTICE.md sits in the resources folder (extraResources). Dev: it is the repo-root file. */
function noticePath(): string {
  return app.isPackaged ? resourcePath('NOTICE.md') : join(__dirname, '..', '..', 'NOTICE.md')
}

/** Windows and Linux: a message box with a button that opens the bundled NOTICE file (local, no network). */
export async function showAbout(win: BrowserWindow | null): Promise<void> {
  const { title, detail } = aboutText(app.getVersion())
  const options = {
    type: 'info' as const,
    title: 'About Tide',
    message: title,
    detail: `${detail}\n\nElectron ${process.versions.electron}`,
    buttons: ['OK', 'View licences'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  if (response === 1) await openNotice()
}

/** Opens the bundled NOTICE file (local, no network); used by About and Help > View licences. */
export async function openNotice(): Promise<void> {
  await shell.openPath(noticePath())
}

/** macOS: the standard About panel, filled once at startup. */
export function configureAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: 'Tide',
    applicationVersion: app.getVersion(),
    version: '',
    credits: `${BLURB} The voice (Kokoro-82M) runs on this computer. ${GPL}; includes FFmpeg (GPL). See NOTICE.md in the app resources for licences.`,
    copyright: GPL
  })
}
