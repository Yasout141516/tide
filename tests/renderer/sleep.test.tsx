// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE } from './reader-fakes'
import { fakeTide } from './setup'

async function open(extra = false): Promise<{
  t: ReturnType<typeof fakeTide>
  sink: ReturnType<typeof fakePlayer>['sink']
  advance: (sec: number) => void
}> {
  const t = fakeTide({
    snapshot: {
      readings: [
        ...(extra
          ? [
              {
                id: 'r2',
                title: 'Second Reading',
                courseId: null,
                pageCount: 2,
                position: null,
                addedAt: 4,
                lastOpenedAt: null,
                finished: false,
                readEverything: false,
                finishIn: null,
                fileName: 'r2.pdf',
                missing: false
              }
            ]
          : []),
        {
          id: 'r1',
          title: 'Memory and Attention',
          courseId: null,
          pageCount: 2,
          position: null,
          addedAt: 5,
          lastOpenedAt: null,
          finished: false,
          readEverything: false,
          finishIn: null,
          fileName: 'r1.pdf',
          missing: false
        }
      ],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: 1 }
    }
  })
  t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
  t.tts.status = () => Promise.resolve('ready' as const)
  setTide(t)
  const p = fakePlayer()
  let clock = 0
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(2)) }), {
    ...p.deps,
    now: () => clock * 1000
  })
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitFor(() =>
    expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
  )
  return {
    t,
    sink: p.sink,
    advance: (sec) => {
      clock += sec
    }
  }
}

const player = (): HTMLElement => screen.getByLabelText('Player')
const sleepButton = (): HTMLElement =>
  within(player()).getByRole('button', { name: /^Sleep/, hidden: true })

describe('Sleep timer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('the popover lists the seven options with a check on the chosen one', async () => {
    await open()
    await userEvent.click(sleepButton())
    const pop = await screen.findByRole('dialog', { name: 'Stop reading after…' })
    expect(within(pop).getByText('Stop reading after…')).toBeTruthy()
    const radios = within(pop).getAllByRole('radio')
    expect(radios.map((r) => r.textContent?.replace('✓', '').trim())).toEqual([
      'Off',
      '10 minutes',
      '20 minutes',
      '30 minutes',
      '45 minutes',
      'End of this page',
      'End of this reading'
    ])
    expect(within(pop).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    await userEvent.click(within(pop).getByRole('radio', { name: '30 minutes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sleepButton().textContent).toBe('Sleep 30:00')
    await userEvent.click(sleepButton())
    const again = await screen.findByRole('dialog', { name: 'Stop reading after…' })
    expect(
      within(again).getByRole('radio', { name: '30 minutes' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(within(again).getByRole('radio', { name: '30 minutes' }).textContent).toContain('✓')
  })

  it('the bar shows the countdown and a stop pauses, restores volume and flushes the position', async () => {
    const { t, sink, advance } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    await userEvent.click(sleepButton())
    await userEvent.click(await screen.findByRole('radio', { name: '10 minutes' }))
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep 10:00'))
    const flushes = (t.calls['library.flush'] ?? []).length

    advance(599)
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep 0:01'))
    expect(sink.volume).toBeCloseTo(0.2)
    expect(sink.playing).toBe(true)

    advance(1)
    await waitFor(() => expect(sink.playing).toBe(false))
    expect(sink.volume).toBe(1)
    expect(sleepButton().textContent).toBe('Sleep')
    expect(within(player()).getByRole('button', { name: 'Play' })).toBeTruthy()
    await waitFor(() => expect((t.calls['library.flush'] ?? []).length).toBeGreaterThan(flushes))
  })

  it('the countdown does not run while paused', async () => {
    const { advance } = await open()
    await userEvent.click(sleepButton())
    await userEvent.click(await screen.findByRole('radio', { name: '10 minutes' }))
    advance(300)
    await new Promise((r) => setTimeout(r, 400))
    expect(sleepButton().textContent).toBe('Sleep 10:00')
  })

  it('the page option holds the reading at the last sentence of the page, at once', async () => {
    const { t, sink } = await open()
    const highlightId = (): string | undefined =>
      document.querySelector<HTMLElement>('[data-testid="sentence-highlight"]')?.dataset.sentenceId
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    await userEvent.click(sleepButton())
    await userEvent.click(await screen.findByRole('radio', { name: 'End of this page' }))
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep · page'))
    const flushes = (t.calls['library.flush'] ?? []).length

    act(() => sink.end()) // sentence 0 done: sentence 1 starts
    await waitFor(() => expect(highlightId()).toBe('1'))
    expect(sink.plays).toBe(2)
    expect(sleepButton().textContent).toBe('Sleep · page')

    act(() => sink.end()) // sentence 1 is the last of page 1
    expect(sink.playing).toBe(false)
    expect(sink.plays).toBe(2) // no clip of sentence 2 was started
    expect(sink.volume).toBe(1)
    expect(highlightId()).toBe('1')
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep'))
    await waitFor(() => expect((t.calls['library.flush'] ?? []).length).toBeGreaterThan(flushes))
    expect(within(player()).getByRole('button', { name: 'Play' })).toBeTruthy()
    await new Promise((r) => setTimeout(r, 400))
    expect(highlightId()).toBe('1')
    expect(sink.plays).toBe(2)
  })

  it('switching to another reading turns a page timer off', async () => {
    await open(true)
    await userEvent.click(sleepButton())
    await userEvent.click(await screen.findByRole('radio', { name: 'End of this page' }))
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep · page'))
    await userEvent.click(screen.getByRole('button', { name: /^Second Reading/ }))
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep'))
  })

  it('a reading that ends mid-fade restores the volume and turns the sleep timer off', async () => {
    const { sink, advance } = await open()
    const shown = (): boolean => !!within(player()).queryByText(/^Finished ✓/)
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    await userEvent.click(sleepButton())
    await userEvent.click(await screen.findByRole('radio', { name: '10 minutes' }))
    advance(599)
    await waitFor(() => expect(sink.volume).toBeCloseTo(0.2))
    for (let i = 0; i < 40 && !shown(); i++) {
      await waitFor(() => expect(sink.playing || shown()).toBe(true))
      if (shown()) break
      act(() => sink.end())
    }
    await waitFor(() => expect(shown()).toBe(true))
    expect(sink.volume).toBe(1)
    await waitFor(() => expect(sleepButton().textContent).toBe('Sleep'))
  })
})
