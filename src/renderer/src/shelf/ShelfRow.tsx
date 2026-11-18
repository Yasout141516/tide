import type { ReadingView } from '../../../shared/library/types'
import { rowLabel } from '../../../shared/library/shelf'

type Props = { reading: ReadingView; selected: boolean; onOpen(): void }

export function ShelfRow({ reading, selected, onOpen }: Props): React.JSX.Element {
  const labelColour = reading.missing
    ? 'font-bold text-warn'
    : selected
      ? 'font-bold text-primary'
      : 'font-normal text-muted'
  return (
    <button
      type="button"
      onClick={onOpen}
      data-reading-id={reading.id}
      aria-current={selected ? 'true' : undefined}
      className={`block min-h-9 w-full cursor-pointer rounded-[10px] border-0 px-2.5 py-2 text-left font-sans text-[13px] leading-[1.3] font-semibold text-ink ${
        selected ? 'bg-surface shadow-[0_1px_3px_var(--shadow)]' : 'bg-transparent'
      }`}
    >
      <span className="block">{reading.title}</span>
      <small className={`mt-0.5 block text-[11.5px] ${labelColour}`}>{rowLabel(reading)}</small>
    </button>
  )
}
