// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ExportSpec } from '../../src/shared/ipc-types'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import type { PageText } from '../../src/shared/text/types'
import { bodyPages, fakeDeps, fakeDoc, renderApp, textPage } from './reader-fakes'
import { fakeTide } from './setup'

const reading = {
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

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 120,
      left: 80,
      right: 300,
      width: 220,
      height: 20,
      x: 80,
      y: 100
    }) as DOMRect
})
afterEach(() => window.getSelection()?.removeAllRanges())

type FakeTide = ReturnType<typeof fakeTide>

async function open(
  opts: { platform?: string; pages?: PageText[]; speed?: number; title?: string } = {}
): Promise<FakeTide> {
  const t = fakeTide({
    platform: opts.platform,
    snapshot: {
      readings: [opts.title ? { ...reading, title: opts.title } : reading],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: opts.speed ?? 1 },
      ui: { collapsed: [], tipsSeen: ['select-text'] }
    }
  })
  setTide(t)
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(opts.pages ?? bodyPages(3)) }))
  await userEvent.click(
    await screen.findByRole('button', {
      name: new RegExp('^' + (opts.title ?? 'Memory and Attention').slice(0, 20))
    })
  )
  await waitFor(
    () => expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy(),
    { timeout: 10_000 }
  )
  return t
}

/** Replaces export.start with a recording fake that answers `reply` (a function of the call count). */
function fakeStart(
  t: FakeTide,
  reply: (n: number) => Awaited<ReturnType<FakeTide['export']['start']>>
): void {
  t.export.start = vi.fn((...a: Parameters<FakeTide['export']['start']>) => {
    const calls = (t.calls['export.start'] ??= [])
    calls.push(a)
    return Promise.resolve(reply(calls.length))
  })
}

async function openFromMenu(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /^More options for/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as audio…' }))
}

async function openFromSelection(): Promise<void> {
  const node = (i: number): Node =>
    document.querySelector(`[data-page="1"] [data-item-index="${i}"]`)!.firstChild!
  window.getSelection()!.setBaseAndExtent(node(0), 2, node(0), 5)
  fireEvent(document, new Event('selectionchange'))
  await userEvent.click(await screen.findByRole('button', { name: 'Save as audio' }))
}

const radio = (name: RegExp): HTMLInputElement =>
  screen.getByRole('radio', { name }) as HTMLInputElement
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /Save audio/ }) as HTMLButtonElement
const lastStart = (t: FakeTide): [ExportSpec, unknown?] =>
  t.calls['export.start'].at(-1) as [ExportSpec, unknown?]

describe('Save as audio panel: the export limits of main', () => {
  it('cuts a long title and file name to 200 characters and splits a 6000-character sentence', async () => {
    const title = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ') // 480+ characters
    const longSentence = Array.from({ length: 1000 }, (_, i) => `term${i}`).join(' ') + '.' // ~6900
    const pages = [textPage(1, [longSentence, 'A short one after it.']), textPage(2, ['Page two.'])]
    const t = await open({ title, pages })
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromMenu()
    await userEvent.click(saveButton())
    const [spec] = lastStart(t)
    expect(spec.baseName.length).toBeLessThanOrEqual(200)
    expect(spec.title.length).toBeLessThanOrEqual(200)
    expect(title.startsWith(spec.title)).toBe(true) // cut at a word boundary, not mid-word
    expect(spec.title.endsWith('word')).toBe(false)
    expect(spec.sentences.length).toBeGreaterThanOrEqual(3)
    for (const x of spec.sentences) expect(x.text.length).toBeLessThanOrEqual(5000)
    const pageOne = spec.sentences.filter((x) => x.page === 1)
    expect(pageOne.map((x) => x.text).join(' ')).toContain('term999.')
    expect(spec.sentences.at(-1)).toEqual({ text: 'A short one after it.', page: 1 })
  })

  it('a typed file name over 200 characters is cut too', async () => {
    const t = await open()
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromMenu()
    const name = screen.getByLabelText('File name')
    await userEvent.clear(name)
    fireEvent.change(name, {
      target: { value: Array.from({ length: 60 }, () => 'notes').join(' ') }
    })
    await userEvent.click(saveButton())
    expect(lastStart(t)[0].baseName.length).toBeLessThanOrEqual(200)
  })

  it('more than 20,000 sentences: says so and disables Save; a page range works', async () => {
    // One long line per page holds 2,100 sentences, so 10 pages make 21,000.
    const line = (k: number): string =>
      Array.from({ length: 2100 }, (_, i) => `Item ${k}-${i} is here.`).join(' ')
    const pages = [
      ...Array.from({ length: 10 }, (_, k) => textPage(k + 1, [line(k)])),
      textPage(11, ['Last page.'])
    ]
    const t = await open({ pages })
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromMenu()
    expect(
      await screen.findByText(
        'This reading is too long for one file. Save a range of pages instead.',
        {},
        { timeout: 30_000 }
      )
    ).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    await userEvent.click(radio(/^Pages/))
    const from = screen.getByLabelText('From page')
    await userEvent.clear(from)
    await userEvent.type(from, '11')
    const to = screen.getByLabelText('To page')
    await userEvent.clear(to)
    await userEvent.type(to, '11')
    expect(
      screen.queryByText('This reading is too long for one file. Save a range of pages instead.')
    ).toBeNull()
    await waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 30_000 })
  }, 90_000)
})

