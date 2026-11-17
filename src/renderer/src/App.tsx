import { useState } from 'react'
import type { ReadingId } from '../../shared/library/types'
import { AppShell } from './shell/AppShell'
import { PlayerBarPlaceholder } from './shell/PlayerBarPlaceholder'
import { Shelf } from './shelf/Shelf'
import { EmptyState } from './shelf/EmptyState'
import { useLibrary } from './state/useLibrary'
import { tide } from './lib/tide'

function App(): React.JSX.Element {
  // useLibrary also calls tide().ready() once the first snapshot has loaded.
  const library = useLibrary()
  const [selectedId, setSelectedId] = useState<ReadingId | null>(null)

  // Task 7 wires the real add flow; until then the button is present but inert.
  const add = (): void => {}
  // Opening a reading stamps `opened` exactly once, here (later tasks must not stamp it again).
  // Only a change of selection stamps it, and never for a missing file (Task 9's Find-it flow owns that).
  const open = (id: ReadingId): void => {
    if (id === selectedId) return
    setSelectedId(id)
    if (library?.readings.find((r) => r.id === id)?.missing) return
    void tide().library.update(id, { opened: true })
  }

  const selected = library?.readings.find((r) => r.id === selectedId) ?? null

  let stage: React.JSX.Element
  if (!library) stage = <main className="h-full" />
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
  )
}

export default App
