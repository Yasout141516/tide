// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeRoot } from '../../src/renderer/src/theme/ThemeRoot'
import { isDarkTheme, resolveTheme } from '../../src/renderer/src/theme/theme'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { LibrarySettings } from '../../src/shared/library/types'
import { fakeTide, setOsDark } from './setup'

async function mount(over: Partial<LibrarySettings>): Promise<void> {
  const base = await fakeTide().library.get()
  setTide(fakeTide({ snapshot: { settings: { ...base.settings, ...over } } }))
  render(<ThemeRoot />)
  await act(async () => {})
}

const attr = (n: 'theme' | 'darkPages'): string | undefined => document.documentElement.dataset[n]

describe('theme engine', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.darkPages
  })

  it('resolves system to deep-sea when the OS is dark and sky-sea when light', () => {
    expect(resolveTheme('system', true)).toBe('deep-sea')
    expect(resolveTheme('system', false)).toBe('sky-sea')
    expect(resolveTheme('kitty', true)).toBe('kitty')
    expect(resolveTheme('pixel-quest', false)).toBe('pixel-quest')
  })

  it('only deep-sea is dark', () => {
    expect(isDarkTheme('deep-sea')).toBe(true)
    for (const t of ['sky-sea', 'pixel-quest', 'kitty'] as const) expect(isDarkTheme(t)).toBe(false)
  })

  it('re-themes live when the OS flips', async () => {
    await mount({ theme: 'system' })
    expect(attr('theme')).toBe('sky-sea')
    await act(async () => setOsDark(true))
    expect(attr('theme')).toBe('deep-sea')
    await act(async () => setOsDark(false))
    expect(attr('theme')).toBe('sky-sea')
  })

  it('dark pages flag is set only for a dark resolved theme with darkPages on', async () => {
    await mount({ theme: 'deep-sea', darkPages: true })
    expect(attr('darkPages')).toBe('true')
  })

  it('dark pages flag is false when darkPages is off or the theme is light', async () => {
    await mount({ theme: 'deep-sea', darkPages: false })
    expect(attr('darkPages')).toBe('false')
  })

  it('dark pages flag is false for a light theme even with darkPages on', async () => {
    await mount({ theme: 'sky-sea', darkPages: true })
    expect(attr('darkPages')).toBe('false')
  })

  it('system with a dark OS and darkPages on sets dark pages', async () => {
    await mount({ theme: 'system', darkPages: true })
    await act(async () => setOsDark(true))
    expect(attr('theme')).toBe('deep-sea')
    expect(attr('darkPages')).toBe('true')
  })

  it('uses the initial theme from main before the library snapshot arrives', async () => {
    const t = fakeTide({ initialTheme: 'deep-sea' })
    t.library.get = () => new Promise(() => {})
    setTide(t)
    render(<ThemeRoot />)
    expect(attr('theme')).toBe('deep-sea')
  })
})