describe('Save as audio panel', () => {
  it('from a selection the panel picks The text I selected', async () => {
    await open()
    await openFromSelection()
    expect(await screen.findByRole('dialog', { name: 'Save as audio' })).toBeTruthy()
    expect(radio(/The text I selected/).checked).toBe(true)
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe(
      'Memory and Attention – p1'
    )
    expect(screen.getByText('Voice: Emma · 1×')).toBeTruthy()
    expect(screen.getByText(/Music › Tide/)).toBeTruthy()
  })

  it('from the More menu it picks the whole reading and says it saves an audiobook', async () => {
    await open()
    await openFromMenu()
    expect(radio(/The whole reading/).checked).toBe(true)
    expect(screen.queryByRole('radio', { name: /The text I selected/ })).toBeNull()
    expect(
      screen.getByText(
        'Whole readings save as an audiobook. Open it in Books on your iPhone and it remembers your place.'
      )
    ).toBeTruthy()
    expect(screen.getByText('.m4b')).toBeTruthy()
  })

  it('Save as MP3 instead switches the format', async () => {
    await open()
    await openFromMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Save as MP3 instead' }))
    expect(screen.getByText('.mp3')).toBeTruthy()
    expect(screen.queryByText(/Whole readings save as an audiobook/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save as audiobook instead' }))
    expect(screen.getByText('.m4b')).toBeTruthy()
  })

  it('page fields reject an empty or reversed range', async () => {
    await open()
    await openFromMenu()
    await userEvent.click(radio(/^Pages/))
    const from = screen.getByLabelText('From page')
    const to = screen.getByLabelText('To page')
    expect(saveButton().disabled).toBe(false)
    await userEvent.clear(from)
    expect(screen.getByText('Nothing to read on those pages.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    await userEvent.type(from, '3')
    await userEvent.clear(to)
    await userEvent.type(to, '2')
    expect(saveButton().disabled).toBe(true)
    await userEvent.clear(to)
    await userEvent.type(to, '9')
    expect(saveButton().disabled).toBe(true)
    await userEvent.clear(to)
    await userEvent.type(to, '3')
    expect(screen.queryByText('Nothing to read on those pages.')).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('a page range with no spoken sentences is refused', async () => {
    const pages = [textPage(1, ['A calm sentence about the sea.']), textPage(2, [])]
    await open({ pages })
    await openFromMenu()
    await userEvent.click(radio(/^Pages/))
    const from = screen.getByLabelText('From page')
    const to = screen.getByLabelText('To page')
    await userEvent.clear(from)
    await userEvent.type(from, '2')
    await userEvent.clear(to)
    await userEvent.type(to, '2')
    expect(screen.getByText('Nothing to read on those pages.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('Save sends the snapped sentences with the voice, the chosen speed and file name', async () => {
    const t = await open({ speed: 1.25 })
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromSelection()
    const name = screen.getByLabelText('File name')
    await userEvent.clear(name)
    await userEvent.type(name, 'My notes')
    await userEvent.click(saveButton())
    const [spec] = lastStart(t)
    expect(spec).toMatchObject({
      readingId: 'r1',
      format: 'mp3',
      baseName: 'My notes',
      title: 'Memory and Attention – p1',
      voice: 'bf_emma',
      speed: 1.25
    })
    expect(spec.sentences).toEqual([{ text: 'Memory is shaped by attention.', page: 1 }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('progress shows, Cancel cancels, and the cancelled toast says Audio not saved.', async () => {
    const t = await open()
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j1', kind: 'progress', done: 2, total: 5 }))
    expect(screen.getByText('Whole reading · 40%')).toBeTruthy()
    expect(screen.getByText('You can keep reading while this finishes.')).toBeTruthy()
    // While busy, the menu says so instead of opening the panel.
    await openFromMenu()
    expect(screen.getByText('Tide is still making your last audio.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    const card = screen.getByText('Making your audio…').closest('section')!
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(t.calls['export.cancel'][0]).toEqual(['j1'])
    act(() => t.emitExport({ jobId: 'j1', kind: 'cancelled' }))
    expect(await screen.findByText('Audio not saved.')).toBeTruthy()
    expect(screen.queryByText('Making your audio…')).toBeNull()
  })

  it.each([
    ['win32', 'Show in folder'],
    ['darwin', 'Show in Finder']
  ])('a saved toast offers the right reveal label on %s', async (platform, label) => {
    const t = await open({ platform })
    fakeStart(t, () => ({ jobId: 'j1' }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j1', kind: 'saved', fileName: 'Notes.m4b' }))
    expect(await screen.findByText('✓ Saved “Notes.m4b”')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(t.calls['export.reveal'][0]).toEqual(['j1'])
  })

  it('a failure toast offers Try again and Choose another folder', async () => {
    const t = await open()
    fakeStart(t, (n) => ({ jobId: `j${n}` }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j1', kind: 'failed', reason: 'disk-full' }))
    expect(await screen.findByText("Couldn't save the audio: your disk is full.")).toBeTruthy()
    const first = lastStart(t)[0]
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(t.calls['export.start']).toHaveLength(2))
    expect(lastStart(t)[0]).toEqual(first)
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j2', kind: 'failed', reason: 'no-permission' }))
    expect(
      await screen.findByText("Couldn't save the audio: Tide isn't allowed to save there.")
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Choose another folder' }))
    await waitFor(() => expect(t.calls['export.start']).toHaveLength(3))
    expect(lastStart(t)[0]).toEqual(first)
    expect(lastStart(t)[1]).toEqual({ chooseFolder: true })
  })

  it('a dismissed folder dialog shows nothing, and a busy answer says so', async () => {
    const t = await open()
    fakeStart(t, () => ({ cancelled: true }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await waitFor(() => expect(t.export.start).toHaveBeenCalled())
    expect(screen.queryByRole('status')?.textContent).toBe('')
    expect(screen.queryByText('Making your audio…')).toBeNull()
    fakeStart(t, () => ({ busy: true }))
    await openFromMenu()
    await userEvent.click(saveButton())
    expect(await screen.findByText('Tide is still making your last audio.')).toBeTruthy()
  })
})

describe('Save as audio fix round 1', () => {
  it('a new job clears an unclicked failure toast, so its saved toast shows', async () => {
    const t = await open()
    fakeStart(t, (n) => ({ jobId: `j${n}` }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j1', kind: 'failed', reason: 'disk-full' }))
    await screen.findByText("Couldn't save the audio: your disk is full.")
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    expect(screen.queryByText(/Couldn't save the audio/)).toBeNull()
    act(() => t.emitExport({ jobId: 'j2', kind: 'saved', fileName: 'Later.m4b' }))
    expect(await screen.findByText('✓ Saved “Later.m4b”')).toBeTruthy()
  })

  it('a stale Try again never clobbers a running job', async () => {
    const t = await open()
    fakeStart(t, (n) => ({ jobId: `j${n}` }))
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    act(() => t.emitExport({ jobId: 'j1', kind: 'failed', reason: 'failed' }))
    const again = await screen.findByRole('button', { name: 'Try again' })
    // Hold the second start open, then fire the old toast's action while the job runs.
    await openFromMenu()
    await userEvent.click(saveButton())
    await screen.findByText('Making your audio…')
    fireEvent.click(again)
    expect(t.calls['export.start']).toHaveLength(2)
    expect(screen.getByText('Making your audio…')).toBeTruthy()
    act(() => t.emitExport({ jobId: 'j2', kind: 'saved', fileName: 'Kept.m4b' }))
    expect(await screen.findByText('✓ Saved “Kept.m4b”')).toBeTruthy()
  })

  it('a rejected start shows the failure toast, not the busy message', async () => {
    const t = await open()
    t.export.start = vi.fn(() => Promise.reject(new Error('ipc down')))
    await openFromMenu()
    await userEvent.click(saveButton())
    expect(await screen.findByText("Couldn't save the audio: something went wrong.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeTruthy()
    expect(screen.queryByText('Making your audio…')).toBeNull()
    expect(screen.queryByText('Tide is still making your last audio.')).toBeNull()
  })

  it('Cancel is disabled until the job has an id', async () => {
    const t = await open()
    t.export.start = vi.fn(() => new Promise<never>(() => {}))
    await openFromMenu()
    await userEvent.click(saveButton())
    const card = (await screen.findByText('Making your audio…')).closest('section')!
    expect(
      (within(card).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
