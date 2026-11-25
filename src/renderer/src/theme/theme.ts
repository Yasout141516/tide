import { createContext, useContext } from 'react'
import type { ThemeId } from '../../../shared/library/types'
import { resolveTheme, type ResolvedTheme } from '../../../shared/theme'
import { useLibrary } from '../state/useLibrary'
import { tide } from '../lib/tide'
import { useMediaQuery } from '../shell/useMediaQuery'

export { resolveTheme, type ResolvedTheme }

/** Only Deep Sea is dark: Pixel Quest's page is light cream and Kitty is light. */
export function isDarkTheme(t: ResolvedTheme): boolean {
  return t === 'deep-sea'
}

export interface ThemeValue {
  id: ThemeId
  resolved: ResolvedTheme
  dark: boolean
}

/** Provided by ThemeRoot; null means no ThemeRoot above, and useTheme works the value out itself. */
export const ThemeContext = createContext<ThemeValue | null>(null)

/** The theme from the library and the OS. ThemeRoot calls this once and shares the result. */
export function useComputedTheme(): ThemeValue {
  const library = useLibrary()
  const osDark = useMediaQuery('(prefers-color-scheme: dark)')
  // Until the first snapshot arrives, the theme main painted the window with.
  const id = library ? library.settings.theme : tide().initialTheme
  const resolved = resolveTheme(id, osDark)
  return { id, resolved, dark: isDarkTheme(resolved) }
}

export function useTheme(): ThemeValue {
  const shared = useContext(ThemeContext)
  // Whether a ThemeRoot is above never changes for a mounted component, so the hook order is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return shared ?? useComputedTheme()
}
