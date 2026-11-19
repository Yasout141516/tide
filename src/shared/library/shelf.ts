// Pure shelf grouping and row labels (renderer shelf and tests). No DOM, no IPC.
import { OTHER, type Course, type LibrarySnapshot, type ReadingId, type ReadingView } from './types'

export interface ShelfGroup {
  key: string
  name: string
  collapsed: boolean
  active: ReadingView[]
  finished: ReadingView[]
}

/** Courses alphabetical, case-insensitive: the order of the shelf and of the course picker. */
export function sortCourses(courses: Course[]): Course[] {
  return [...courses].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

const recency = (r: ReadingView): number => r.lastOpenedAt ?? r.addedAt

/** Courses alphabetical (case-insensitive), "Other" last; empty groups omitted; newest reading first. */
export function groupShelf(s: LibrarySnapshot): ShelfGroup[] {
  const known = new Set(s.courses.map((c) => c.id))
  const collapsed = new Set(s.ui.collapsed)
  const byKey = new Map<string, ReadingView[]>()
  for (const r of s.readings) {
    const key = r.courseId !== null && known.has(r.courseId) ? r.courseId : OTHER
    const list = byKey.get(key)
    if (list) list.push(r)
    else byKey.set(key, [r])
  }
  const make = (key: string, name: string): ShelfGroup | null => {
    const all = byKey.get(key)
    if (!all || all.length === 0) return null
    const sorted = [...all].sort((a, b) => recency(b) - recency(a))
    return {
      key,
      name,
      collapsed: collapsed.has(key),
      active: sorted.filter((r) => !r.finished),
      finished: sorted.filter((r) => r.finished)
    }
  }
  const groups = sortCourses(s.courses).map((c) => make(c.id, c.name))
  groups.push(make(OTHER, 'Other'))
  return groups.filter((g): g is ShelfGroup => g !== null)
}

/** The small second line under a reading's title. (M4 adds "Playing · ".) */
export function rowLabel(r: ReadingView): string {
  if (r.missing) return 'File moved · Find it'
  if (r.finished) return 'Finished'
  if (!r.position) return 'New'
  return r.pageCount !== null
    ? `Page ${r.position.page} of ${r.pageCount}`
    : `Page ${r.position.page}`
}

/**
 * The reading to offer after `currentId`: the first unfinished one after it in its course's shelf
 * order (newest first), else the first unfinished one before it; null if there is none. The current
 * reading keeps its place in that order even once it is marked finished.
 */
export function nextReading(s: LibrarySnapshot, currentId: ReadingId): ReadingView | null {
  const group = groupShelf(s).find(
    (g) => g.active.some((r) => r.id === currentId) || g.finished.some((r) => r.id === currentId)
  )
  if (!group) return null
  const order = [...group.active, ...group.finished].sort((a, b) => recency(b) - recency(a))
  const at = order.findIndex((r) => r.id === currentId)
  const open = (r: ReadingView): boolean => !r.finished && r.id !== currentId
  return order.slice(at + 1).find(open) ?? order.slice(0, at).find(open) ?? null
}
