// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { ToastProvider, useToast } from '../../src/renderer/src/shell/Toast'
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

// Counts how often each page is asked to render, as ReaderView hands it props.
const renders = vi.hoisted(() => ({ counts: new Map<number, number>() }))
vi.mock('../../src/renderer/src/reader/PdfPage', async () => {
  const actual = await vi.importActual<typeof import('../../src/renderer/src/reader/PdfPage')>(
    '../../src/renderer/src/reader/PdfPage'
  )
  const { memo } = await import('react')
  return {
    PdfPage: memo(function Counted(p: { n: number }) {
      renders.counts.set(p.n, (renders.counts.get(p.n) ?? 0) + 1)
      return createElement(actual.PdfPage as never, p)
    })
  }
})

const reading = (id: string, title: string, pageCount: number): ReadingView => ({
  id,
  title,
  courseId: null,
  pageCount,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null,
  fileName: `${id}.pdf`,
  missing: false
})

const SCALE = 820 / PAGE_W
/** Line n of a body page (12 pt text, 14 pt apart from a 100 pt baseline). */
const lineY = (n: number): number => (96 + 14 * n) * SCALE
const clickLine = (page: number, line: number): void => {
  fireEvent.click(document.querySelector(`[data-page="${page}"]`)!, {
    clientX: 100 * SCALE,
    clientY: lineY(line)
  })
}

const highlightId = (): string | undefined =>
  document.querySelector<HTMLElement>('[data-testid="sentence-highlight"]')?.dataset.sentenceId
const waitForId = (id: string): Promise<void> => waitFor(() => expect(highlightId()).toBe(id))
const player = (): HTMLElement => screen.getByLabelText('Player')
const button = (name: string | RegExp): HTMLElement =>
  within(player()).getByRole('button', { name })

