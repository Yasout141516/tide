import { useEffect, useRef, useState } from 'react'
import type { ReadingId } from '../../shared/library/types'
import { AppShell } from './shell/AppShell'
import { PlayerBarPlaceholder } from './shell/PlayerBarPlaceholder'
import { Shelf } from './shelf/Shelf'
import { EmptyState } from './shelf/EmptyState'
import { useLibrary, useLibraryLoadFailed } from './state/useLibrary'
import { tide } from './lib/tide'
import { useAddReading } from './add/useAddReading'
import { MessageDialog } from './add/MessageDialog'
import { ReaderHeader } from './reading/ReaderHeader'
import { ReadingMenu } from './reading/ReadingMenu'
import { FileMovedDialog } from './reading/FileMovedDialog'
import { RenameDialog } from './reading/RenameDialog'
import { RemoveDialog } from './reading/RemoveDialog'

function App(): React.JSX.Element {
  // useLibrary also calls tide().ready() once the first snapshot has loaded.
  const library = useLibrary()
  const loadFailed = useLibraryLoadFailed()
  const [selectedId, setSelectedId] = useState<ReadingId | null>(null)
  // The reading whose open has been stamped; a selected-but-missing reading is not in it yet.
  const stampedId = useRef<ReadingId | null>(null)

  // The reading whose File moved / rename / remove dialog is showing.
  const [dialog, setDialog] = useState<{
    kind: 'moved' | 'rename' | 'remove'
    id: ReadingId
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Opening a reading stamps `opened` exactly once, here (later tasks must not stamp it again).
  // Stamp once per selection. A missing file is never stamped: it asks "Where did this one go?" instead,
  // and stamps when Find the file succeeds (`opened`).
  const stamp = (id: ReadingId): void => {
    setSelectedId(id)
    stampedId.current = id
    void tide().library.update(id, { opened: true })
  }
  const open = (id: ReadingId): void => {
    if (library?.readings.find((r) => r.id === id)?.missing) {
      // The selection stays where it is; only a successful Find it selects (and stamps) this reading.
      setDialog({ kind: 'moved', id })
      return
    }
    if (id === stampedId.current) return
    stamp(id)
  }

  const adding = useAddReading(open)
  const add = adding.start
  // Menu commands. `start` is read through a ref so the subscription is made once.
  const startRef = useRef(adding.start)
  const pickRef = useRef(adding.handlePick)
  const failedRef = useRef(adding.openFailed)
  useEffect(() => {
    startRef.current = adding.start
    pickRef.current = adding.handlePick
    failedRef.current = adding.openFailed
  })
  useEffect(
    () =>
      tide().onCommand((c) => {
        if (c.type === 'add-reading') startRef.current()
        // A PDF opened from Finder / Explorer: a new file asks for a course, a known one opens.
        else if (c.type === 'open-pick') pickRef.current(c.pick)
        else if (c.type === 'open-failed') failedRef.current()
      }),
    []
  )

  // Derived from the library, so a removed reading is never selected (ids are never reused).
  const selected = library?.readings.find((r) => r.id === selectedId) ?? null

  const target = dialog ? library?.readings.find((r) => r.id === dialog.id) : undefined
  const closeDialog = (): void => setDialog(null)
  const removeReading = async (id: ReadingId): Promise<void> => {
    closeDialog()
    try {
      await tide().library.remove(id)
    } catch {
      setNotice("Tide couldn't remove that reading.")
    }
  }
  let dialogUi: React.JSX.Element | null = null
  if (dialog && target) {
    if (dialog.kind === 'moved')
      dialogUi = (
        <FileMovedDialog
          key={dialog.id}
          reading={target}
          onDone={(opened) => {
            closeDialog()
            if (opened) stamp(dialog.id)
          }}
        />
      )
    else if (dialog.kind === 'rename')
      dialogUi = (
        <RenameDialog
          title={target.title}
          onCancel={closeDialog}
          onSave={(title) => {
            closeDialog()
            tide()
              .library.update(dialog.id, { title })
              .catch(() => setNotice("Tide couldn't rename that reading."))
          }}
        />
      )
    else
      dialogUi = (
        <RemoveDialog
          title={target.title}
          onKeep={closeDialog}
          onRemove={() => void removeReading(dialog.id)}
        />
      )
  }

  let stage: React.JSX.Element
  if (!library && loadFailed)
    stage = (
      <main className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="m-0 font-display text-xl font-bold text-ink">
          Tide couldn&apos;t open your shelf
        </h2>
        <p className="m-0 max-w-md text-sm text-muted">
          Your readings file has been left untouched. Close Tide and open it again.
        </p>
      </main>
    )
  else if (!library) stage = <main className="h-full" />
  else if (library.readings.length === 0)
    stage = (
      <main className="h-full">
        <EmptyState onAdd={add} platform={tide().platform} />
      </main>
    )
  else if (selected)
    // Until M3 the stage shows the selected reading's header only.
    stage = (
      <main className="flex h-full flex-col">
        <ReaderHeader
          reading={selected}
          courseName={library.courses.find((c) => c.id === selected.courseId)?.name ?? null}
          page={selected.position?.page ?? null}
          menu={
            <ReadingMenu
              reading={selected}
              onRename={() => setDialog({ kind: 'rename', id: selected.id })}
              onRemove={() => setDialog({ kind: 'remove', id: selected.id })}
            />
          }
        />
      </main>
    )
  else
    stage = (
      <main className="flex h-full items-center justify-center p-8">
        <p className="m-0 text-sm text-muted">Pick a reading from your shelf to carry on.</p>
      </main>
    )

  return (
    <>
      <AppShell
        renderShelf={(closeOverlay) =>
          library ? (
            <Shelf
              snapshot={library}
              selectedId={selectedId}
              onOpen={open}
              onAdd={add}
              onPicked={closeOverlay}
            />
          ) : (
            <nav aria-label="Readings" className="flex-1" />
          )
        }
        stage={stage}
        player={<PlayerBarPlaceholder />}
      />
      {adding.ui}
      {dialogUi}
      {notice ? <MessageDialog title={notice} onClose={() => setNotice(null)} /> : null}
    </>
  )
}

export default App
