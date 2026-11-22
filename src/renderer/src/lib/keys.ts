/** Focus that owns the keyboard: a dialog, field, menu or listbox (plus `own`, extra selectors). */
export function focusOwnsKeys(e: KeyboardEvent, own = ''): boolean {
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true
  const t = e.target as HTMLElement | null
  return !!t?.closest(
    `input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]${own}`
  )
}

/** Keys that belong to a dialog, a field or a menu are never the player's; nor are modified keys. */
export function leavesKeysAlone(e: KeyboardEvent, own: string): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true
  return focusOwnsKeys(e, own)
}
