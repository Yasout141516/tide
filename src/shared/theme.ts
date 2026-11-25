import { THEME_IDS, type ThemeId } from './library/types'

export type ResolvedTheme = Exclude<ThemeId, 'system'>

export const RESOLVED_THEME_IDS: readonly ResolvedTheme[] = THEME_IDS.filter(
  (t): t is ResolvedTheme => t !== 'system'
)

/** 'system' follows the OS (Match my Mac): dark gives Deep Sea, light gives Sky & Sea. */
export function resolveTheme(id: ThemeId, osDark: boolean): ResolvedTheme {
  if (id === 'system') return osDark ? 'deep-sea' : 'sky-sea'
  return id
}

export function isThemeId(v: unknown): v is ThemeId {
  return (THEME_IDS as readonly unknown[]).includes(v)
}

export function isResolvedTheme(v: unknown): v is ResolvedTheme {
  return (RESOLVED_THEME_IDS as readonly unknown[]).includes(v)
}
