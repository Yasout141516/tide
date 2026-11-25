import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { usePlayerActions, useSleep } from './PlayerContext'
import { useTheme } from '../theme/theme'
import { themeCopy } from '../theme/copy'
import { SleepyKitten } from '../theme/mascots/Mochi'
import { SLEEP_CHOICES, sleepLabel } from './sleep'

const focus =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const trigger = `inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[11px] border-0 bg-soft px-[13px] py-[9px] font-sans text-[13px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-60 ${focus}`

/** The Sleep button, showing the live countdown, and its popover of stop-after choices. */
export function SleepPopover({ disabled }: { disabled: boolean }): React.JSX.Element {
  const sleep = useSleep()
  const { setSleep } = usePlayerActions()
  const [open, setOpen] = useState(false)
  const { resolved } = useTheme()
  const nap = themeCopy(resolved, 'sleep')
  const label = sleepLabel(sleep)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={trigger} disabled={disabled} aria-label={nap ? label : undefined}>
        {nap ? (
          <>
            <SleepyKitten width={24} />
            <span aria-hidden="true">{label.replace(/^Sleep/, nap)}</span>
          </>
        ) : (
          label
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Stop reading after…"
          className="z-50 max-h-[min(560px,var(--radix-popover-content-available-height))] w-[min(300px,calc(100vw-24px))] overflow-y-auto rounded-[18px] border border-border bg-surface p-3.5 shadow-[0_12px_32px_var(--shadow)] outline-none"
        >
          <h2 className="m-0 mb-2 flex items-center gap-2 px-1 font-sans text-[13px] font-extrabold text-soft-ink">
            {nap ? <SleepyKitten width={34} /> : null}
            Stop reading after…
          </h2>
          <div role="radiogroup" aria-label="Stop reading after" className="flex flex-col gap-1">
            {SLEEP_CHOICES.map((c) => {
              const on = c.option === sleep.option
              return (
                <button
                  key={String(c.option)}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setSleep(c.option)
                    setOpen(false)
                  }}
                  className={`flex min-h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] border-0 px-3 py-1.5 text-left font-sans text-[13.5px] font-extrabold text-soft-ink transition-colors duration-150 motion-reduce:transition-none ${on ? 'bg-soft' : 'bg-transparent hover:bg-soft'} ${focus}`}
                >
                  <span>{c.label}</span>
                  {on ? (
                    <span aria-hidden="true" className="text-primary">
                      ✓
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
