import { useState } from 'react'
import { ChoiceDialog, ghostButton, primaryButton } from './ChoiceDialog'

type Props = { title: string; onCancel(): void; onSave(title: string): void }

export function RenameDialog({ title, onCancel, onSave }: Props): React.JSX.Element {
  const [value, setValue] = useState(title)
  const trimmed = value.trim()
  const save = (): void => {
    if (trimmed !== '') onSave(trimmed)
  }
  return (
    <ChoiceDialog
      title="Rename reading"
      onDismiss={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel} className={ghostButton}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={trimmed === ''} className={primaryButton}>
            Save
          </button>
        </>
      }
    >
      <input
        autoFocus
        type="text"
        aria-label="Reading title"
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
        className="mt-3 min-h-9 w-full rounded-[11px] border-[1.5px] border-primary bg-bg px-3 py-2 font-sans text-[13px] text-ink"
      />
    </ChoiceDialog>
  )
}
