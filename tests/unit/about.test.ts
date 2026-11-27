import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isPackaged: true,
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.isPackaged
    }
  },
  dialog: {},
  shell: { openPath: h.openPath, showItemInFolder: h.showItemInFolder }
}))
vi.mock('../../src/main/paths', () => ({ resourcePath: (n: string) => `/res/${n}` }))
vi.mock('../../src/main/log', () => ({ logError: h.logError }))

const { aboutText, openNotice } = await import('../../src/main/about')

describe('aboutText', () => {
  it('returns the exact copy with the version', () => {
    expect(aboutText('1.0.0')).toEqual({
      title: 'Tide 1.0.0',
      detail:
        'A calm, offline PDF read-aloud app.\nThe voice (Kokoro-82M) runs on this computer; nothing is sent online.\n\nFree software under the GNU GPL v3. Includes FFmpeg (GPL) and other open-source parts — see the licences.'
    })
  })
})

describe('openNotice', () => {
  beforeEach(() => {
    h.isPackaged = true
    h.openPath.mockReset()
    h.showItemInFolder.mockReset()
    h.logError.mockReset()
  })
  it('opens the plain-text NOTICE.txt when packaged, with no fallback on success', async () => {
    h.openPath.mockResolvedValue('')
    await openNotice()
    expect(h.openPath).toHaveBeenCalledWith('/res/NOTICE.txt')
    expect(h.showItemInFolder).not.toHaveBeenCalled()
    expect(h.logError).not.toHaveBeenCalled()
  })
  it('opens the repo-root NOTICE.md in dev', async () => {
    h.isPackaged = false
    h.openPath.mockResolvedValue('')
    await openNotice()
    expect(String(h.openPath.mock.calls[0][0])).toMatch(/NOTICE\.md$/)
  })
  it('logs the error and shows the file in its folder when openPath returns an error string', async () => {
    h.openPath.mockResolvedValue('Failed to open path')
    await openNotice()
    expect(h.logError).toHaveBeenCalledTimes(1)
    expect(h.showItemInFolder).toHaveBeenCalledWith('/res/NOTICE.txt')
  })
})
