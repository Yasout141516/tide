import type { ThemeId } from '../../../shared/library/types'
import { useLibrary } from '../state/useLibrary'
import { useMediaQuery } from '../shell/useMediaQuery'

export type ResolvedTheme = Exclude<ThemeId, 'system'>

/** 'system' follows the OS (Match my Mac): dark gives Deep Sea, light gives Sky & Sea. */
export function resolveTheme(id: ThemeId, osDark: boolean): ResolvedTheme {
  if (id === 'system') return osDark ? 'deep-sea' : 'sky-sea'
  return id
}

/** Only Deep Sea is dark: Pixel Quest's page is light cream and Kitty is light. */
export function isDarkTheme(t: ResolvedTheme): boolean {
  return t === 'deep-sea'
}

export function useTheme(): { id: ThemeId; resolved: ResolvedTheme; dark: boolean } {
  const library = useLibrary()
  const osDark = useMediaQuery('(prefers-color-scheme: dark)')
  const id = library?.settings.theme ?? 'sky-sea'
  const resolved = resolveTheme(id, osDark)
  return { id, resolved, dark: isDarkTheme(resolved) }
}
