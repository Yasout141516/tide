import type { ThemeId } from '../shared/library/types'

export type ResolvedThemeId = Exclude<ThemeId, 'system'>

/** First-paint window colours: each must equal that theme's `--bg` in tokens.css (a unit test checks). */
export const WINDOW_BG: Partial<Record<ResolvedThemeId, string>> = {
  'sky-sea': '#f2f9ff',
  'deep-sea': '#0b1d2c',
  'pixel-quest': '#12304a'
}

/** The theme the renderer paints first: the stored one, with 'system' following the OS. */
export function resolveInitialTheme(stored: ThemeId | undefined, osDark: boolean): ResolvedThemeId {
  const id = stored ?? 'sky-sea'
  if (id === 'system') return osDark ? 'deep-sea' : 'sky-sea'
  return id
}

export function windowBackground(stored: ThemeId | undefined, osDark: boolean): string {
  return WINDOW_BG[resolveInitialTheme(stored, osDark)] ?? WINDOW_BG['sky-sea']!
}
