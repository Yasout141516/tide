import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  dialog: {},
  shell: {}
}))

const { aboutText } = await import('../../src/main/about')

describe('aboutText', () => {
  it('returns the exact copy with the version', () => {
    expect(aboutText('1.0.0')).toEqual({
      title: 'Tide 1.0.0',
      detail:
        'A calm, offline PDF read-aloud app.\nThe voice (Kokoro-82M) runs on this computer; nothing is sent online.\n\nFree software under the GNU GPL v3. Includes FFmpeg (GPL) and other open-source parts — see the licences.'
    })
  })
})
