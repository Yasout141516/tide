// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ReadingView } from '../../src/shared/library/types'
import { DEFAULT_FILTERS, READ_EVERYTHING } from '../../src/shared/text/types'
import { bodyPages, emptyPage, fakeDeps, fakeDoc, renderApp, textPage } from './reader-fakes'
import { fakeTide } from './setup'

const reading: ReadingView = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 5,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null,
  fileName: 'r1.pdf',
  missing: false
}

async function openReading(
  deps: ReturnType<typeof fakeDeps>,
  over: Partial<ReadingView> = {},
  zoom = 1
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide({
    snapshot: {
      readings: [{ ...reading, ...over }],
      settings: {
        reading: DEFAULT_FILTERS,
        zoom,
        voice: 'bf_emma',
        speed: 1,
        theme: 'sky-sea',
        darkPages: true,
        pronunciations: []
      }
    }
  })
  setTide(t)
  renderApp(deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  return t
}

const pageBox = (n: number): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-page="${n}"]`) as HTMLElement

const DAMAGED = "Tide can't open this PDF. It may be damaged."

describe('Reader open states', () => {
  it('a damaged PDF shows the message with Remove from shelf and Keep', async () => {
    const t = await openReading(fakeDeps({ kind: 'damaged' }))
    const d = await screen.findByRole('dialog', { name: DAMAGED })
    expect(within(d).getByRole('button', { name: 'Remove from shelf' })).toBeTruthy()
    await userEvent.click(within(d).getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Pick a reading from your shelf to carry on.')).toBeTruthy()
    expect(t.calls['library.remove']).toBeUndefined()
  })

  it('Remove from shelf on a damaged PDF confirms, then removes the reading', async () => {
    const t = await openReading(fakeDeps({ kind: 'damaged' }))
    const d = await screen.findByRole('dialog', { name: DAMAGED })
    await userEvent.click(within(d).getByRole('button', { name: 'Remove from shelf' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(t.calls['library.remove']).toEqual([['r1']]))
  })

  it('a locked PDF asks for the password; a wrong one says so, the right one opens', async () => {
    const seen: Array<string | undefined> = []
    const deps = fakeDeps((_data, password) => {
      seen.push(password)
      if (password === undefined) return { kind: 'needs-password' }
      if (password !== 'tide') return { kind: 'wrong-password' }
      return { kind: 'ok', doc: fakeDoc(bodyPages(5)) }
    })
    const t = await openReading(deps)
    const d = await screen.findByRole('dialog', { name: 'This PDF is locked with a password.' })
    await userEvent.type(within(d).getByLabelText('Password'), 'nope')
    await userEvent.click(within(d).getByRole('button', { name: 'Open' }))
    expect(await screen.findByText("That password didn't work. Try again.")).toBeTruthy()
    // A wrong attempt starts again with an empty field.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    await userEvent.type(screen.getByLabelText('Password'), 'tide')
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(seen).toEqual([undefined, 'nope', 'tide'])
    // The file was read once; the password never reached main.
    expect(t.calls['library.readPdf']).toHaveLength(1)
    expect(JSON.stringify(t.calls)).not.toContain('"tide"')
    expect(pageBox(1)).toBeTruthy()
  })

  it('Cancel on the password dialog returns to the empty stage', async () => {
    await openReading(fakeDeps({ kind: 'needs-password' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Pick a reading from your shelf to carry on.')).toBeTruthy()
  })

  it('a missing file at open time shows File moved', async () => {
    const t = fakeTide({ snapshot: { readings: [reading] } })
    t.library.readPdf = vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: 'missing' as const })
    )
    setTide(t)
    renderApp(fakeDeps())
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    expect(await screen.findByRole('dialog', { name: 'Where did this one go?' })).toBeTruthy()
  })
})

describe('Reader pages and text', () => {
  it('draws her page first, then extracts the text, and labels the player', async () => {
    const doc = fakeDoc(bodyPages(5))
    await openReading(fakeDeps({ kind: 'ok', doc }), {
      position: { page: 4, textItemIndex: 0, charOffset: 0 }
    })
    const player = await screen.findByRole('contentinfo', { name: 'Player' })
    await waitFor(() => expect(within(player).getByText('Page 4 of 5')).toBeTruthy())
    await waitFor(() => expect(doc.pageText).toHaveBeenCalledTimes(5))
    expect(doc.log.indexOf('render:4')).toBeGreaterThanOrEqual(0)
    expect(doc.log.indexOf('render:4')).toBeLessThan(doc.log.indexOf('text:1'))
  })

  it('sends the page count when the file disagrees with the shelf', async () => {
    const t = await openReading(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(7)) }))
    await waitFor(() => expect(t.calls['library.update']).toContainEqual(['r1', { pageCount: 7 }]))
  })

  it('a reading with no text at all shows the scanned-copy message', async () => {
    const doc = fakeDoc([emptyPage(1), emptyPage(2)])
    await openReading(fakeDeps({ kind: 'ok', doc }), { pageCount: 2 })
    expect(
      await screen.findByText("Tide couldn't find any text in this PDF. It may be a scanned copy.")
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove from shelf' })).toBeTruthy()
  })

  it('a textless page shows "No readable text on this page, skipping."', async () => {
    const doc = fakeDoc([textPage(1, ['Memory is shaped by attention.']), emptyPage(2)])
    await openReading(fakeDeps({ kind: 'ok', doc }), { pageCount: 2 })
    const banner = await screen.findByText('No readable text on this page, skipping.')
    expect(pageBox(2).contains(banner)).toBe(true)
    expect(screen.getAllByText('No readable text on this page, skipping.')).toHaveLength(1)
  })

  it('when filters skip everything, "Read everything" turns it on for this reading', async () => {
    const deps = fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(5)) })
    deps.buildSentences = vi.fn(() =>
      Promise.resolve({ sentences: [], textlessPages: [], skippedPages: [] })
    )
    const t = await openReading(deps)
    expect(await screen.findByText('Tide skipped everything in this reading.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Read everything' }))
    expect(t.calls['library.update']).toContainEqual(['r1', { readEverything: true }])
  })

  it('the More menu toggles Read everything and only the sentences are rebuilt', async () => {
    const doc = fakeDoc(bodyPages(5))
    const deps = fakeDeps({ kind: 'ok', doc })
    const t = await openReading(deps)
    await waitFor(() => expect(deps.buildSentences).toHaveBeenCalledTimes(1))
    expect(vi.mocked(deps.buildSentences).mock.calls[0][1]).toEqual(DEFAULT_FILTERS)

    await userEvent.click(screen.getByRole('button', { name: /^More options/ }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Read everything/ }))
    expect(t.calls['library.update']).toContainEqual(['r1', { readEverything: true }])

    await waitFor(() => expect(deps.buildSentences).toHaveBeenCalledTimes(2))
    expect(vi.mocked(deps.buildSentences).mock.calls[1][1]).toEqual(READ_EVERYTHING)
    // The pages' text was extracted once.
    expect(doc.pageText).toHaveBeenCalledTimes(5)
  })
})

describe('Text size', () => {
  const width = (): number => parseFloat(pageBox(1).style.width)

  it('a zoom command changes the page scale within 80-200%', async () => {
    const t = await openReading(fakeDeps(), {}, 1.9)
    await waitFor(() => expect(pageBox(1)).toBeTruthy())
    // 820 px column x zoom.
    expect(width()).toBeCloseTo(820 * 1.9)
    act(() => t.emit({ type: 'zoom', step: 1 }))
    await waitFor(() => expect(width()).toBeCloseTo(820 * 2))
    expect(t.calls['library.setZoom']).toEqual([[2]])
    act(() => t.emit({ type: 'zoom', step: 1 }))
    expect(t.calls['library.setZoom']).toHaveLength(1)
    expect(width()).toBeCloseTo(820 * 2)
  })

  it('three quick steps with late snapshots still end at +30%', async () => {
    const t = fakeTide({
      snapshot: {
        readings: [reading],
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
    const applied = t.library.setZoom
    // Each snapshot arrives 50 ms after its step, so the first one lands between steps 2 and 3.
    t.library.setZoom = vi.fn(
      (z: number) =>
        new Promise<void>((resolve) => setTimeout(() => void applied(z).then(resolve), 50))
    )
    setTide(t)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    await waitFor(() => expect(pageBox(1)).toBeTruthy())
    // Real time passes between key presses; waitFor lets React apply the snapshots that arrive meanwhile.
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const pause = (ms: number): Promise<void> => waitFor(() => sleep(ms), { timeout: 2000 })
    act(() => t.emit({ type: 'zoom', step: 1 }))
    await pause(30)
    act(() => t.emit({ type: 'zoom', step: 1 }))
    await pause(40)
    act(() => t.emit({ type: 'zoom', step: 1 }))
    await waitFor(() => expect(width()).toBeCloseTo(820 * 1.3))
    expect(vi.mocked(t.library.setZoom).mock.calls.map((c) => c[0])).toEqual([1.1, 1.2, 1.3])
  })

  it('stops at 80% going down', async () => {
    const t = await openReading(fakeDeps(), {}, 0.9)
    await waitFor(() => expect(pageBox(1)).toBeTruthy())
    act(() => t.emit({ type: 'zoom', step: -1 }))
    await waitFor(() => expect(width()).toBeCloseTo(820 * 0.8))
    act(() => t.emit({ type: 'zoom', step: -1 }))
    expect(t.calls['library.setZoom']).toEqual([[0.8]])
  })
})

describe('Lazy canvases', () => {
  afterEach(() => vi.unstubAllGlobals())

  type Entry = { target: Element; isIntersecting: boolean }
  class ControlledIO {
    static last: ControlledIO
    els: Element[] = []
    constructor(public cb: (e: Entry[]) => void) {
      ControlledIO.last = this
    }
    observe(el: Element): void {
      this.els.push(el)
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
    see(visible: number[]): void {
      this.cb(
        this.els.map((el) => ({
          target: el,
          isIntersecting: visible.includes(Number((el as HTMLElement).dataset.page))
        }))
      )
    }
  }

  it('text extraction still starts when she scrolls away and the anchor render is aborted', async () => {
    vi.stubGlobal('IntersectionObserver', ControlledIO)
    const doc = fakeDoc(bodyPages(8))
    doc.render.mockImplementation(
      (n: number, _c: HTMLCanvasElement, _s: number, sig: AbortSignal) =>
        // Page 1 (her place) never finishes by itself; it only ends when the window moves away.
        n === 1
          ? new Promise<void>((_, reject) =>
              sig.addEventListener('abort', () => reject(new Error('aborted')))
            )
          : Promise.resolve()
    )
    await openReading(fakeDeps({ kind: 'ok', doc }), { pageCount: 8 })
    await waitFor(() => expect(doc.render).toHaveBeenCalled())
    expect(doc.pageText).not.toHaveBeenCalled()
    act(() => ControlledIO.last.see([7]))
    await waitFor(() => expect(doc.pageText).toHaveBeenCalledTimes(8))
    await waitFor(() =>
      expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
    )
  })

  it('a page outside the window releases its canvas and an in-flight render is aborted', async () => {
    vi.stubGlobal('IntersectionObserver', ControlledIO)
    const doc = fakeDoc(bodyPages(8))
    const signals: Record<number, AbortSignal> = {}
    doc.render.mockImplementation(
      (n: number, canvas: HTMLCanvasElement, _s: number, sig: AbortSignal) => {
        signals[n] = sig
        canvas.width = 100
        // Page 2 never finishes by itself: it is still in flight when the window moves.
        return n === 2 ? new Promise<void>(() => {}) : Promise.resolve()
      }
    )
    await openReading(fakeDeps({ kind: 'ok', doc }), { pageCount: 8 })
    const canvas = (n: number): HTMLCanvasElement =>
      pageBox(n).querySelector('canvas') as HTMLCanvasElement
    await waitFor(() => expect(signals[2]).toBeTruthy())
    expect(canvas(1).width).toBe(100)
    expect(signals[2].aborted).toBe(false)
    expect(canvas(7).width).toBe(0)

    act(() => ControlledIO.last.see([6]))
    await waitFor(() => expect(canvas(1).width).toBe(0))
    expect(signals[2].aborted).toBe(true)
    // Pages 5 to 7 (visible 6 plus one either side) now hold canvases.
    await waitFor(() => expect(canvas(7).width).toBe(100))
    expect(canvas(5).width).toBe(100)
    expect(canvas(8).width).toBe(0)
  })
})

describe('Dark pages', () => {
  it('the PDF canvas is marked data-pdf-canvas and the highlight layer is not inside it', async () => {
    await openReading(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(2)) }), { pageCount: 2 })
    await waitFor(() =>
      expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
    )
    const canvas = pageBox(1).querySelector('canvas') as HTMLCanvasElement
    expect(canvas.hasAttribute('data-pdf-canvas')).toBe(true)
    const hl = document.querySelector('[data-testid="sentence-highlight"]') as HTMLElement
    expect(canvas.contains(hl)).toBe(false)
    expect(hl.closest('[data-pdf-canvas]')).toBeNull()
  })
})

describe('Selectable text', () => {
  afterEach(() => window.getSelection()?.removeAllRanges())

  const highlightId = (): string | undefined =>
    document.querySelector<HTMLElement>('[data-testid="sentence-highlight"]')?.dataset.sentenceId
  // Second line of page 1 (baseline 114 pt, 12 pt text), at 820 px per 612 pt.
  const click = (): void => {
    fireEvent.click(pageBox(1), { clientX: 100 * (820 / 612), clientY: 110 * (820 / 612) })
  }

  it('a drag-selection does not move the highlight; a plain click still does', async () => {
    await openReading(fakeDeps())
    await waitFor(() => expect(highlightId()).toBe('0'), { timeout: 10_000 })
    await waitFor(() => expect(pageBox(1).querySelector('[data-item-index]')).toBeTruthy())

    // She drags across the second line: the selection is not collapsed, so the click that ends the drag is ignored.
    const line = pageBox(1).querySelector('[data-item-index="1"]')!.firstChild!
    window.getSelection()!.setBaseAndExtent(line, 2, line, 9)
    click()
    expect(highlightId()).toBe('0')

    // A plain click (collapsed selection) picks the sentence under the pointer.
    window.getSelection()!.removeAllRanges()
    click()
    await waitFor(() => expect(highlightId()).toBe('1'), { timeout: 10_000 })
  })
})
