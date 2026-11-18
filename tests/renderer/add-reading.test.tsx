// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { useAddReading } from '../../src/renderer/src/add/useAddReading'
import { ReaderDepsProvider } from '../../src/renderer/src/reader/deps'
import type { OpenPdfResult } from '../../src/renderer/src/reader/pdf'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { PickResult } from '../../src/shared/library/types'
import { fakeTide } from './setup'
import { bodyPages, fakeDoc } from './reader-fakes'

const newPick: PickResult = { kind: 'new', pickId: 'p1', fileName: 'Week_4_Institutions.pdf' }
const DAMAGED = "Tide can't open this PDF. It may be damaged."

function setup(
  open: OpenPdfResult,
  pick: PickResult = newPick,
  courses = [
    { id: 'c1', name: 'SOC 110' },
    { id: 'c2', name: 'BIO 150' }
  ]
): { t: ReturnType<typeof fakeTide>; openPdf: ReturnType<typeof vi.fn> } {
  const t = fakeTide({ snapshot: { courses } })
  t.library.pickPdf = vi.fn(() => Promise.resolve(pick))
  t.library.readPdf = vi.fn(() => Promise.resolve({ ok: true as const, data: new Uint8Array([1]) }))
  setTide(t)
  const openPdf = vi.fn(() => Promise.resolve(open))
  render(
    <ReaderDepsProvider value={{ openPdf }}>
      <App />
    </ReaderDepsProvider>
  )
  return { t, openPdf }
}

const okDoc = (numPages = 22, metaTitle?: string): OpenPdfResult => ({
  kind: 'ok',
  doc: { ...fakeDoc(bodyPages(numPages)), metaTitle }
})

// The shelf's button is always there (the empty state adds a second one).
const addReading = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole('button', { name: 'Add reading' }))
}

