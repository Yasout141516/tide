import type { ThemeId } from '../shared/library/types'
import { resolveTheme, type ResolvedTheme } from '../shared/theme'

/** First-paint window colours: each must equal that theme's `--bg` in tokens.css (a unit test checks). */
export const WINDOW_BG: Record<ResolvedTheme, string> = {
  'sky-sea': '#f2f9ff',
  'deep-sea': '#0b1d2c',
  'pixel-quest': '#12304a',
  kitty: '#fff7f2'
}

/** The theme the renderer paints first: the stored one, with 'system' following the OS. */
export function windowBackground(stored: ThemeId | undefined, osDark: boolean): string {
  return WINDOW_BG[resolveTheme(stored ?? 'sky-sea', osDark)]
}
