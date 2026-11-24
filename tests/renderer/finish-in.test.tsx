// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import { fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE, textPage } from './reader-fakes'
import { fakeTide } from './setup'

/** A long invented reading: 60 pages of ten 100-character sentences (about 73 minutes at 1×). */
const SENTENCE =
  'The quiet lighthouse keeper counted every passing ship through the long grey morning ok.'
const pages = Array.from({ length: 60 }, (_, i) =>
  textPage(
    i + 1,
    Array.from({ length: 10 }, (_, k) => `${SENTENCE.slice(0, 85)} no. ${k + 1}.`.padEnd(100, 'x'))
  )
)

async function open(opts: { finishIn?: number | null; speed?: number } = {}): Promise<{
  t: ReturnType<typeof fakeTide>
}> {
  const t = fakeTide({
    snapshot: {
      readings: [
        {
          id: 'r1',
          title: 'Memory and Attention',
          courseId: null,
          pageCount: 60,
          position: null,
          addedAt: 5,
          lastOpenedAt: null,
          finished: false,
          readEverything: false,
          finishIn: opts.finishIn ?? null,
          fileName: 'r1.pdf',
          missing: false
        }
      ],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: opts.speed ?? 1 }
    }
  })
  t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
  t.tts.status = () => Promise.resolve('ready' as const)
  setTide(t)
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(pages) }), fakePlayer().deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitFor(() =>
    expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
  )
  return { t }
}

const player = (): HTMLElement => screen.getByLabelText('Player')
const label = (): string =>
  within(player()).getByRole('button', { name: /^Emma · /, hidden: true }).textContent ?? ''

async function chooseFinishIn(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /^More options for/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /^Finish in…/ }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name }))
}

describe('Finish in…', () => {
  it('choosing Finish in 60 min sets the effective speed and shows the estimate', async () => {
    const { t } = await open()
    expect(label()).toBe('Emma · 1×')
    await chooseFinishIn('60 min')
    expect(t.library.update).toHaveBeenCalledWith('r1', { finishIn: 60 })
    await waitFor(() => expect(label()).not.toBe('Emma · 1×'))
    const speed = Number(
      label()
        .replace(/^Emma · /, '')
        .replace('×', '')
    )
    expect(speed).toBeGreaterThan(1)
    expect(speed).toBeLessThanOrEqual(2)
    expect(player().textContent).toMatch(/Finishes in about \d+ min at 1\.\d+×|Needs .* even at 2×/)
    // her own choice is untouched
    expect(t.library.setVoice).not.toHaveBeenCalled()
  })

  it('a faster own speed is kept', async () => {
    await open({ speed: 2 })
    await chooseFinishIn('60 min')
    await waitFor(() => expect(player().textContent).toMatch(/Finishes in about/))
    expect(label()).toBe('Emma · 2×')
  })

  it('a slower own speed plays as chosen when Finish in is off', async () => {
    await open({ speed: 0.8 })
    expect(label()).toBe('Emma · 0.8×')
  })

  it('Off restores her chosen speed', async () => {
    await open({ finishIn: 60 })
    await waitFor(() => expect(label()).not.toBe('Emma · 1×'))
    await chooseFinishIn('Off')
    await waitFor(() => expect(label()).toBe('Emma · 1×'))
  })

  it('the More menu shows the current choice', async () => {
    await open({ finishIn: 90 })
    await userEvent.click(screen.getByRole('button', { name: /^More options for/ }))
    const item = await screen.findByRole('menuitem', { name: /^Finish in…/ })
    expect(item.textContent).toContain('90 min')
    await userEvent.click(item)
    const on = await screen.findByRole('menuitemradio', { name: '90 min' })
    expect(on.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: '2 hours' })).toBeTruthy()
  })
})
