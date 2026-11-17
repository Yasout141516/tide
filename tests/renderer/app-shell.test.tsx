// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../../src/renderer/src/shell/AppShell'
import { setNarrow } from './setup'

function renderShell(): void {
  render(
    <AppShell
      renderShelf={(closeOverlay) => (
        <nav aria-label="Readings">
          <button onClick={closeOverlay}>Pick a reading</button>
        </nav>
      )}
      stage={<p>The page</p>}
      player={<footer aria-label="Player">player</footer>}
    />
  )
}

describe('AppShell', () => {
  it('wide window: shelf is visible beside the stage, no Shelf button', () => {
    setNarrow(false)
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Readings' })).toBeTruthy()
    expect(screen.getByText('The page')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Shelf' })).toBeNull()
  })

  it('narrow window: shelf hides behind a "Shelf" button that opens it over the page', async () => {
    setNarrow(true)
    renderShell()
    expect(screen.queryByRole('navigation', { name: 'Readings' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Shelf' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Readings' })).toBeTruthy()
  })

  it('narrow window: the overlay closes on Escape', async () => {
    setNarrow(true)
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Shelf' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('picking a reading in the narrow-window shelf overlay closes the overlay', async () => {
    setNarrow(true)
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Shelf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pick a reading' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the wordmark is a level-1 heading "Tide"', () => {
    renderShell()
    expect(screen.getByRole('heading', { level: 1, name: 'Tide' })).toBeTruthy()
  })
})

function Counter(): React.JSX.Element {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>count {n}</button>
}

describe('AppShell across the breakpoint', () => {
  it('keeps stage state across wide -> narrow -> wide', async () => {
    setNarrow(false)
    render(
      <AppShell
        renderShelf={() => <nav aria-label="Readings" />}
        stage={<Counter />}
        player={<footer aria-label="Player" />}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'count 0' }))
    act(() => setNarrow(true))
    expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy()
    act(() => setNarrow(false))
    expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy()
  })

  it('an open overlay does not come back after widening and narrowing again', async () => {
    setNarrow(true)
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Shelf' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => setNarrow(false))
    act(() => setNarrow(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
