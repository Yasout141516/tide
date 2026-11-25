import type { ResolvedTheme } from './theme'

export type CopyKey = 'playing' | 'moved' | 'sleep' | 'emptyShelf'

const KITTY: Record<CopyKey, string> = {
  playing: 'Purring along',
  moved: 'File wandered off · Find it',
  sleep: 'Nap timer',
  emptyShelf: 'Mochi is waiting for a story'
}

/**
 * The extra playful line a theme shows beside the plain wording, or null when the theme has none.
 * Visible extras only: accessible names keep the plain text (the caller hides these from assistive tech).
 */
export function themeCopy(resolved: ResolvedTheme, key: CopyKey): string | null {
  return resolved === 'kitty' ? KITTY[key] : null
}
