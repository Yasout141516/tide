import { useEffect, useRef, useState } from 'react'
import type { ReadingId } from '../../shared/library/types'
import { AppShell } from './shell/AppShell'
import { PlayerBarPlaceholder } from './shell/PlayerBarPlaceholder'
import { Shelf } from './shelf/Shelf'
import { EmptyState } from './shelf/EmptyState'
import { useLibrary, useLibraryLoadFailed } from './state/useLibrary'
import { tide } from './lib/tide'
import { useAddReading } from './add/useAddReading'

function App(): React.JSX.Element {
  // useLibrary also calls tide().ready() once the first snapshot has loaded.
  const library = useLibrary()
  const loadFailed = useLibraryLoadFailed()
  const [selectedId, setSelectedId] = useState<ReadingId | null>(null)
  // The reading whose open has been stamped; a selected-but-missing reading is not in it yet.
  const stampedId = useRef<ReadingId | null>(null)

  // Opening a reading stamps `opened` exactly once, here (later tasks must not stamp it again).
  // Stamp once per selection, never for a missing file (Task 9's Find-it flow owns that); a selected
  // reading that stops being missing is stamped on its next click.
  const open = (id: ReadingId): void => {
    if (id === stampedId.current) return
    setSelectedId(id)
    if (library?.readings.find((r) => r.id === id)?.missing) {
      stampedId.current = null
      return
    }
    stampedId.current = id
    void tide().library.update(id, { opened: true })
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

  const selected = library?.readings.find((r) => r.id === selectedId) ?? null

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
    // Until Task 9 the stage shows the selected reading's title.
    stage = (
      <main className="flex h-full items-center justify-center p-8">
        <h2 className="m-0 font-display text-2xl font-bold text-ink">{selected.title}</h2>
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
    </>
  )
}

export default App
