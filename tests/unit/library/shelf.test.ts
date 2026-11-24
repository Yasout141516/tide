import { describe, expect, it } from 'vitest'
import { groupShelf, nextReading, rowLabel } from '../../../src/shared/library/shelf'
import { OTHER, type LibrarySnapshot, type ReadingView } from '../../../src/shared/library/types'

function reading(over: Partial<ReadingView> & { id: string }): ReadingView {
  return {
    title: over.id,
    courseId: null,
    pageCount: null,
    position: null,
    addedAt: 0,
    lastOpenedAt: null,
    finished: false,
    readEverything: false,
    finishIn: null,
    fileName: `${over.id}.pdf`,
    missing: false,
    ...over
  }
}

function snap(
  courses: { id: string; name: string }[],
  readings: ReadingView[],
  collapsed: string[] = []
): LibrarySnapshot {
  return {
    courses,
    readings,
    settings: {} as LibrarySnapshot['settings'],
    exportFolder: { name: 'Tide', custom: false },
    ui: { collapsed, tipsSeen: [] }
  }
}

describe('groupShelf', () => {
  it('groups by course name with Other last and drops empty courses', () => {
    const s = snap(
      [
        { id: 'c2', name: 'soc 110' },
        { id: 'c1', name: 'PSYC 201' },
        { id: 'c3', name: 'Empty course' }
      ],
      [
        reading({ id: 'a', courseId: 'c2' }),
        reading({ id: 'b', courseId: 'c1' }),
        reading({ id: 'o' })
      ],
      [OTHER]
    )
    const groups = groupShelf(s)
    expect(groups.map((g) => g.name)).toEqual(['PSYC 201', 'soc 110', 'Other'])
    expect(groups[2].key).toBe(OTHER)
    expect(groups[2].collapsed).toBe(true)
    expect(groups[0].collapsed).toBe(false)
  })

  it('orders readings by last opened, then added, newest first', () => {
    const s = snap(
      [{ id: 'c1', name: 'A' }],
      [
        reading({ id: 'old', courseId: 'c1', addedAt: 10 }),
        reading({ id: 'opened', courseId: 'c1', addedAt: 1, lastOpenedAt: 50 }),
        reading({ id: 'new', courseId: 'c1', addedAt: 30 })
      ]
    )
    expect(groupShelf(s)[0].active.map((r) => r.id)).toEqual(['opened', 'new', 'old'])
  })

  it('folds finished readings into their course', () => {
    const s = snap(
      [{ id: 'c1', name: 'A' }],
      [
        reading({ id: 'x', courseId: 'c1' }),
        reading({ id: 'done', courseId: 'c1', finished: true })
      ]
    )
    const [g] = groupShelf(s)
    expect(g.active.map((r) => r.id)).toEqual(['x'])
    expect(g.finished.map((r) => r.id)).toEqual(['done'])
  })

  it('puts readings whose course no longer exists under Other', () => {
    const s = snap([], [reading({ id: 'x', courseId: 'gone' })])
    expect(groupShelf(s).map((g) => g.key)).toEqual([OTHER])
  })
})

describe('rowLabel', () => {
  it('row labels: File moved · Find it / Finished / New / Page 4 of 22 / Page 4', () => {
    const pos = { page: 4, textItemIndex: 0, charOffset: 0 }
    expect(rowLabel(reading({ id: 'a', missing: true, finished: true }))).toBe(
      'File moved · Find it'
    )
    expect(rowLabel(reading({ id: 'a', finished: true }))).toBe('Finished')
    expect(rowLabel(reading({ id: 'a' }))).toBe('New')
    expect(rowLabel(reading({ id: 'a', position: pos, pageCount: 22 }))).toBe('Page 4 of 22')
    expect(rowLabel(reading({ id: 'a', position: pos }))).toBe('Page 4')
  })
})

describe('nextReading', () => {
  const courses = [{ id: 'c1', name: 'Psych' }]
  const mk = (id: string, at: number, over: Partial<ReadingView> = {}): ReadingView =>
    reading({ id, courseId: 'c1', addedAt: at, ...over })

  it('picks the next unfinished reading in the same course, wrapping to earlier ones', () => {
    // Active order is newest first: c, b, a.
    const s = snap(courses, [mk('a', 1), mk('b', 2), mk('c', 3)])
    expect(nextReading(s, 'c')?.id).toBe('b')
    expect(nextReading(s, 'b')?.id).toBe('a')
    // Last in order: wraps to the first unfinished one before it.
    expect(nextReading(s, 'a')?.id).toBe('c')
    // Finished ones are skipped.
    const s2 = snap(courses, [mk('a', 1), mk('b', 2, { finished: true }), mk('c', 3)])
    expect(nextReading(s2, 'c')?.id).toBe('a')
  })

  it('is null when every other reading in the course is finished', () => {
    const s = snap(courses, [mk('a', 1), mk('b', 2, { finished: true })])
    expect(nextReading(s, 'a')).toBeNull()
    // The current reading itself may be finished already (just marked): still looks around it.
    const s2 = snap(courses, [mk('a', 1, { finished: true }), mk('b', 2, { finished: true })])
    expect(nextReading(s2, 'a')).toBeNull()
  })

  it('never offers a reading whose file has moved', () => {
    const s = snap(courses, [mk('a', 1), mk('b', 2, { missing: true }), mk('c', 3)])
    expect(nextReading(s, 'c')?.id).toBe('a')
    const only = snap(courses, [mk('a', 1), mk('b', 2, { missing: true })])
    expect(nextReading(only, 'a')).toBeNull()
  })
})
