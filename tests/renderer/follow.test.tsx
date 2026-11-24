// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ReadingView } from '../../src/shared/library/types'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import type { PageText } from '../../src/shared/text/types'
import {
  bodyPages,
  fakeDeps,
  fakeDoc,
  fakePlayer,
  PAGE_W,
  renderApp,
  SILENCE
} from './reader-fakes'
import { fakeTide } from './setup'

const reading: ReadingView = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 4,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null,
  fileName: 'r1.pdf',
  missing: false
}
const SCALE = 820 / PAGE_W
const STAGE = { top: 0, bottom: 900 }

/** Where jsdom (which has no layout) should say the highlighted line is, in stage pixels. */
let lineTop = 450
const realRect = Element.prototype.getBoundingClientRect
const realScroll = Element.prototype.scrollIntoView
let scrolls: Array<{ el: Element; arg: unknown }>

function box(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 0,
    x: 0,
    y: top,
    width: 0,
    height: bottom - top,
    toJSON: () => ({})
  }
}

beforeEach(() => {
  lineTop = 450
  scrolls = []
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.getAttribute('data-testid') === 'sentence-highlight') return box(lineTop, lineTop + 20)
    if (this.classList.contains('overflow-y-auto')) return box(STAGE.top, STAGE.bottom)
    return realRect.call(this)
  }
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    scrolls.push({ el: this, arg })
  }
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  Element.prototype.scrollIntoView = realScroll
})

async function open(pages: PageText[]): Promise<void> {
  const t = fakeTide({
    snapshot: {
      readings: [{ ...reading, pageCount: pages.length }],
      settings: {
        reading: DEFAULT_FILTERS,
        zoom: 1,
        voice: 'bf_emma',
        speed: 1,
        theme: 'sky-sea',
        darkPages: true,
        pronunciations: []
      }
    }
  })
  setTide(t)
  t.tts.synthesize = () => Promise.resolve(SILENCE)
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(pages) }), fakePlayer().deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitForHighlight('0')
  // Opening centres the saved place once; wait for that so no test counts it.
  await waitFor(() => expect(centred()).toBe(1), { timeout: 10_000 })
  scrolls.length = 0
}

const highlightId = (): string | undefined =>
  document.querySelector<HTMLElement>('[data-testid="sentence-highlight"]')?.dataset.sentenceId
const waitForHighlight = (id: string): Promise<void> =>
  waitFor(() => expect(highlightId()).toBe(id), { timeout: 10_000 })
const stage = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-page="1"]')!.closest<HTMLElement>('.overflow-y-auto')!
const clickPage = (n: number): void => {
  fireEvent.click(document.querySelector(`[data-page="${n}"]`)!, {
    clientX: 100 * SCALE,
    clientY: 110 * SCALE
  })
}
const centred = (): number =>
  scrolls.filter(
    (s) =>
      (s.el as HTMLElement).dataset.testid === 'sentence-highlight' &&
      JSON.stringify(s.arg) === JSON.stringify({ block: 'center', behavior: 'auto' })
  ).length
const pill = (): HTMLElement | null => screen.queryByRole('button', { name: /^Back to reading/ })