async function open(
  pages: PageText[] = bodyPages(2),
  extra: ReadingView[] = [],
  status: 'loading' | 'ready' = 'ready'
): Promise<{ t: ReturnType<typeof fakeTide>; sink: ReturnType<typeof fakePlayer>['sink'] }> {
  const t = fakeTide({
    snapshot: {
      readings: [reading('r1', 'Memory and Attention', pages.length), ...extra],
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
  t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
  t.tts.status = () => Promise.resolve(status)
  setTide(t)
  const p = fakePlayer()
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(pages) }), p.deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitForId('0')
  return { t, sink: p.sink }
}

const synthTexts = (t: ReturnType<typeof fakeTide>): string[] =>
  (t.tts.synthesize as unknown as Mock).mock.calls.map((c) => c[0] as string)

describe('Player bar', () => {
  beforeEach(() => {
    renders.counts.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows exactly five controls, all with visible words', async () => {
    await open()
    const names = within(player())
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(names).toEqual(['Back 15s', 'Play', 'Forward 15s', 'Emma · 1×', 'Sleep'])
    expect(within(player()).getByText('Page 1 of 2')).toBeTruthy()
    expect(await within(player()).findByText(/min left|Less than a minute left/)).toBeTruthy()
  })

  it('renders the controls disabled until a reading with sentences is open', () => {
    setTide(fakeTide())
    renderApp()
    for (const b of within(player()).getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  it('opening a reading does not start playback', async () => {
    const { t, sink } = await open()
    // Give any stray autoplay a moment to show itself.
    await new Promise((r) => setTimeout(r, 50))
    expect(sink.plays).toBe(0)
    expect(synthTexts(t)).toEqual([])
    expect(t.calls['app.setPlaying'] ?? []).toEqual([])
    expect(button('Play')).toBeTruthy()
  })

  it('Play speaks from the current sentence and the highlight follows the engine', async () => {
    const { t, sink } = await open()
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    expect(synthesizeFirst(t)).toBe('Memory is shaped by attention.')
    expect(button('Pause')).toBeTruthy()
    expect(t.calls['app.setPlaying']?.at(-1)).toEqual([true])
    await waitForId('0')
    act(() => sink.end())
    await waitForId('1')
    act(() => sink.end())
    await waitForId('2')
    expect(within(player()).getByText('Page 2 of 2')).toBeTruthy()
  })

  it('Space toggles play and pause; arrows skip 15 s; both ignored inside a dialog or field', async () => {
    const { sink } = await open()
    // Focus is on the shelf row she just clicked (a button outside the player): Space still toggles.
    expect(document.activeElement?.closest('[aria-label="Player"]')).toBeNull()
    expect(document.activeElement?.tagName).toBe('BUTTON')
    await userEvent.keyboard(' ')
    await waitFor(() => expect(sink.playing).toBe(true))
    await userEvent.keyboard(' ')
    await waitFor(() => expect(sink.playing).toBe(false))
    expect(button('Play')).toBeTruthy()
    // Four sentences of about 2.3 s: 15 s ahead is the last, 15 s back the first.
    await userEvent.keyboard('{ArrowRight}')
    await waitForId('3')
    await userEvent.keyboard('{ArrowLeft}')
    await waitForId('0')

    // A button in the player bar handles its own Space: Forward 15s skips, nothing plays.
    button('Forward 15s').focus()
    await userEvent.keyboard(' ')
    await waitForId('3')
    expect(sink.playing).toBe(false)
    await userEvent.keyboard('{ArrowLeft}')
    await waitForId('0')
    ;(document.activeElement as HTMLElement).blur()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    dialog.append(input)
    document.body.append(dialog)
    try {
      input.focus()
      await userEvent.keyboard(' {ArrowRight}')
      input.blur()
      // An open dialog stops the keys wherever focus is.
      await userEvent.keyboard(' {ArrowRight}')
      expect(sink.playing).toBe(false)
      expect(highlightId()).toBe('0')
    } finally {
      dialog.remove()
    }
    await userEvent.keyboard('{ArrowRight}')
    await waitForId('3')
  })

  it('clicking a sentence while playing continues from that sentence', async () => {
    const { sink } = await open()
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    const plays = sink.plays
    clickLine(1, 1)
    await waitForId('1')
    // Sentence 1 was already made, so the seek restarts the sink without a new synthesis.
    await waitFor(() => expect(sink.plays).toBeGreaterThan(plays))
    // Still playing, and it carries on from the clicked sentence.
    await waitFor(() => expect(button('Pause')).toBeTruthy())
    await waitFor(() => expect(sink.playing).toBe(true))
    act(() => sink.end())
    await waitForId('2')
  })

  it('rebuilding the sentence list while playing continues from the re-resolved sentence', async () => {
    const { sink } = await open()
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    const plays = sink.plays
    await userEvent.click(screen.getByRole('button', { name: /^More options/ }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Read everything/ }))
    await waitFor(() => expect(sink.plays).toBeGreaterThan(plays))
    await waitFor(() => expect(sink.playing).toBe(true))
    expect(button('Pause')).toBeTruthy()
    expect(highlightId()).toBe('0')
    act(() => sink.end())
    await waitForId('1')
  })

  it('a click on the sentence the engine last reached seeks back to it', async () => {
    const { sink } = await open(bodyPages(4))
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    act(() => sink.end())
    await waitForId('1')
    clickLine(2, 1) // sentence 3
    await waitForId('3')
    clickLine(1, 1) // sentence 1 again
    await waitForId('1')
    await waitFor(() => expect(sink.playing).toBe(true))
    act(() => sink.end())
    await waitForId('2')
  })

  it('pause flushes the position', async () => {
    const { t, sink } = await open()
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    const flushes = (t.calls['library.flush'] ?? []).length
    await userEvent.click(button('Pause'))
    await waitFor(() => expect((t.calls['library.flush'] ?? []).length).toBeGreaterThan(flushes))
    expect(sink.playing).toBe(false)
    expect(t.calls['app.setPlaying']?.at(-1)).toEqual([false])
  })

  it('switching readings while playing stops audio, flushes the old place and does not autoplay', async () => {
    const { t, sink } = await open(bodyPages(2), [reading('r2', 'Second Reading', 2)])
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    const flushes = (t.calls['library.flush'] ?? []).length
    const plays = sink.plays
    await userEvent.click(screen.getByRole('button', { name: /^Second Reading/ }))
    await waitFor(() => expect(sink.playing).toBe(false))
    await waitFor(() => expect((t.calls['library.flush'] ?? []).length).toBeGreaterThan(flushes))
    await waitForId('0')
    await new Promise((r) => setTimeout(r, 50))
    expect(sink.playing).toBe(false)
    expect(sink.plays).toBe(plays)
    expect(button('Play')).toBeTruthy()
  })

  it('shows Getting the voice ready… while the voice loads', async () => {
    const { t } = await open(bodyPages(2), [], 'loading')
    // The voice is still loading: nothing arrives yet.
    t.tts.synthesize = vi.fn(() => new Promise<never>(() => {}))
    await userEvent.click(button('Play'))
    await waitFor(() => expect(screen.getByText('Getting the voice ready…')).toBeTruthy())
    expect(screen.queryByText('Page 1 of 2')).toBeNull()
    expect(button('Pause')).toBeTruthy()
  })

  it("says the voice isn't working when synthesis fails", async () => {
    const { t } = await open()
    t.tts.synthesize = vi.fn(() => Promise.reject(new Error('boom')))
    await userEvent.click(button('Play'))
    await waitFor(() => expect(screen.getByText("The voice isn't working right now.")).toBeTruthy())
    expect(button('Play')).toBeTruthy()
  })

  it('a sentence that cannot be read is skipped with one toast and one log line (RS-3)', async () => {
    const { t } = await open(bodyPages(4))
    // The first two sentences fail; the rest are read: two skips, one toast.
    // The first two requests made (sentences 0 and 1, by gen) fail every time, retries included; the
    // window is by time now, so the request numbers no longer say which sentence is which.
    const bad = new Set<string>()
    t.tts.synthesize = vi.fn((_text: string, o: { gen?: string }) => {
      if (bad.size < 2) bad.add(o.gen ?? '')
      return bad.has(o.gen ?? '')
        ? Promise.reject(new Error('timed out'))
        : Promise.resolve(SILENCE)
    })
    await userEvent.click(button('Play'))
    expect(await screen.findByText("Tide skipped a passage it couldn't read aloud.")).toBeTruthy()
    await waitFor(() => expect(button('Pause')).toBeTruthy()) // playing on, not the error state
    expect(screen.queryByText("The voice isn't working right now.")).toBeNull()
    expect(screen.getAllByText("Tide skipped a passage it couldn't read aloud.")).toHaveLength(1)
    const logs = (t.calls['app.log'] ?? []) as unknown[][]
    expect(logs.filter((c) => String(c[1]).includes('could not be read aloud'))).toHaveLength(2)
  })

  it('stays put after her own scroll, however long, until Back to reading is pressed', async () => {
    await open(bodyPages(4))
    // The opening highlight may still be scrolling itself into view (more slowly under load): let it
    // settle, so only scrolls caused by the steps below are counted.
    await waitForId('0')
    await new Promise((r) => setTimeout(r, 50))
    const scrolls: unknown[] = []
    Element.prototype.scrollIntoView = function (arg?: unknown) {
      scrolls.push(arg)
    }
    // The highlight is always off-screen, so every step would want to scroll to it.
    const rect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      return this.getAttribute('data-testid') === 'sentence-highlight'
        ? ({ top: 5000, bottom: 5020, left: 0, right: 0, width: 0, height: 20 } as DOMRect)
        : rect.call(this)
    })
    const scroller = document.querySelector('[data-page="1"]')!.closest('.overflow-y-auto')!
    fireEvent.wheel(scroller)
    clickLine(1, 1)
    await waitForId('1')
    // No timer brings the page back: a later step still leaves it where she put it.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    clickLine(2, 0)
    await waitForId('2')
    expect(scrolls).toEqual([])
    await userEvent.click(await screen.findByRole('button', { name: 'Back to reading · Page 2' }))
    expect(scrolls).toEqual([{ block: 'center', behavior: 'auto' }])
    // Following again: the next step scrolls at once.
    clickLine(2, 1)
    await waitForId('3')
    expect(scrolls.length).toBe(2)
    // Her scroll keys pause it again.
    fireEvent.keyDown(document.body, { key: 'PageDown' })
    await screen.findByRole('button', { name: /^Back to reading/ })
  })

  it('stepping one sentence re-renders only the pages whose highlight changed', async () => {
    await open(bodyPages(10))
    await new Promise((r) => setTimeout(r, 50))
    const before = new Map(renders.counts)
    expect(before.size).toBe(10)
    // Sentence 2 is the first one on page 2.
    clickLine(2, 0)
    await waitForId('2')
    const changed = [...renders.counts].filter(([n, c]) => c !== before.get(n)).map(([n]) => n)
    expect(changed.sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('PdfPage is memoised', async () => {
    const actual = await vi.importActual<typeof import('../../src/renderer/src/reader/PdfPage')>(
      '../../src/renderer/src/reader/PdfPage'
    )
    expect((actual.PdfPage as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo')
    )
  })
})

describe('Finished, Play next and voice crashes', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const second = reading('r2', 'Second Reading', 2)
  const finishedShown = (): boolean => !!within(player()).queryByText(/^Finished ✓/)
  /** Plays the reading to its end, one sentence after another. */
  async function playToEnd(sink: ReturnType<typeof fakePlayer>['sink']): Promise<void> {
    await userEvent.click(button('Play'))
    for (let i = 0; i < 40 && !finishedShown(); i++) {
      await waitFor(() => expect(sink.playing || finishedShown()).toBe(true))
      if (finishedShown()) break
      act(() => sink.end())
    }
    await waitFor(() => expect(finishedShown()).toBe(true))
  }

  it('reaching the end marks the reading finished and offers Play next', async () => {
    const { t, sink } = await open(bodyPages(2), [second])
    await playToEnd(sink)
    expect(t.calls['library.update']).toContainEqual(['r1', { finished: true }])
    expect(within(player()).getByText('Finished ✓ · Next: Second Reading')).toBeTruthy()
    expect(button('Play next')).toBeTruthy()
    expect(button('Dismiss')).toBeTruthy()
    await userEvent.click(button('Dismiss'))
    expect(within(player()).queryByText(/Finished ✓/)).toBeNull()
  })

  it('offers only Dismiss when there is no next reading', async () => {
    const { sink } = await open()
    await playToEnd(sink)
    expect(within(player()).getByText('Finished ✓')).toBeTruthy()
    expect(within(player()).queryByRole('button', { name: 'Play next' })).toBeNull()
    expect(button('Dismiss')).toBeTruthy()
  })

  it('Play next opens the next reading and starts playing it', async () => {
    const { t, sink } = await open(bodyPages(2), [second])
    await playToEnd(sink)
    const plays = sink.plays
    const spoken = synthTexts(t).length
    await userEvent.click(button('Play next'))
    await waitFor(() => expect(sink.plays).toBeGreaterThan(plays))
    expect(t.calls['library.update']).toContainEqual(['r2', { opened: true }])
    expect(synthTexts(t)[spoken]).toBe('Memory is shaped by attention.')
    expect(within(player()).queryByText(/Finished ✓/)).toBeNull()
    await waitFor(() => expect(sink.playing).toBe(true))
  })

  it('Play next that does not open the reading leaves no autoplay armed: a later open does not play', async () => {
    const { t, sink } = await open(bodyPages(2), [second])
    await playToEnd(sink)
    // The file goes missing after the offer was made: Play next opens the question, not the reading.
    await act(async () => {
      await t.library.update('r2', { missing: true } as never)
    })
    await userEvent.click(button('Play next'))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () => {
      await t.library.update('r2', { missing: false } as never)
    })
    const plays = sink.plays
    await userEvent.click(screen.getByRole('button', { name: /^Second Reading/ }))
    await waitForId('0')
    await new Promise((r) => setTimeout(r, 100))
    expect(sink.plays).toBe(plays)
  })

  it('a voice restart shows the restarting toast; a failure offers Restart Tide', async () => {
    const t = fakeTide()
    let emit: (s: 'restarting' | 'failed') => void = () => {}
    t.tts.onStatus = ((cb: (s: 'restarting' | 'failed') => void) => {
      emit = cb
      return () => {}
    }) as typeof t.tts.onStatus
    setTide(t)
    renderApp()
    await waitFor(() => expect(t.calls['ready']).toBeTruthy())
    act(() => emit('restarting'))
    expect(await screen.findByText('The voice stopped unexpectedly. Restarting…')).toBeTruthy()
    act(() => emit('failed'))
    expect(await screen.findByText('The voice stopped unexpectedly.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Restart Tide' }))
    expect(t.calls['app.relaunch']).toHaveLength(1)
  })

  it('a later toast does not replace the Restart Tide toast', async () => {
    const t = fakeTide()
    let emit: (s: 'restarting' | 'failed') => void = () => {}
    t.tts.onStatus = ((cb: (s: 'restarting' | 'failed') => void) => {
      emit = cb
      return () => {}
    }) as typeof t.tts.onStatus
    setTide(t)
    renderApp()
    await waitFor(() => expect(t.calls['ready']).toBeTruthy())
    act(() => emit('failed'))
    act(() => emit('restarting'))
    expect(screen.getByRole('button', { name: 'Restart Tide' })).toBeTruthy()
    expect(screen.queryByText(/Restarting…/)).toBeNull()
  })

  it('repeated restarting events show one toast', async () => {
    const t = fakeTide()
    let emit: (s: 'restarting') => void = () => {}
    t.tts.onStatus = ((cb: (s: 'restarting') => void) => {
      emit = cb
      return () => {}
    }) as typeof t.tts.onStatus
    setTide(t)
    renderApp()
    await waitFor(() => expect(t.calls['ready']).toBeTruthy())
    act(() => emit('restarting'))
    const first = screen.getByText('The voice stopped unexpectedly. Restarting…')
    act(() => emit('restarting'))
    act(() => emit('restarting'))
    expect(screen.getAllByText('The voice stopped unexpectedly. Restarting…')).toHaveLength(1)
    expect(screen.getByText('The voice stopped unexpectedly. Restarting…')).toBe(first)
  })

  it('clicking Restart Tide relaunches and dismisses the toast', async () => {
    const t = fakeTide()
    let emit: (s: 'failed') => void = () => {}
    t.tts.onStatus = ((cb: (s: 'failed') => void) => {
      emit = cb
      return () => {}
    }) as typeof t.tts.onStatus
    setTide(t)
    renderApp()
    await waitFor(() => expect(t.calls['ready']).toBeTruthy())
    act(() => emit('failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Restart Tide' }))
    expect(t.calls['app.relaunch']).toHaveLength(1)
    expect(screen.queryByText('The voice stopped unexpectedly.')).toBeNull()
  })

  it('the Restart Tide toast stays until it is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const t = fakeTide()
    let emit: (s: 'failed') => void = () => {}
    t.tts.onStatus = ((cb: (s: 'failed') => void) => {
      emit = cb
      return () => {}
    }) as typeof t.tts.onStatus
    setTide(t)
    renderApp()
    await waitFor(() => expect(t.calls['ready']).toBeTruthy())
    act(() => emit('failed'))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('button', { name: 'Restart Tide' })).toBeTruthy()
  })
})

describe('Toast', () => {
  function Shower(): React.JSX.Element {
    const toast = useToast()
    return (
      <button
        onClick={() =>
          toast.show({ text: 'Saved', actions: [{ label: 'Undo', onClick: () => undone() }] })
        }
      >
        Show
      </button>
    )
  }
  const undone = vi.fn()

  it('shows its text and runs an action, then goes away', async () => {
    render(
      <ToastProvider>
        <Shower />
      </ToastProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('Saved')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undone).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Saved')).toBeNull()
  })
})

function synthesizeFirst(t: ReturnType<typeof fakeTide>): string | undefined {
  return synthTexts(t)[0]
}
