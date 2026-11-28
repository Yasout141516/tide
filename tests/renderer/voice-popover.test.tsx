// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { PlayerDeps } from '../../src/renderer/src/player/PlayerContext'
import { VOICES } from '../../src/shared/voices'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE } from './reader-fakes'
import { fakeTide } from './setup'

interface FakePreview {
  url: string
  playing: boolean
  pause: () => void
  end: () => void
}

async function open(): Promise<{
  t: ReturnType<typeof fakeTide>
  sink: ReturnType<typeof fakePlayer>['sink']
  previews: FakePreview[]
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
          finishIn: null,
          fileName: 'r1.pdf',
          missing: false
        }
      ],
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
  t.tts.status = () => Promise.resolve('ready' as const)
  setTide(t)
  const p = fakePlayer()
  const previews: FakePreview[] = []
  const deps: PlayerDeps = {
    ...p.deps,
    makePreview: (url) => {
      const pv: FakePreview = {
        url,
        playing: true,
        pause: () => {
          pv.playing = false
        },
        end: () => {}
      }
      previews.push(pv)
      return {
        play: () => Promise.resolve(),
        pause: () => pv.pause(),
        onEnded: (cb) => {
          pv.end = () => {
            pv.playing = false
            cb()
          }
        }
      }
    }
  }
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(2)) }), deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitFor(() =>
    expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
  )
  return { t, sink: p.sink, previews }
}

const player = (): HTMLElement => screen.getByLabelText('Player')
const trigger = (): HTMLElement =>
  within(player()).getByRole('button', { name: /^Emma · 1×$/, hidden: true })
async function openPopover(): Promise<HTMLElement> {
  await userEvent.click(trigger())
  return screen.findByRole('dialog', { name: 'Choose a voice' })
}

describe('Voice and speed popover', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists the ten voices with names, descriptions and a Listen button each', async () => {
    await open()
    const pop = await openPopover()
    expect(within(pop).getByText('Choose a voice')).toBeTruthy()
    for (const v of VOICES) {
      expect(within(pop).getByRole('button', { name: new RegExp(`^${v.name}`) })).toBeTruthy()
      expect(within(pop).getByText(new RegExp(v.description))).toBeTruthy()
      expect(within(pop).getByRole('button', { name: `Listen to ${v.name}` })).toBeTruthy()
    }
    expect(within(pop).getAllByRole('button', { name: /^Listen to / })).toHaveLength(10)
    expect(within(pop).getByText(/· default/)).toBeTruthy()
    const group = within(pop).getByRole('radiogroup', { name: 'Speed' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['0.8×', '1×', '1.25×', '1.5×', '2×'])
  })

  it('choosing a voice and a speed updates the player label and persists', async () => {
    const { t } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: /^George/ }))
    await userEvent.click(within(pop).getByRole('radio', { name: '1.5×' }))
    await waitFor(() => expect(player().textContent).toContain('George · 1.5×'))
    expect(t.library.setVoice).toHaveBeenLastCalledWith('bm_george', 1.5)
    expect(
      within(pop)
        .getByRole('button', { name: /^George/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(within(pop).getByRole('radio', { name: '1.5×' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('Listen pauses the reading and plays the bundled preview', async () => {
    const { sink, previews } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Puck' }))
    expect(sink.playing).toBe(false)
    expect(previews.map((p) => p.url)).toEqual(['./voice-previews/am_puck.mp3'])
    expect(previews[0].playing).toBe(true)
  })

  it('the reading carries on when a preview ends, if it was playing before', async () => {
    const { sink, previews } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    expect(sink.playing).toBe(false)
    act(() => previews[0].end())
    await waitFor(() => expect(sink.playing).toBe(true))
    expect(player().textContent).toContain('Pause')
  })

  it('the reading carries on when the popover closes on a running preview', async () => {
    const { sink, previews } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    expect(sink.playing).toBe(false)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(sink.playing).toBe(true))
    expect(previews[0].playing).toBe(false)
  })

  it('a second Listen keeps the reading paused, then it carries on after the last one', async () => {
    const { sink, previews } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Nicole' }))
    expect(sink.playing).toBe(false)
    act(() => previews[1].end())
    await waitFor(() => expect(sink.playing).toBe(true))
  })

  it('Listen while the reading is paused leaves it paused when the preview ends', async () => {
    const { sink, previews } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    const plays = sink.plays
    act(() => previews[0].end())
    await new Promise((r) => setTimeout(r, 50))
    expect(sink.playing).toBe(false)
    expect(sink.plays).toBe(plays)
    expect(player().textContent).not.toContain('Pause')
  })

  it('her own Play during a preview wins: one play, the preview stopped', async () => {
    const { sink, previews } = await open()
    await userEvent.click(within(player()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(sink.playing).toBe(true))
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    const plays = sink.plays
    await userEvent.click(within(player()).getByRole('button', { name: 'Play', hidden: true }))
    await waitFor(() => expect(sink.playing).toBe(true))
    expect(previews[0].playing).toBe(false)
    expect(sink.plays).toBe(plays + 1)
  })

  it('pressing Play after a preview stops the preview', async () => {
    const { sink, previews } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    expect(previews[0].playing).toBe(true)
    // the player bar is outside the popover, so this click also dismisses it
    await userEvent.click(within(player()).getByRole('button', { name: 'Play', hidden: true }))
    expect(previews[0].playing).toBe(false)
    await waitFor(() => expect(sink.playing).toBe(true))
  })

  it('closing the popover stops a running preview', async () => {
    const { previews } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    expect(previews[0].playing).toBe(true)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(previews[0].playing).toBe(false)
  })

  it('Space and arrows are ignored while the popover is open', async () => {
    const { sink } = await open()
    const pop = await openPopover()
    pop.focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowLeft}')
    expect(sink.plays).toBe(0)
    expect(sink.playing).toBe(false)
  })

  it('a preview while the reading is idle leaves it idle', async () => {
    const { sink, previews } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Fenrir' }))
    expect(previews).toHaveLength(1)
    expect(sink.plays).toBe(0)
    expect(sink.playing).toBe(false)
    expect(player().textContent).not.toContain('Pause')
  })

  it('Listen on a second voice stops the first preview', async () => {
    const { previews } = await open()
    const pop = await openPopover()
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Kore' }))
    await userEvent.click(within(pop).getByRole('button', { name: 'Listen to Nicole' }))
    expect(previews).toHaveLength(2)
    expect(previews[0].playing).toBe(false)
    expect(previews[1].playing).toBe(true)
  })
})
