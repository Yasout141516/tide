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
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: 1 }
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
    const { t, sink } = await open()
    await userEvent.click(button('Play'))
    await waitFor(() => expect(sink.playing).toBe(true))
    const cancelled = (t.calls['tts.cancel'] ?? []).length
    clickLine(1, 1)
    await waitForId('1')
    await waitFor(() => expect((t.calls['tts.cancel'] ?? []).length).toBeGreaterThan(cancelled))
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

  it('does not auto-scroll within 5 s of her own scroll, and does again after', async () => {
    await open(bodyPages(4))
    const scrolls: unknown[] = []
    Element.prototype.scrollIntoView = function (arg?: unknown) {
      scrolls.push(arg)
    }
    // The highlight is always off-screen, so every step wants to scroll to it.
    const rect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      return this.getAttribute('data-testid') === 'sentence-highlight'
        ? ({ top: 5000, bottom: 5020, left: 0, right: 0, width: 0, height: 20 } as DOMRect)
        : rect.call(this)
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    const scroller = document.querySelector('[data-page="1"]')!.closest('.overflow-y-auto')!
    fireEvent.wheel(scroller)
    clickLine(1, 1)
    await waitForId('1')
    expect(scrolls).toEqual([])
    vi.setSystemTime(Date.now() + 6000)
    clickLine(2, 0)
    await waitForId('2')
    expect(scrolls.length).toBe(1)
    // Her scroll keys count as her scrolling too.
    fireEvent.keyDown(document.body, { key: 'PageDown' })
    clickLine(2, 1)
    await waitForId('3')
    expect(scrolls.length).toBe(1)
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
