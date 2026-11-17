import { useState } from 'react'
import { libraryErrorCode } from '../../../shared/ipc-types'
import type { ReadingView } from '../../../shared/library/types'
import { tide } from '../lib/tide'
import { MessageDialog } from '../add/MessageDialog'
import { ChoiceDialog, ghostButton, primaryButton } from './ChoiceDialog'
import { RemoveDialog } from './RemoveDialog'

type Props = {
  reading: ReadingView
  /** `opened` is true when the file was found and the reading should open. */
  onDone(opened: boolean): void
}

type View =
  | { kind: 'ask' }
  | { kind: 'different'; pickId: string }
  | { kind: 'remove' }
  | { kind: 'message'; title: string; body?: string }

const ON_SHELF: View = { kind: 'message', title: 'That file is already on your shelf.' }
const FAILED: View = {
  kind: 'message',
  title: "Tide couldn't use that file.",
  body: 'Please try again.'
}

const REMOVE_FAILED: View = {
  kind: 'message',
  title: "Tide couldn't remove that reading.",
  body: 'Please try again.'
}

/** Shown when she picks a reading whose PDF can't be found; Find the file points the reading at it again. */
export function FileMovedDialog({ reading, onDone }: Props): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'ask' })
  const [busy, setBusy] = useState(false)
  const page = reading.position?.page

  const find = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const r = await tide().library.findFile(reading.id)
      if (r.kind === 'relinked') return onDone(true)
      if (r.kind === 'different') setView({ kind: 'different', pickId: r.pickId })
    } catch {
      setView(FAILED)
    } finally {
      setBusy(false)
    }
  }

  const acceptDifferent = async (pickId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await tide().library.useDifferentFile(reading.id, pickId)
      onDone(true)
    } catch (err) {
      setView(libraryErrorCode(err) === 'already-on-shelf' ? ON_SHELF : FAILED)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await tide().library.remove(reading.id)
      onDone(false)
    } catch {
      setView(REMOVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  if (view.kind === 'message')
    return <MessageDialog title={view.title} body={view.body} onClose={() => onDone(false)} />
  if (view.kind === 'remove')
    return (
      <RemoveDialog
        title={reading.title}
        onKeep={() => setView({ kind: 'ask' })}
        onRemove={() => void remove()}
      />
    )
  if (view.kind === 'different') {
    const { pickId } = view
    return (
      <ChoiceDialog
        title="This looks like a different file. Use it anyway?"
        body="Your place in this reading will start again from the beginning."
        onDismiss={() => setView({ kind: 'ask' })}
        actions={
          <>
            <button type="button" onClick={() => setView({ kind: 'ask' })} className={ghostButton}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void acceptDifferent(pickId)}
              className={primaryButton}
            >
              Use it anyway
            </button>
          </>
        }
      />
    )
  }
  return (
    <ChoiceDialog
      tile="?"
      title="Where did this one go?"
      body={
        <>
          We can&apos;t find <b className="text-ink">{reading.title}</b>. It may have been moved,
          renamed or deleted.{' '}
          {page !== undefined ? (
            <>
              Point us to it and you&apos;ll carry on from <b className="text-ink">page {page}</b>.
            </>
          ) : (
            'Point us to it and it will open from the start.'
          )}
        </>
      }
      onDismiss={() => onDone(false)}
      spread
      actions={
        <>
          <button type="button" onClick={() => setView({ kind: 'remove' })} className={ghostButton}>
            Remove from shelf
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void find()}
            className={primaryButton}
          >
            Find the file
          </button>
        </>
      }
    />
  )
}