describe('Following the read line', () => {
  it('a new current sentence on another page scrolls there instantly', async () => {
    await open(bodyPages(4))
    lineTop = 2000 // off the stage, as a line on another page is
    clickPage(2)
    await waitFor(() => expect(highlightId()).not.toBe('0'))
    await waitFor(() => expect(centred()).toBe(1))
  })

  it('a new current sentence already in the middle third does not scroll', async () => {
    await open(bodyPages(4))
    lineTop = 450
    clickPage(1)
    await waitForHighlight('1')
    expect(scrolls).toEqual([])
    // Near the top edge it is outside the middle third, so the page moves.
    lineTop = 20
    clickPage(2)
    await waitFor(() => expect(centred()).toBe(1))
  })

  it('scrolling away pauses following and shows Back to reading with the page', async () => {
    await open(bodyPages(4))
    clickPage(2)
    await waitFor(() => expect(highlightId()).not.toBe('0'))
    expect(pill()).toBeNull()
    fireEvent.wheel(stage())
    const p = await screen.findByRole('button', { name: 'Back to reading · Page 2' })
    expect(p).toBeTruthy()
    // Paused: the next sentence is not pulled into view.
    scrolls.length = 0
    lineTop = 2000
    clickPage(1)
    await waitForHighlight('1')
    expect(scrolls).toEqual([])
    expect(pill()?.textContent).toBe('Back to reading · Page 1')
  })

  it("her own scrolling is told apart from Tide's: a scroll event alone does not pause", async () => {
    await open(bodyPages(4))
    fireEvent.scroll(stage())
    expect(pill()).toBeNull()
    lineTop = 2000
    clickPage(2)
    await waitFor(() => expect(centred()).toBe(1))
    expect(pill()).toBeNull()
  })

  it('clicking Back to reading jumps to the line and resumes following', async () => {
    await open(bodyPages(4))
    fireEvent.wheel(stage())
    await userEvent.click(await screen.findByRole('button', { name: /^Back to reading/ }))
    expect(centred()).toBe(1)
    await waitFor(() => expect(pill()).toBeNull())
    scrolls.length = 0
    lineTop = 2000
    clickPage(2)
    await waitFor(() => expect(centred()).toBe(1))
  })

  it('following resumes when the read line scrolls back into view', async () => {
    await open(bodyPages(4))
    lineTop = 2000
    fireEvent.wheel(stage())
    await screen.findByRole('button', { name: /^Back to reading/ })
    // Still off the stage: stays paused.
    act(() => void fireEvent.scroll(stage()))
    expect(pill()).toBeTruthy()
    lineTop = 300
    act(() => void fireEvent.scroll(stage()))
    await waitFor(() => expect(pill()).toBeNull())
  })

  it('a small scroll that keeps the line visible pauses following and shows the pill', async () => {
    await open(bodyPages(4))
    lineTop = 450
    fireEvent.wheel(stage())
    act(() => void fireEvent.scroll(stage()))
    expect(await screen.findByRole('button', { name: /^Back to reading/ })).toBeTruthy()
    scrolls.length = 0
    lineTop = 20 // would be recentred if following
    clickPage(2)
    await waitFor(() => expect(highlightId()).not.toBe('0'))
    expect(scrolls).toEqual([])
    expect(pill()).toBeTruthy()
  })

  it('following resumes only after the line has left view and come back', async () => {
    await open(bodyPages(4))
    fireEvent.wheel(stage())
    await screen.findByRole('button', { name: /^Back to reading/ })
    act(() => void fireEvent.scroll(stage())) // still visible: no resume
    expect(pill()).toBeTruthy()
    lineTop = 2000
    act(() => void fireEvent.scroll(stage())) // gone
    lineTop = 300
    act(() => void fireEvent.scroll(stage())) // back
    await waitFor(() => expect(pill()).toBeNull())
  })

  it('a line that leaves view because playback moved on counts as out of view', async () => {
    await open(bodyPages(4))
    fireEvent.wheel(stage())
    await screen.findByRole('button', { name: /^Back to reading/ })
    lineTop = 2000
    clickPage(2)
    await waitFor(() => expect(highlightId()).not.toBe('0'))
    lineTop = 300
    act(() => void fireEvent.scroll(stage()))
    await waitFor(() => expect(pill()).toBeNull())
  })

  it('a middle-click anywhere in the stage counts as her scrolling', async () => {
    await open(bodyPages(4))
    fireEvent.pointerDown(document.querySelector('[data-page="1"]')!, { button: 1 })
    expect(await screen.findByRole('button', { name: /^Back to reading/ })).toBeTruthy()
  })

  it('scroll keys while a dialog has focus do not pause following', async () => {
    await open(bodyPages(4))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    try {
      fireEvent.keyDown(dialog, { key: 'PageDown' })
      expect(pill()).toBeNull()
    } finally {
      dialog.remove()
    }
    fireEvent.keyDown(document.body, { key: 'PageDown' })
    expect(await screen.findByRole('button', { name: /^Back to reading/ })).toBeTruthy()
  })

  it('Ctrl+End and Shift+PageDown pause following', async () => {
    await open(bodyPages(4))
    fireEvent.keyDown(document.body, { key: 'End', ctrlKey: true })
    expect(await screen.findByRole('button', { name: /^Back to reading/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Back to reading/ }))
    await waitFor(() => expect(pill()).toBeNull())
    fireEvent.keyDown(document.body, { key: 'PageDown', shiftKey: true })
    expect(await screen.findByRole('button', { name: /^Back to reading/ })).toBeTruthy()
  })

  it('Space on the focused pill activates it', async () => {
    await open(bodyPages(4))
    fireEvent.wheel(stage())
    const p = await screen.findByRole('button', { name: /^Back to reading/ })
    p.focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(pill()).toBeNull())
    expect(centred()).toBe(1)
  })
})
