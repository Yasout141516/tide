import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Wordmark } from './Wordmark'
import { useMediaQuery } from './useMediaQuery'

export const NARROW_QUERY = '(max-width: 1099px)'

type Props = {
  /** The shelf calls closeOverlay() after a pick; it closes the narrow-window overlay (no-op when wide). */
  renderShelf: (closeOverlay: () => void) => ReactNode
  stage: ReactNode
  player: ReactNode
}

const STAGE_BG = 'bg-linear-to-b from-stage-a from-0% via-stage-b via-55% to-stage-c'

export function AppShell({ renderShelf, stage, player }: Props): React.JSX.Element {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)

  if (narrow) {
    return (
      <div className="grid h-full grid-cols-[1fr] grid-rows-[1fr_auto]">
        <div className={`flex min-h-0 flex-col ${STAGE_BG}`}>
          <div className="flex items-center gap-4 px-5 pt-3">
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <Dialog.Trigger className="min-h-9 cursor-pointer rounded-xl border-0 bg-soft px-3.5 text-[13.5px] font-extrabold text-soft-ink">
                Shelf
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="shelf-overlay fixed inset-0 bg-scrim" />
                <Dialog.Content
                  aria-describedby={undefined}
                  className="shelf-panel fixed inset-y-0 left-0 flex w-[260px] flex-col border-r border-border bg-linear-to-b from-shelf-a to-shelf-b p-3 text-ink shadow-[0_0_40px_var(--shadow)]"
                >
                  <Dialog.Title className="sr-only">Shelf</Dialog.Title>
                  {renderShelf(close)}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Wordmark />
          </div>
          <div className="min-h-0 flex-1">{stage}</div>
        </div>
        {player}
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-[240px_1fr] grid-rows-[1fr_auto]">
      <aside className="row-span-2 flex min-h-0 flex-col border-r border-border bg-linear-to-b from-shelf-a to-shelf-b px-3 py-4">
        <div className="mb-3.5">
          <Wordmark />
        </div>
        {renderShelf(close)}
      </aside>
      <div className={`min-h-0 ${STAGE_BG}`}>{stage}</div>
      {player}
    </div>
  )
}