describe('Add reading', () => {
  it('a new file shows the course picker with its name and page count, and Add to shelf adds it', async () => {
    const { t } = setup(okDoc())
    await addReading()
    expect(await screen.findByText('Which course is this for?')).toBeTruthy()
    expect(screen.getByText('Week_4_Institutions.pdf')).toBeTruthy()
    expect(screen.getByText('22 pages')).toBeTruthy()
    // Chips follow the shelf's order: alphabetical.
    const chips = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)
    expect(chips.slice(0, 2)).toEqual(['BIO 150', 'SOC 110'])
    await userEvent.click(screen.getByRole('button', { name: 'SOC 110' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }))
    await waitFor(() => expect(t.calls['library.add']).toHaveLength(1))
    expect(t.calls['library.add'][0][0]).toEqual({
      pickId: 'p1',
      title: 'Week 4 Institutions',
      pageCount: 22,
      course: { id: 'c1' }
    })
    // The new reading is selected and stamped as opened.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Week 4 Institutions' })
    ).toBeTruthy()
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
  })

  it('uses the PDF title when it is a real one', async () => {
    const { t } = setup(okDoc(3, 'Memory and Attention'))
    await addReading()
    await userEvent.click(await screen.findByRole('button', { name: 'Add to shelf' }))
    await waitFor(() => expect(t.calls['library.add']).toHaveLength(1))
    expect(t.calls['library.add'][0][0]).toMatchObject({
      title: 'Memory and Attention',
      course: null
    })
  })

  it('Skip adds it to Other; a typed new course is passed as newName', async () => {
    const { t } = setup(okDoc())
    await addReading()
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(t.calls['library.add']).toHaveLength(1))
    expect(t.calls['library.add'][0][0]).toMatchObject({ course: null })

    await addReading()
    await userEvent.click(await screen.findByRole('button', { name: '＋ New course' }))
    await userEvent.type(screen.getByPlaceholderText('Course name, e.g. PSYC 201'), '  PSYC 201 ')
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }))
    await waitFor(() => expect(t.calls['library.add']).toHaveLength(2))
    expect(t.calls['library.add'][1][0]).toMatchObject({ course: { newName: 'PSYC 201' } })
  })

  it('a file already on the shelf opens it without the picker', async () => {
    const { t, openPdf } = setup(okDoc(), { kind: 'existing', readingId: 'r1' })
    // Put r1 on the shelf first, then pick the same file again.
    await t.library.add({ pickId: 'x', title: 'Already here', pageCount: 2, course: null })
    await addReading()
    expect(await screen.findByRole('heading', { level: 2, name: 'Already here' })).toBeTruthy()
    expect(screen.queryByText('Which course is this for?')).toBeNull()
    // Only the reader opens it (to show it); adding never reads the file again.
    expect(openPdf).toHaveBeenCalledTimes(1)
    expect(t.calls['library.add']).toHaveLength(1)
  })

  it('a file that is not a PDF shows the damaged message and is not added', async () => {
    const { t } = setup({ kind: 'damaged' })
    await addReading()
    expect(await screen.findByText(DAMAGED)).toBeTruthy()
    expect(screen.queryByText('Which course is this for?')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByText(DAMAGED)).toBeNull()
    expect(t.calls['library.add']).toBeUndefined()
  })

  it('a locked PDF is added with its file name as title and no page count', async () => {
    const { t } = setup({ kind: 'needs-password' })
    await addReading()
    await screen.findByText('Which course is this for?')
    expect(screen.queryByText(/pages$/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }))
    await waitFor(() => expect(t.calls['library.add']).toHaveLength(1))
    expect(t.calls['library.add'][0][0]).toMatchObject({
      title: 'Week 4 Institutions',
      pageCount: null
    })
  })

  it('Escape closes the picker and adds nothing', async () => {
    const { t } = setup(okDoc())
    await addReading()
    await screen.findByText('Which course is this for?')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Which course is this for?')).toBeNull())
    expect(t.calls['library.add']).toBeUndefined()
    // The flow is free again.
    await addReading()
    expect(await screen.findByText('Which course is this for?')).toBeTruthy()
  })

  it('an unreadable file shows a friendly message, not the raw error', async () => {
    const t = fakeTide()
    t.library.pickPdf = vi.fn(() => Promise.reject(new Error('tide-error:file-unreadable')))
    setTide(t)
    render(
      <ReaderDepsProvider value={{ openPdf: vi.fn() }}>
        <App />
      </ReaderDepsProvider>
    )
    await addReading()
    expect(await screen.findByText("Tide can't read that file.")).toBeTruthy()
    expect(screen.queryByText(/tide-error/)).toBeNull()
  })

  it('the Add reading menu command starts the flow', async () => {
    const { t } = setup(okDoc())
    await screen.findByRole('heading', { name: 'Your shelf is empty' })
    t.emit({ type: 'add-reading' })
    expect(await screen.findByText('Which course is this for?')).toBeTruthy()
  })

  it.each([
    ['missing', "Tide can't read that file."],
    ['unreadable', DAMAGED]
  ] as const)(
    'readPdf ok:false (%s) shows its own message and adds nothing',
    async (reason, text) => {
      const { t } = setup(okDoc())
      t.library.readPdf = vi.fn(() => Promise.resolve({ ok: false as const, reason }))
      await addReading()
      expect(await screen.findByText(text)).toBeTruthy()
      expect(screen.queryByText('Which course is this for?')).toBeNull()
      expect(t.calls['library.add']).toBeUndefined()
    }
  )

  it('readPdf missing (file vanished) tells her to check where she left it', async () => {
    const { t } = setup(okDoc())
    t.library.readPdf = vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: 'missing' as const })
    )
    await addReading()
    expect(
      await screen.findByText('Check that it is still where you left it, then try adding it again.')
    ).toBeTruthy()
  })

  it('an Open With pick (open-pick command) shows the picker for a new file', async () => {
    const { t } = setup(okDoc())
    await screen.findByRole('heading', { name: 'Your shelf is empty' })
    t.emit({ type: 'open-pick', pick: { kind: 'new', pickId: 'p7', fileName: 'FromFinder.pdf' } })
    expect(await screen.findByText('FromFinder.pdf')).toBeTruthy()
  })

  it('an Open With pick for a known reading opens it without a picker', async () => {
    const { t } = setup(okDoc())
    await t.library.add({ pickId: 'x', title: 'Already here', pageCount: 2, course: null })
    await screen.findByRole('button', { name: /Already here/ })
    t.emit({ type: 'open-pick', pick: { kind: 'existing', readingId: 'r1' } })
    expect(await screen.findByRole('heading', { level: 2, name: 'Already here' })).toBeTruthy()
    expect(screen.queryByText('Which course is this for?')).toBeNull()
  })

  it('selects the added reading before a queued pick runs, so a queued known file wins the selection', async () => {
    const order: string[] = []
    const t = fakeTide()
    t.library.readPdf = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: new Uint8Array([1]) })
    )
    setTide(t)
    let handlePick: (p: PickResult) => void = () => {}
    function Harness(): React.JSX.Element {
      const add = useAddReading((id) => order.push(`selected:${id}`))
      handlePick = add.handlePick
      return <>{add.ui}</>
    }
    render(
      <ReaderDepsProvider value={{ openPdf: vi.fn(() => Promise.resolve(okDoc())) }}>
        <Harness />
      </ReaderDepsProvider>
    )
    act(() => handlePick(newPick))
    await screen.findByText('Which course is this for?')
    // While the picker is open a known file arrives; it waits.
    act(() => handlePick({ kind: 'existing', readingId: 'known' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(order).toHaveLength(2))
    // The new reading is selected first, the queued known file last (it is the later request).
    expect(order[1]).toBe('selected:known')
    expect(order[0]).not.toBe('selected:known')
  })

  it('three picks handed off while one flow is open each go through the add flow in turn', async () => {
    const t = fakeTide()
    t.library.readPdf = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: new Uint8Array([1]) })
    )
    setTide(t)
    let handlePick: (p: PickResult) => void = () => {}
    function Harness(): React.JSX.Element {
      const add = useAddReading(() => {})
      handlePick = add.handlePick
      return <>{add.ui}</>
    }
    render(
      <ReaderDepsProvider value={{ openPdf: vi.fn(() => Promise.resolve(okDoc())) }}>
        <Harness />
      </ReaderDepsProvider>
    )
    act(() => {
      handlePick({ kind: 'new', pickId: 'p1', fileName: 'One.pdf' })
      handlePick({ kind: 'new', pickId: 'p2', fileName: 'Two.pdf' })
      handlePick({ kind: 'new', pickId: 'p3', fileName: 'Three.pdf' })
    })
    for (const name of ['One.pdf', 'Two.pdf', 'Three.pdf']) {
      expect(await screen.findByText(name)).toBeTruthy()
      await userEvent.keyboard('{Escape}')
    }
    expect(t.library.readPdf).toHaveBeenCalledTimes(3)
  })

  it('an open-failed command (Open With file that could not be read) shows the friendly message', async () => {
    const { t } = setup(okDoc())
    await screen.findByRole('heading', { name: 'Your shelf is empty' })
    t.emit({ type: 'open-failed' })
    expect(
      await screen.findByText('Check that it is still where you left it, then try adding it again.')
    ).toBeTruthy()
  })

  it('shows a calm message, not a blank page, when the shelf could not be loaded', async () => {
    const t = fakeTide()
    t.library.get = vi.fn(() => Promise.reject(new Error('tide-error:failed')))
    setTide(t)
    render(
      <ReaderDepsProvider value={{ openPdf: vi.fn() }}>
        <App />
      </ReaderDepsProvider>
    )
    expect(await screen.findByText(/couldn't open your shelf/i)).toBeTruthy()
  })

  it('already-on-shelf from add shows the friendly message', async () => {
    const { t } = setup(okDoc())
    t.library.add = vi.fn(() => Promise.reject(new Error('tide-error:already-on-shelf')))
    await addReading()
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(await screen.findByText('That reading is already on your shelf.')).toBeTruthy()
    expect(screen.queryByText(/tide-error/)).toBeNull()
  })

  it('a pick that arrives while the picker is open waits, then runs after it closes', async () => {
    const t = fakeTide()
    t.library.pickPdf = vi.fn(() => Promise.resolve(newPick))
    t.library.readPdf = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: new Uint8Array([1]) })
    )
    setTide(t)
    let handlePick: (p: PickResult) => void = () => {}
    function Harness(): React.JSX.Element {
      const add = useAddReading(() => {})
      handlePick = add.handlePick
      return (
        <>
          <button onClick={add.start}>Add reading</button>
          {add.ui}
        </>
      )
    }
    const deps = { openPdf: vi.fn(() => Promise.resolve(okDoc())) }
    render(
      <ReaderDepsProvider value={deps}>
        <Harness />
      </ReaderDepsProvider>
    )
    await addReading()
    await screen.findByText('Which course is this for?')
    // Open With while the picker is open: each waiting pick keeps its turn.
    act(() => {
      handlePick({ kind: 'new', pickId: 'p2', fileName: 'Second.pdf' })
      handlePick({ kind: 'new', pickId: 'p3', fileName: 'Third.pdf' })
    })
    expect(t.library.readPdf).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Week_4_Institutions.pdf')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText('Second.pdf')).toBeTruthy()
    expect(t.library.readPdf).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText('Third.pdf')).toBeTruthy()
  })
})
