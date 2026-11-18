import { useState } from 'react'
import { ChoiceDialog, ghostButton, primaryButton } from '../reading/ChoiceDialog'

type Props = { wrong: boolean; onCancel(): void; onOpen(password: string): void }

/** Asks for a PDF's password. It lives in this component's state only: never stored, never sent to main. */
export function PasswordDialog({ wrong, onCancel, onOpen }: Props): React.JSX.Element {
  const [password, setPassword] = useState('')
  return (
    <ChoiceDialog
      title="This PDF is locked with a password."
      onDismiss={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel} className={ghostButton}>
            Cancel
          </button>
          <button
            type="submit"
            form="pdf-password-form"
            disabled={password === ''}
            className={primaryButton}
          >
            Open
          </button>
        </>
      }
    >
      <form
        id="pdf-password-form"
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (password !== '') onOpen(password)
        }}
      >
        <label className="mb-1 block text-[13px] font-bold text-ink" htmlFor="pdf-password">
          Password
        </label>
        <input
          id="pdf-password"
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="box-border min-h-9 w-full rounded-xl border border-border bg-surface px-3 py-2 font-sans text-[14px] text-ink"
        />
        {wrong ? (
          <p role="alert" className="m-0 mt-2 text-[13px] font-semibold text-warn">
            That password didn&apos;t work. Try again.
          </p>
        ) : null}
      </form>
    </ChoiceDialog>
  )
}
