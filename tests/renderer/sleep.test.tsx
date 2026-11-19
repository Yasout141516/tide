// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE } from './reader-fakes'
import { fakeTide } from './setup'

async function open(): Promise<{
  t: ReturnType<typeof fakeTide>
  sink: ReturnType<typeof fakePlayer>['sink']
  advance: (sec: number) => void
}> {
  const t = fakeTide({
    snapshot: {
      readings: [
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
})
