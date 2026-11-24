// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import { setTide } from '../../src/renderer/src/lib/tide'
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
})
