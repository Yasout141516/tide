import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

type Props = {
  title: string
  body?: ReactNode
  /** A small tile above the title (the File moved "?"). */
  tile?: ReactNode
  /** Esc / click outside. */
  onDismiss(): void
  children?: ReactNode
  actions: ReactNode
  /** Space the actions apart (ghost on the left, primary on the right). */
  spread?: boolean
}

export const ghostButton =
  'min-h-9 cursor-pointer rounded-[11px] border-0 bg-transparent px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-muted disabled:cursor-default disabled:opacity-60'
export const primaryButton =
  'min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-on-primary disabled:cursor-default disabled:opacity-60'

/** The shared frame of the reading dialogs: optional tile, title, sentence, content and actions. */
export function ChoiceDialog({
  title,
  body,
  tile,
  onDismiss,
  children,
  actions,
  spread
}: Props): React.JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onDismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content
          {...(body ? {} : { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 w-[calc(100%-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-surface p-[22px] text-ink shadow-[0_24px_50px_var(--shadow)]"
        >
          {tile ? (
            <div
              aria-hidden="true"
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-warn-soft text-[22px] font-extrabold text-warn"
            >
              {tile}
            </div>
          ) : null}
          <Dialog.Title className="m-0 mb-1 font-display text-xl font-bold text-ink">
            {title}
          </Dialog.Title>
          {body ? (
            <Dialog.Description className="m-0 text-[13px] leading-[1.45] text-muted">
              {body}
            </Dialog.Description>
          ) : null}
          {children}
          <div className={`mt-[18px] flex gap-2.5 ${spread ? 'justify-between' : 'justify-end'}`}>
            {actions}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
