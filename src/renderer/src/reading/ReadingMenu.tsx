import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { FINISH_IN_CHOICES } from '../../../shared/voices'
import type { ReadingView } from '../../../shared/library/types'

type Props = {
  reading: ReadingView
  onRename(): void
  onRemove(): void
  /** More items, shown above Rename (e.g. "Read everything"). */
  extraItems?: ReactNode
}

export const menuItemClass =
  'flex min-h-9 cursor-pointer items-center rounded-[10px] px-3 py-2 font-sans text-[13px] font-semibold text-ink data-[highlighted]:bg-soft data-[highlighted]:text-soft-ink'

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
          <Menu.Item onSelect={onRename} className={menuItemClass}>
            Rename…
          </Menu.Item>
          <Menu.Item onSelect={onRemove} className={menuItemClass}>
            Remove from shelf…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** "Read everything" for this reading: nothing is skipped (headers, footnotes, references, citations are spoken). */
export function ReadEverythingItem({
  checked,
  onChange
}: {
  checked: boolean
  onChange(on: boolean): void
}): React.JSX.Element {
  return (
    <Menu.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      className={`${menuItemClass} gap-2`}
    >
      <span aria-hidden="true" className="w-4 text-primary">
        <Menu.ItemIndicator>✓</Menu.ItemIndicator>
      </span>
      Read everything
    </Menu.CheckboxItem>
  )
}

const finishName = (m: number): string => (m === 120 ? '2 hours' : `${m} min`)

/** "Finish in…": speed up (never slow down) so the whole reading ends within the chosen time. */
export function FinishInItem({
  value,
  onChange
}: {
  value: number | null
  onChange(m: number | null): void
}): React.JSX.Element {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className={`${menuItemClass} justify-between gap-3`}>
        <span>Finish in…</span>
        <span className="font-semibold text-muted">
          {value === null ? 'Off' : finishName(value)}
        </span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          sideOffset={6}
          collisionPadding={12}
          className="z-50 min-w-[160px] rounded-2xl border border-border bg-surface p-1.5 shadow-[0_12px_30px_var(--shadow)]"
        >
          <Menu.RadioGroup
            value={value === null ? 'off' : String(value)}
            onValueChange={(v) => onChange(v === 'off' ? null : Number(v))}
          >
            {['off', ...FINISH_IN_CHOICES.map(String)].map((v) => (
              <Menu.RadioItem key={v} value={v} className={`${menuItemClass} gap-2`}>
                <span aria-hidden="true" className="w-4 text-primary">
                  <Menu.ItemIndicator>✓</Menu.ItemIndicator>
                </span>
                {v === 'off' ? 'Off' : finishName(Number(v))}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}
