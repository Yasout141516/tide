import { ChoiceDialog, ghostButton, primaryButton } from './ChoiceDialog'

type Props = { title: string; onKeep(): void; onRemove(): void }

/** Asks before taking a reading off the shelf; the PDF file itself is never touched. */
export function RemoveDialog({ title, onKeep, onRemove }: Props): React.JSX.Element {
  return (
    <ChoiceDialog
      title={`Remove “${title}” from your shelf?`}
      body="The PDF file itself stays where it is."
      onDismiss={onKeep}
      actions={
        <>
          <button type="button" onClick={onKeep} className={ghostButton}>
            Keep
          </button>
          <button type="button" onClick={onRemove} className={primaryButton}>
            Remove
          </button>
        </>
      }
    />
  )
}
