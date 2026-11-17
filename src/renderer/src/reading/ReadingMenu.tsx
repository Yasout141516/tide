import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReadingView } from '../../../shared/library/types'

type Props = {
  reading: ReadingView
  onRename(): void
  onRemove(): void
  /** More items, shown above Rename (e.g. "Read everything"). */
  extraItems?: ReactNode
}

const item =
  'flex min-h-9 cursor-pointer items-center rounded-[10px] px-3 py-2 font-sans text-[13px] font-semibold text-ink outline-none data-[highlighted]:bg-soft data-[highlighted]:text-soft-ink'

export function ReadingMenu({ reading, onRename, onRemove, extraItems }: Props): React.JSX.Element {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`More options for ${reading.title}`}
        className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-soft px-3.5 py-2 font-sans text-[13px] font-extrabold text-soft-ink"
      >
        More
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[200px] rounded-2xl border border-border bg-surface p-1.5 shadow-[0_12px_30px_var(--shadow)]"
        >
          {extraItems}
          <Menu.Item onSelect={onRename} className={item}>
            Rename…
          </Menu.Item>
          <Menu.Item onSelect={onRemove} className={item}>
            Remove from shelf…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
