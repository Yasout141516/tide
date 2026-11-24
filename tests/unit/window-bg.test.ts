import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { WINDOW_BG, windowBackground } from '../../src/main/window-bg'

const tokens = readFileSync(join(__dirname, '../../src/renderer/src/assets/tokens.css'), 'utf8')

function bgOf(theme: string): string | null {
  const block = new RegExp(String.raw`:root\[data-theme='${theme}'\]\s*\{([^}]*)\}`).exec(tokens)
  return block ? (/--bg:\s*(#[0-9a-fA-F]{3,8})/.exec(block[1])?.[1] ?? null) : null
}

describe('window background', () => {
  it('matches --bg in tokens.css for every theme present in both', () => {
    const keys = Object.keys(WINDOW_BG).filter((k) => bgOf(k) !== null)
    expect(keys).toEqual(expect.arrayContaining(['sky-sea', 'deep-sea']))
    for (const k of keys)
      expect(WINDOW_BG[k as keyof typeof WINDOW_BG]!.toLowerCase(), k).toBe(bgOf(k)!.toLowerCase())
  })

  it('uses the stored theme, and follows the OS for system', () => {
    expect(windowBackground('deep-sea', false)).toBe(WINDOW_BG['deep-sea'])
    expect(windowBackground('sky-sea', true)).toBe(WINDOW_BG['sky-sea'])
    expect(windowBackground('system', true)).toBe(WINDOW_BG['deep-sea'])
    expect(windowBackground('system', false)).toBe(WINDOW_BG['sky-sea'])
    expect(windowBackground(undefined, true)).toBe(WINDOW_BG['sky-sea'])
  })
})
