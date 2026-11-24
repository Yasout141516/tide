type Props = {
  /** The selection's box in viewport pixels. */
  rect: { top: number; bottom: number; left: number; width: number }
  onRead(): void
  onSave(): void
}

const BUBBLE_HEIGHT = 48
const GAP = 8
const HALF_WIDTH = 140
const button =
  'inline-flex min-h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-0 px-4 font-sans text-[13px] font-extrabold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * Two actions for the selected text, below its last line (above it when there is no room). A press on the
 * bubble must not collapse the selection it acts on, so mousedown is swallowed.
 */
export function SelectionBubble({ rect, onRead, onSave }: Props): React.JSX.Element {
  const below = rect.bottom + GAP + BUBBLE_HEIGHT <= window.innerHeight
  const centre = rect.left + rect.width / 2
  const left = Math.min(
    Math.max(centre, HALF_WIDTH + GAP),
    Math.max(window.innerWidth - HALF_WIDTH - GAP, HALF_WIDTH + GAP)
  )
  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      data-selection-bubble=""
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface p-1.5 shadow-[0_8px_24px_var(--shadow)]"
      style={{ left, top: below ? rect.bottom + GAP : rect.top - GAP - BUBBLE_HEIGHT }}
    >
      <button type="button" onClick={onRead} className={`${button} bg-primary text-on-primary`}>
        Read from here
      </button>
      <button type="button" onClick={onSave} className={`${button} bg-soft text-soft-ink`}>
        Save as audio
      </button>
    </div>
  )
}
