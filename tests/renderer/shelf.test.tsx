// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Shelf } from '../../src/renderer/src/shelf/Shelf'
import { EmptyState } from '../../src/renderer/src/shelf/EmptyState'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { LibrarySnapshot, ReadingView } from '../../src/shared/library/types'
import { fakeTide } from './setup'

function reading(over: Partial<ReadingView> & { id: string }): ReadingView {
  return {
    title: over.id,
    courseId: 'c1',
    pageCount: null,
    position: null,
    addedAt: 0,
    lastOpenedAt: null,
    finished: false,
    readEverything: false,
    fileName: `${over.id}.pdf`,
    missing: false,
    ...over
  }
}

function snapshot(readings: ReadingView[], collapsed: string[] = []): LibrarySnapshot {
  return {
    courses: [{ id: 'c1', name: 'PSYC 201' }],
    readings,
    settings: {} as LibrarySnapshot['settings'],
    ui: { collapsed, tipsSeen: [] }
  }
}

describe('Shelf', () => {
  it('clicking a course header collapses it and remembers it via setCollapsed', async () => {
    const t = fakeTide()
    setTide(t)
    render(
      <Shelf
        snapshot={snapshot([reading({ id: 'Memory' })])}
        selectedId={null}
        onOpen={() => {}}
        onAdd={() => {}}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'PSYC 201' }))
    expect(t.calls['library.setCollapsed']).toEqual([['c1', true]])
  })

  it('a collapsed course hides its readings and expanding calls setCollapsed false', async () => {
    const t = fakeTide()
    setTide(t)
    render(
      <Shelf
        snapshot={snapshot([reading({ id: 'Memory' })], ['c1'])}
        selectedId={null}
        onOpen={() => {}}
        onAdd={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /Memory/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'PSYC 201' }))
    expect(t.calls['library.setCollapsed']).toEqual([['c1', false]])
  })

  it('a "Finished (2)" row expands to show finished readings', async () => {
    setTide(fakeTide())
    render(
      <Shelf
        snapshot={snapshot([
          reading({ id: 'Live' }),
          reading({ id: 'Done one', finished: true }),
          reading({ id: 'Done two', finished: true })
        ])}
        selectedId={null}
        onOpen={() => {}}
        onAdd={() => {}}
      />
    )
    expect(screen.queryByText('Done one')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Finished (2)' }))
    expect(screen.getByText('Done one')).toBeTruthy()
    expect(screen.getByText('Done two')).toBeTruthy()
  })

  it('clicking a reading calls onOpen with its id and onPicked', async () => {
    setTide(fakeTide())
    const onOpen = vi.fn()
    const onPicked = vi.fn()
    render(
      <Shelf
        snapshot={snapshot([reading({ id: 'r1', title: 'Memory' })])}
        selectedId={null}
        onOpen={onOpen}
        onAdd={() => {}}
        onPicked={onPicked}
      />
    )
    const nav = screen.getByRole('navigation', { name: 'Readings' })
    await userEvent.click(within(nav).getByRole('button', { name: /Memory/ }))
    expect(onOpen).toHaveBeenCalledWith('r1')
    expect(onPicked).toHaveBeenCalledTimes(1)
  })

  it('the Add reading button calls onAdd; the selected row is marked current', async () => {
    setTide(fakeTide())
    const onAdd = vi.fn()
    render(
      <Shelf
        snapshot={snapshot([reading({ id: 'r1', title: 'Memory' })])}
        selectedId="r1"
        onOpen={() => {}}
        onAdd={onAdd}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add reading' }))
    expect(onAdd).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Memory/ }).getAttribute('aria-current')).toBe('true')
  })
})

describe('EmptyState', () => {
  it('the empty shelf shows the headline, the add button, and the Finder tip only on macOS', async () => {
    const onAdd = vi.fn()
    const { unmount } = render(<EmptyState onAdd={onAdd} platform="win32" />)
    expect(screen.getByRole('heading', { name: 'Your shelf is empty' })).toBeTruthy()
    expect(
      screen.getByText('Add a PDF from your course and Tide will read it to you in a calm voice.')
    ).toBeTruthy()
    expect(screen.queryByText(/Finder/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '＋ Add your first reading' }))
    expect(onAdd).toHaveBeenCalled()
    unmount()

    render(<EmptyState onAdd={() => {}} platform="darwin" />)
    expect(screen.getByText(/right-click any PDF in Finder/)).toBeTruthy()
  })
})
