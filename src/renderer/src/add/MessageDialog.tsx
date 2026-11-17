import * as Dialog from '@radix-ui/react-dialog'

type Props = { title: string; body?: string; onClose(): void }

/** A short notice with one "OK" button. */
export function MessageDialog({ title, body, onClose }: Props): React.JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content
          {...(body ? {} : { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 w-[calc(100%-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-surface p-[22px] text-ink shadow-[0_24px_50px_var(--shadow)]"
        >
          <Dialog.Title className="m-0 mb-1 font-display text-xl font-bold text-ink">
            {title}
          </Dialog.Title>
          {body ? (
            <Dialog.Description className="m-0 text-[13px] leading-[1.45] text-muted">
              {body}
            </Dialog.Description>
          ) : null}
          <div className="mt-[18px] flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-on-primary"
            >
              OK
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
