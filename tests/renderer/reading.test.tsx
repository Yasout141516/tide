// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ReadingView } from '../../src/shared/library/types'
import { fakeTide } from './setup'

const base: ReadingView = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 10,
  position: { page: 4, textItemIndex: 0, charOffset: 0 },
  addedAt: 5,
  lastOpenedAt: 1,
  finished: false,
  readEverything: false,
  fileName: 'r1.pdf',
  missing: false
}
const moved: ReadingView = { ...base, missing: true }

async function setup(
  reading: ReadingView,
  tweak?: (t: ReturnType<typeof fakeTide>) => void
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide({ snapshot: { readings: [reading] } })
  tweak?.(t)
  setTide(t)
  render(<App />)
  await screen.findByRole('button', { name: /^Memory and Attention/ })
  return t
}

const clickRow = (): Promise<void> =>
  userEvent.click(screen.getByRole('button', { name: /^Memory and Attention/ }))

describe('File moved flow and the More menu', () => {
  it('clicking a missing reading shows "Where did this one go?" with its title and page', async () => {
    const t = await setup(moved)
    await clickRow()
    const d = await screen.findByRole('dialog', { name: 'Where did this one go?' })
    expect(within(d).getByText('Memory and Attention')).toBeTruthy()
    expect(d.textContent).toContain('carry on from page 4')
    expect(t.calls['library.update']).toBeUndefined()
  })

  it('the sentence says "it will open from the start" when there is no saved place', async () => {
    await setup({ ...moved, position: null })
    await clickRow()
    const d = await screen.findByRole('dialog', { name: 'Where did this one go?' })
    expect(d.textContent).toContain('it will open from the start')
  })

  it('Find the file → relinked opens the reading', async () => {
    const t = await setup(moved, (t) => {
      t.library.findFile = async () => ({ kind: 'relinked' })
    })
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Find the file' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
    expect(screen.getByRole('heading', { level: 2, name: 'Memory and Attention' })).toBeTruthy()
  })

  it('cancelling the file chooser keeps the dialog open', async () => {
    await setup(moved)
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Find the file' }))
    expect(screen.getByRole('dialog', { name: 'Where did this one go?' })).toBeTruthy()
  })

  it('a different file asks "Use it anyway?" and only then calls useDifferentFile', async () => {
    const t = await setup(moved, (t) => {
      t.library.findFile = async () => ({ kind: 'different', pickId: 'p1', fileName: 'x.pdf' })
    })
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Find the file' }))
    const d = await screen.findByRole('dialog', {
      name: 'This looks like a different file. Use it anyway?'
    })
    expect(d.textContent).toContain('start again from the beginning')
    expect(t.calls['library.useDifferentFile']).toBeUndefined()
    await userEvent.click(within(d).getByRole('button', { name: 'Use it anyway' }))
    expect(t.calls['library.useDifferentFile']).toEqual([['r1', 'p1']])
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
  })

  it('a file that is already on the shelf says so and changes nothing', async () => {
    const t = await setup(moved, (t) => {
      t.library.findFile = async () => ({ kind: 'different', pickId: 'p1', fileName: 'x.pdf' })
      t.library.useDifferentFile = async () => {
        throw new Error('Error invoking remote method: Error: tide-error:already-on-shelf')
      }
    })
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Find the file' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use it anyway' }))
    expect(await screen.findByText('That file is already on your shelf.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(t.calls['library.update']).toBeUndefined()
    expect(t.calls['library.remove']).toBeUndefined()
  })

  it('Remove from shelf asks first; Keep does nothing', async () => {
    const t = await setup(moved)
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from shelf' }))
    expect(
      await screen.findByRole('dialog', { name: 'Remove “Memory and Attention” from your shelf?' })
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(t.calls['library.remove']).toBeUndefined()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from shelf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(t.calls['library.remove']).toEqual([['r1']])
  })

  it('the More button is labelled in words', async () => {
    await setup(base)
    await clickRow()
    const more = screen.getByRole('button', { name: /More options for Memory and Attention/ })
    expect(more.textContent).toBe('More')
    expect(screen.getByText('Other · Page 4', { selector: 'span' })).toBeTruthy()
  })

  it('Rename saves a trimmed title and Cancel keeps the old one', async () => {
    const t = await setup(base)
    await clickRow()
    await userEvent.click(screen.getByRole('button', { name: /More options for/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])

    await userEvent.click(screen.getByRole('button', { name: /More options for/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))
    const field = await screen.findByRole('textbox', { name: 'Reading title' })
    expect((field as HTMLInputElement).value).toBe('Memory and Attention')
    await userEvent.clear(field)
    await userEvent.type(field, '  New name  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(t.calls['library.update']?.[1]).toEqual(['r1', { title: 'New name' }])
  })

  it('Remove from the More menu confirms, removes and clears the stage', async () => {
    const t = await setup(base)
    await clickRow()
    await userEvent.click(screen.getByRole('button', { name: /More options for/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from shelf…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(t.calls['library.remove']).toEqual([['r1']])
    expect(await screen.findByRole('heading', { name: 'Your shelf is empty' })).toBeTruthy()
  })

  const second: ReadingView = { ...base, id: 'r2', title: 'Other one', position: null }
  const rowOf = (name: RegExp): HTMLElement => screen.getByRole('button', { name })

  it('dismissing File moved leaves the open reading shown and stamped once', async () => {
    const t = fakeTide({
      snapshot: { readings: [base, { ...moved, id: 'r3', title: 'Gone one' }] }
    })
    setTide(t)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    await userEvent.click(rowOf(/^Gone one/))
    await screen.findByRole('dialog', { name: 'Where did this one go?' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Memory and Attention' })).toBeTruthy()
    await userEvent.click(rowOf(/^Memory and Attention/))
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
  })

  it('removing the selected reading clears the selection', async () => {
    const t = fakeTide({ snapshot: { readings: [base, second] } })
    setTide(t)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    await userEvent.click(screen.getByRole('button', { name: /More options for/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from shelf…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Pick a reading from your shelf to carry on.')).toBeTruthy()
  })

  it('Remove from File moved closes the dialog, removes once on a double click', async () => {
    const t = await setup(moved, (t) => {
      const real = t.library.remove
      t.library.remove = (id) => new Promise((r) => setTimeout(r, 30)).then(() => real(id))
    })
    await clickRow()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from shelf' }))
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('heading', { name: 'Your shelf is empty' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(t.calls['library.remove']).toHaveLength(1)
  })

  it('Cancel and Esc on the different-file view return to the ask view', async () => {
    await setup(moved, (t) => {
      t.library.findFile = async () => ({ kind: 'different', pickId: 'p1', fileName: 'x.pdf' })
    })
    await clickRow()
    for (const dismiss of ['cancel', 'esc']) {
      await userEvent.click(await screen.findByRole('button', { name: 'Find the file' }))
      await screen.findByRole('dialog', { name: /different file/ })
      if (dismiss === 'cancel')
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      else await userEvent.keyboard('{Escape}')
      expect(await screen.findByRole('dialog', { name: 'Where did this one go?' })).toBeTruthy()
    }
  })

  it('a blank Rename disables Save', async () => {
    await setup(base)
    await clickRow()
    await userEvent.click(screen.getByRole('button', { name: /More options for/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))
    await userEvent.clear(await screen.findByRole('textbox', { name: 'Reading title' }))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
