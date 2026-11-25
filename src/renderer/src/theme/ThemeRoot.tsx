import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { useLibrary } from '../state/useLibrary'
import { ThemeContext, useComputedTheme } from './theme'

/**
 * Works the theme out once, shares it with useTheme(), and sets the theme attributes on <html>; the
 * token blocks and dark-pages CSS read them.
 */
export function ThemeRoot({ children }: { children?: ReactNode }): React.JSX.Element {
  const { id, resolved, dark } = useComputedTheme()
  const value = useMemo(() => ({ id, resolved, dark }), [id, resolved, dark])
  const darkPages = useLibrary()?.settings.darkPages ?? true
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    root.dataset.darkPages = String(dark && darkPages)
  }, [resolved, dark, darkPages])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
