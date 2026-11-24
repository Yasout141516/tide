// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PlayerDepsProvider, PlayerProvider } from '../../src/renderer/src/player/PlayerContext'
import { ReaderDepsProvider } from '../../src/renderer/src/reader/deps'
import { ReaderStateProvider } from '../../src/renderer/src/reader/ReaderState'
import { ReaderView } from '../../src/renderer/src/reader/ReaderView'
import { ToastProvider } from '../../src/renderer/src/shell/Toast'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { LibrarySnapshot, ReadingView } from '../../src/shared/library/types'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import type { PageText } from '../../src/shared/text/types'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp } from './reader-fakes'
import { fakeTide } from './setup'

const reading: ReadingView = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 3,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null,
  fileName: 'r1.pdf',
  missing: false
}

// jsdom has no layout: a selection's box is a fixed one near the top of the viewport.
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 120,
      left: 80,
      right: 300,
      width: 220,
      height: 20,
      x: 80,
      y: 100
    }) as DOMRect
})
afterEach(() => window.getSelection()?.removeAllRanges())

/** Body text plus a page number at the foot of every page: skipped by the default filters. */
const pagesWithFooter = (): PageText[] =>
  bodyPages(3).map((p) => ({
    ...p,
    items: [
      ...p.items,
      { page: p.page, index: 2, str: String(p.page), x: 300, y: 770, width: 6, fontSize: 10 }
    ]
  }))

async function open(
  tipsSeen: string[] = ['select-text'],
  pages: PageText[] = bodyPages(3)
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide({
    snapshot: {
      readings: [reading],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: 1 },
      ui: { collapsed: [], tipsSeen }
    }
  })
  setTide(t)
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(pages) }))
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitFor(() =>
    expect(document.querySelector('[data-page="1"] [data-item-index]')).toBeTruthy()
  )
  await waitFor(
    () => expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy(),
    {
      timeout: 10_000
    }
  )
  return t
}

const item = (i: number): Node =>
  document.querySelector(`[data-page="1"] [data-item-index="${i}"]`)!.firstChild!
function select(from: number, to: number): void {
  const a = item(from)
  const b = item(to)
  window.getSelection()!.setBaseAndExtent(a, 2, b, 5)
  fireEvent(document, new Event('selectionchange'))
}
const readButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'Read from here' })
const saveButton = (): HTMLElement | null => screen.queryByRole('button', { name: 'Save as audio' })

describe('Selection bubble', () => {
  it('selecting spoken text shows the bubble with Read from here and Save as audio', async () => {
    await open()
    expect(readButton()).toBeNull()
    select(0, 0)
    await waitFor(() => expect(readButton()).toBeTruthy())
    expect(saveButton()).toBeTruthy()
  })

  it('no bubble for a selection with no spoken sentences', async () => {
    await open(['select-text'], pagesWithFooter())
    window.getSelection()!.setBaseAndExtent(item(2), 0, item(2), 1)
    fireEvent(document, new Event('selectionchange'))
    await new Promise((r) => setTimeout(r, 50))
    expect(readButton()).toBeNull()
  })

  it('Read from here plays from the first selected sentence', async () => {
    await open()
    select(1, 1)
    await userEvent.click(await screen.findByRole('button', { name: 'Read from here' }))
    await waitFor(() => expect(document.querySelector('[data-sentence-id="1"]')).toBeTruthy())
    expect(readButton()).toBeNull()
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  it('Save as audio reports the snapped sentence range', async () => {
    const saved: Array<[number, number]> = []
    setTide(fakeTide())
    const snapshot: LibrarySnapshot = {
      readings: [reading],
      courses: [],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: 1 },
      ui: { collapsed: [], tipsSeen: ['select-text'] }
    }
    render(
      <PlayerDepsProvider value={fakePlayer().deps}>
        <ReaderDepsProvider value={fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(3)) })}>
          <ReaderStateProvider>
            <ToastProvider>
              <PlayerProvider
                reading={reading}
                courseName={null}
                snapshot={snapshot}
                onPlayNext={() => {}}
              >
                <ReaderView
                  reading={reading}
                  snapshot={snapshot}
                  onClose={() => {}}
                  onSaveSelection={(r) => saved.push(r)}
                />
              </PlayerProvider>
            </ToastProvider>
          </ReaderStateProvider>
        </ReaderDepsProvider>
      </PlayerDepsProvider>
    )
    await waitFor(
      () => expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy(),
      {
        timeout: 10_000
      }
    )
    await waitFor(() =>
      expect(document.querySelector('[data-page="1"] [data-item-index]')).toBeTruthy()
    )
    select(0, 1)
    await userEvent.click(await screen.findByRole('button', { name: 'Save as audio' }))
    expect(saved).toEqual([[0, 1]])
    expect(saveButton()).toBeNull()
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  it('Escape hides the bubble', async () => {
    await open()
    select(0, 0)
    await screen.findByRole('button', { name: 'Read from here' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(readButton()).toBeNull())
  })

  it('the tip shows once and Got it records it', async () => {
    const t = await open([])
    expect(screen.getByText('Select any text to read from there or save it as audio.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(t.calls['library.tipSeen']).toEqual([['select-text']])
    await waitFor(() => expect(screen.queryByText(/Select any text/)).toBeNull())
  })

  it('a first selection also records the tip', async () => {
    const t = await open([])
    select(0, 0)
    await screen.findByRole('button', { name: 'Read from here' })
    expect(t.calls['library.tipSeen']).toEqual([['select-text']])
    await waitFor(() => expect(screen.queryByText(/Select any text/)).toBeNull())
  })
})
