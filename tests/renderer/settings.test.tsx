// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { setTide } from '../../src/renderer/src/lib/tide'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE } from './reader-fakes'
import { fakeTide } from './setup'

async function mount(
  init: Parameters<typeof fakeTide>[0] = {}
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide(init)
  setTide(t)
  render(<App />)
  await act(async () => {})
  return t
}

describe('Settings dialog', () => {
  it('Ctrl+, (the settings command) opens Settings on the Look tab', async () => {
    const t = await mount()
    act(() => t.emit({ type: 'settings' }))
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dlg).getByRole('button', { name: 'Look' }).getAttribute('aria-current')).toBe(
      'page'
    )
    expect(within(dlg).getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
  })

  it('picking Deep Sea calls setSettings({ theme: "deep-sea" })', async () => {
    const t = await mount()
    act(() => t.emit({ type: 'settings' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Deep Sea' }))
    expect(t.calls['library.setSettings']).toEqual([[{ theme: 'deep-sea' }]])
    expect(screen.getByRole('radio', { name: 'Deep Sea' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('A+ steps zoom by the same step as the menu and shows the new %', async () => {
    const t = await mount()
    act(() => t.emit({ type: 'settings' }))
    await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(screen.getByRole('button', { name: 'Larger text' }))
    expect(t.calls['library.setZoom']).toEqual([[1.1]])
    expect(await screen.findByText('110%')).toBeTruthy()
    act(() => t.emit({ type: 'zoom', step: 1 }))
    expect(t.calls['library.setZoom']).toEqual([[1.1], [1.2]])
  })

  it('the Match tile reads Match my PC on Windows', async () => {
    const t = await mount({ platform: 'win32' })
    act(() => t.emit({ type: 'settings' }))
    expect(await screen.findByRole('radio', { name: 'Match my PC' })).toBeTruthy()
  })

  it('the Match tile reads Match my Mac on macOS', async () => {
    const t = await mount({ platform: 'darwin' })
    act(() => t.emit({ type: 'settings' }))
    expect(await screen.findByRole('radio', { name: 'Match my Mac' })).toBeTruthy()
  })

  it('the dark pages switch calls setSettings({ darkPages })', async () => {
    const t = await mount()
    act(() => t.emit({ type: 'settings' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Dark pages in dark themes' }))
    expect(t.calls['library.setSettings']).toEqual([[{ darkPages: false }]])
  })

  it('the shelf footer Settings button opens the dialog', async () => {
    await mount({
      snapshot: {
        courses: [{ id: 'c1', name: 'PSYC 201' }],
        readings: [
          {
            id: 'r1',
            title: 'Memory',
            courseId: 'c1',
            pageCount: null,
            position: null,
            addedAt: 0,
            lastOpenedAt: null,
            finished: false,
            readEverything: false,
            finishIn: null,
            fileName: 'r1.pdf',
            missing: false
          }
        ]
      }
    })
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  it('ArrowRight on the checked tile picks the next theme and moves focus to it', async () => {
    const t = await mount()
    act(() => t.emit({ type: 'settings' }))
    const first = await screen.findByRole('radio', { name: 'Sky & Sea' })
    act(() => first.focus())
    await userEvent.keyboard('{ArrowRight}')
    expect(t.calls['library.setSettings']).toEqual([[{ theme: 'deep-sea' }]])
    await act(async () => {})
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Deep Sea' }))
  })
})

describe('Reading tab', () => {
  async function openReadingTab(
    init: Parameters<typeof fakeTide>[0] = {}
  ): Promise<ReturnType<typeof fakeTide>> {
    const t = await mount(init)
    act(() => t.emit({ type: 'settings' }))
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reading' }))
    return t
  }

  it('shows the six switches in order with the citation hint and the Read everything note', async () => {
    await openReadingTab()
    const labels = screen.getAllByRole('switch').map((s) => s.getAttribute('aria-labelledby'))
    expect(labels.map((id) => document.getElementById(id as string)?.textContent)).toEqual([
      'Skip page numbers, headers and footers',
      'Skip footnotes',
      'Stop at References',
      'Skip captions and table text',
      'Skip cover and copyright pages',
      'Read citations aloud'
    ])
    expect(screen.getByText('e.g. “(Smith, 2019)”. Off reads more smoothly.')).toBeTruthy()
    expect(screen.getByText('A reading set to Read everything ignores these.')).toBeTruthy()
    expect(
      screen.getByRole('switch', { name: 'Read citations aloud' }).getAttribute('aria-checked')
    ).toBe('false')
  })

  it('turning off Skip footnotes sends only that filter', async () => {
    const t = await openReadingTab()
    await userEvent.click(screen.getByRole('switch', { name: 'Skip footnotes' }))
    expect(t.calls['library.setSettings']).toEqual([[{ reading: { skipFootnotes: false } }]])
  })

  it('shows Music › Tide by default and the folder name when custom, with no path', async () => {
    const t = await openReadingTab()
    expect(screen.getByText('Music › Tide')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use Music › Tide' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Change folder…' }))
    expect(t.calls['library.chooseExportFolder']).toHaveLength(1)
  })

  it('a custom folder shows its name and Use Music › Tide resets it', async () => {
    const t = await openReadingTab({
      snapshot: { exportFolder: { name: 'Lectures', custom: true } }
    })
    expect(screen.getByText('Lectures')).toBeTruthy()
    expect(screen.queryByText('Music › Tide')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Use Music › Tide' }))
    expect(t.calls['library.resetExportFolder']).toHaveLength(1)
    expect(await screen.findByText('Music › Tide')).toBeTruthy()
  })

  it('changing a filter while playing keeps the place (R8)', async () => {
    const t = fakeTide({
      snapshot: {
        readings: [
          {
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
        ]
      }
    })
    t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
    t.tts.status = () => Promise.resolve('ready' as const)
    setTide(t)
    const p = fakePlayer()
    const deps = fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(3)) })
    renderApp(deps, p.deps)
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    const id = (): string | undefined =>
      document.querySelector<HTMLElement>('[data-testid="sentence-highlight"]')?.dataset.sentenceId
    await waitFor(() => expect(id()).toBe('0'))
    await userEvent.click(
      within(screen.getByLabelText('Player')).getByRole('button', { name: 'Play' })
    )
    await waitFor(() => expect(p.sink.playing).toBe(true))
    // Move on to sentence 3 (page 2), so restarting from the top would be visible.
    for (const next of ['1', '2', '3']) {
      act(() => p.sink.end())
      await waitFor(() => expect(id()).toBe(next))
    }
    await waitFor(() => expect(p.sink.playing).toBe(true))
    const plays = p.sink.plays
    const builds = vi.mocked(deps.buildSentences).mock.calls.length

    act(() => t.emit({ type: 'settings' }))
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reading' }))
    await userEvent.click(within(dlg).getByRole('switch', { name: 'Skip footnotes' }))

    await waitFor(() =>
      expect(vi.mocked(deps.buildSentences).mock.calls.length).toBeGreaterThan(builds)
    )
    expect(vi.mocked(deps.buildSentences).mock.calls.at(-1)?.[1]).toMatchObject({
      skipFootnotes: false
    })
    await waitFor(() => expect(p.sink.plays).toBeGreaterThan(plays))
    await waitFor(() => expect(p.sink.playing).toBe(true))
    expect(id()).toBe('3')
    act(() => p.sink.end())
    await waitFor(() => expect(id()).toBe('4'))
  })

  it('a rejected Change folder shows a plain toast and leaves the folder as it was', async () => {
    const t = await openReadingTab({
      snapshot: { exportFolder: { name: 'Lectures', custom: true } }
    })
    t.library.chooseExportFolder = vi.fn(() => Promise.reject(new Error('tide-error: boom')))
    await userEvent.click(screen.getByRole('button', { name: 'Change folder…' }))
    expect(await screen.findByText("Couldn't change the folder. Please try again.")).toBeTruthy()
    expect(screen.getByText('Lectures')).toBeTruthy()
  })
})
