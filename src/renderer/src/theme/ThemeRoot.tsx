import { useLayoutEffect } from 'react'
import { useLibrary } from '../state/useLibrary'
import { useTheme } from './theme'

/** Sets the theme attributes on <html>; the token blocks and dark-pages CSS read them. Renders nothing. */
export function ThemeRoot(): null {
  const { resolved, dark } = useTheme()
  const darkPages = useLibrary()?.settings.darkPages ?? true
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    root.dataset.darkPages = String(dark && darkPages)
  }, [resolved, dark, darkPages])
  return null
}
