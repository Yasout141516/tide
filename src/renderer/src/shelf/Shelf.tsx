import { useState } from 'react'
import type { LibrarySnapshot, ReadingId } from '../../../shared/library/types'
import { groupShelf, type ShelfGroup } from '../../../shared/library/shelf'
import { tide } from '../lib/tide'
import { badgeColour, badgeLabel } from '../theme/badges'
import { useTheme } from '../theme/theme'
import { ShelfRow } from './ShelfRow'

type Props = {
  snapshot: LibrarySnapshot
  selectedId: ReadingId | null
  onOpen(id: ReadingId): void
  onAdd(): void
  /** Called after a reading is picked (closes the narrow-window overlay). */
  onPicked?(): void
  /** Opens Settings (the narrow-window overlay closes itself first). */
  onSettings?(): void
}

export function Shelf({
  snapshot,
  selectedId,
  onOpen,
  onAdd,
  onPicked,
  onSettings
}: Props): React.JSX.Element {
  // Which "Finished (N)" folds are open. Local on purpose: not saved, collapsed again next launch.
  const { resolved } = useTheme()
  const [openFinished, setOpenFinished] = useState<ReadonlySet<string>>(new Set())
  const toggleFinished = (key: string): void =>
    setOpenFinished((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const pick = (id: ReadingId): void => {
    onOpen(id)
    onPicked?.()
  }

  const row = (r: ShelfGroup['active'][number]): React.JSX.Element => (
    <ShelfRow key={r.id} reading={r} selected={r.id === selectedId} onOpen={() => pick(r.id)} />
  )

  return (
    <>
      <button
        type="button"
        onClick={onAdd}
        className="pq-add mb-3.5 flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-primary px-3 py-[11px] font-sans text-sm font-extrabold text-on-primary"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        Add reading
      </button>
      <nav aria-label="Readings" className="min-h-0 flex-1 overflow-y-auto">
        {groupShelf(snapshot).map((g, gi) => {
          const badge = badgeColour(resolved, gi)
          return (
            <section key={g.key}>
              <button
                type="button"
                aria-expanded={!g.collapsed}
                data-course-heading
                onClick={() => void tide().library.setCollapsed(g.key, !g.collapsed)}
                className="pq-course mx-1.5 mt-3 mb-1 flex min-h-9 w-[calc(100%-12px)] cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-sans text-[11px] font-extrabold tracking-[1px] text-muted uppercase"
              >
                <span aria-hidden="true">{g.collapsed ? '▸' : '▾'}</span>
                {badge ? (
                  <i
                    data-course-badge
                    aria-hidden="true"
                    className="pq-badge"
                    style={{ backgroundColor: badge, color: 'var(--badge-ink)' }}
                  >
                    {badgeLabel(g.name)}
                  </i>
                ) : null}
                {g.name}
              </button>
              {g.collapsed ? null : (
                <>
                  {g.active.map(row)}
                  {g.finished.length > 0 ? (
                    <>
                      <button
                        type="button"
                        aria-expanded={openFinished.has(g.key)}
                        onClick={() => toggleFinished(g.key)}
                        className="block min-h-9 w-full cursor-pointer rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left font-sans text-xs font-bold text-muted"
                      >
                        Finished ({g.finished.length})
                      </button>
                      {openFinished.has(g.key) ? g.finished.map(row) : null}
                    </>
                  ) : null}
                </>
              )}
            </section>
          )
        })}
      </nav>
      {onSettings ? (
        <button
          type="button"
          onClick={onSettings}
          className="mt-2 flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left font-sans text-[13px] font-bold text-muted"
        >
          <span aria-hidden="true">⚙</span> Settings
        </button>
      ) : null}
    </>
  )
}
