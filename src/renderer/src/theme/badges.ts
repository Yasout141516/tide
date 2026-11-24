import type { ResolvedTheme } from './theme'

/**
 * Course "type" badge colours, in course order (they cycle). One place per theme, so Kitty can add
 * its own list. Text on every badge is white (each pair is at least 4.5:1, checked in tokens.test).
 */
export const BADGE_COLOURS: Partial<Record<ResolvedTheme, readonly string[]>> = {
  'pixel-quest': ['#B83D73', '#2B6FA8', '#8C6420', '#3A7D30', '#C8432B']
}

/** The badge colour for the n-th course, or null when the theme has no badges. */
export function badgeColour(theme: ResolvedTheme, index: number): string | null {
  const list = BADGE_COLOURS[theme]
  return list && list.length > 0 ? list[index % list.length] : null
}

/** Three-letter badge label from the course name ("PSYC 201" gives "PSY"). */
export function badgeLabel(name: string): string {
  return (name.replace(/[^A-Za-z]/g, '').slice(0, 3) || '···').toUpperCase()
}
