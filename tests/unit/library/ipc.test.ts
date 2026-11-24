import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '../../../src/main/library/library'
import type { LibrarySnapshot } from '../../../src/shared/library/types'
import { libraryErrorCode } from '../../../src/shared/ipc-types'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
const listeners = new Map<string, () => void>()
const appListeners = new Map<string, () => void>()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(c, fn),
    on: (c: string, fn: () => void) => listeners.set(c, fn)
  },
  app: { on: (c: string, fn: () => void) => appListeners.set(c, fn) },
  dialog: { showOpenDialog: (...a: unknown[]) => showOpenDialog(...a) }
}))

const { registerLibraryIpc } = await import('../../../src/main/library/ipc')

const snap = {
  courses: [],
  readings: [{ id: 'r1', title: 'Chapter One' }]
} as unknown as LibrarySnapshot

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(now = (): number => 0) {
  handlers.clear()
  listeners.clear()
  appListeners.clear()
  let onChange: (kind?: string) => void = () => {}
  const lib = {
    snapshot: vi.fn(() => snap),
    onChange: vi.fn((cb: (kind?: string) => void) => {
      onChange = cb
      return () => {}
    }),
    pick: vi.fn(() => Promise.resolve({ kind: 'new', pickId: 'p1', fileName: 'a.pdf' })),
    read: vi.fn(() => Promise.resolve({ ok: false, reason: 'missing' })),
    add: vi.fn(() => 'r9'),
    update: vi.fn(),
    remove: vi.fn(),
    relink: vi.fn(() => Promise.resolve({ kind: 'relinked' })),
    useDifferentFile: vi.fn(),
    setCollapsed: vi.fn(),
    setZoom: vi.fn(),
    setVoice: vi.fn(),
    setSettings: vi.fn(),
    setPronunciations: vi.fn(),
    setExportFolder: vi.fn(),
    tipSeen: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
    checkMissing: vi.fn(() => Promise.resolve())
  }
  const send = vi.fn()
  const wcListeners = new Map<string, () => void>()
  const win = {
    isDestroyed: () => false,
    webContents: { send, on: (c: string, fn: () => void) => wcListeners.set(c, fn) }
  }
  const api = registerLibraryIpc(lib as unknown as Library, { window: () => win as never, now })
  const call = (ch: string, ...a: unknown[]): unknown => handlers.get(ch)!({}, ...a)
  return { lib, send, api, call, win, wcListeners, fireChange: (kind?: string) => onChange(kind) }
}

beforeEach(() => showOpenDialog.mockReset())

describe('library IPC', () => {
  it('library:pick shows a PDF-only open dialog and returns cancelled when she cancels', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await call('library:pick')).toEqual({ kind: 'cancelled' })
    const opts = showOpenDialog.mock.calls[0].at(-1)
    expect(opts.filters).toEqual([{ name: 'PDF', extensions: ['pdf'] }])
    expect(opts.properties).toEqual(['openFile'])
    expect(lib.pick).not.toHaveBeenCalled()
  })

  it('library:pick passes the chosen path to Library.pick', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/x/a.pdf'] })
    expect(await call('library:pick')).toEqual({ kind: 'new', pickId: 'p1', fileName: 'a.pdf' })
    expect(lib.pick).toHaveBeenCalledWith('/x/a.pdf')
  })

  it('library:pick gives a path-free error when the file vanished', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/secret/a.pdf'] })
    lib.pick.mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file, open '/secret/a.pdf'"), { code: 'ENOENT' })
    )
    const err = await (call('library:pick') as Promise<unknown>).catch((e) => e)
    expect(libraryErrorCode(err)).toBe('file-unreadable')
    expect((err as Error).message).not.toContain('secret')
  })

  it('library:find titles the dialog with the reading title and relinks', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/x/b.pdf'] })
    expect(await call('library:find', 'r1')).toEqual({ kind: 'relinked' })
    expect(showOpenDialog.mock.calls[0].at(-1).title).toContain('Chapter One')
    expect(lib.relink).toHaveBeenCalledWith('r1', '/x/b.pdf')
  })

  it('library:find returns cancelled, and a path-free error for an unreadable file', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await call('library:find', 'r1')).toEqual({ kind: 'cancelled' })
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/x/b.pdf'] })
    lib.relink.mockRejectedValue(Object.assign(new Error('EACCES /x/b.pdf'), { code: 'EACCES' }))
    const err = await (call('library:find', 'r1') as Promise<unknown>).catch((e) => e)
    expect(libraryErrorCode(err)).toBe('file-unreadable')
    expect((err as Error).message).not.toContain('/x/')
  })

  it('library:use-different surfaces an already-shelved file as already-on-shelf', () => {
    const { call, lib } = setup()
    lib.useDifferentFile.mockImplementation(() => {
      throw new Error('file already on shelf')
    })
    try {
      call('library:use-different', 'r1', 'p1')
      expect.unreachable()
    } catch (err) {
      expect(libraryErrorCode(err)).toBe('already-on-shelf')
    }
  })

  it('library:update rejects unknown keys and wrong types', () => {
    const { call, lib } = setup()
    const pos = { textItemIndex: 0, charOffset: 0 }
    for (const bad of [
      { colour: 1 },
      { position: { page: 0, ...pos } },
      { position: { page: 1.5, ...pos } },
      { position: { page: 1, textItemIndex: -1, charOffset: 0 } },
      { title: 5 },
      { finishIn: 50 },
      { finishIn: '60' },
      { pageCount: -1 },
      { opened: false },
      { finished: 'yes' },
      null,
      'x'
    ])
      expect(() => call('library:update', 'r1', bad), JSON.stringify(bad)).toThrow(
        /library:update expects/
      )
    expect(() => call('library:update', 7, {})).toThrow(/library:update expects/)
    expect(lib.update).not.toHaveBeenCalled()
    call('library:update', 'r1', { title: 'T', position: { page: 2, ...pos }, opened: true })
    expect(lib.update).toHaveBeenCalledTimes(1)
    call('library:update', 'r1', { finishIn: 60 })
    call('library:update', 'r1', { finishIn: null })
    expect(lib.update).toHaveBeenCalledTimes(3)
  })

  it('library:read rejects a ref that is neither {readingId} nor {pickId}', () => {
    const { call, lib } = setup()
    for (const bad of [
      null,
      {},
      'r1',
      { path: '/x.pdf' },
      { readingId: 1 },
      { readingId: 'a', pickId: 'b' }
    ])
      expect(() => call('library:read', bad)).toThrow(/library:read expects/)
    expect(lib.read).not.toHaveBeenCalled()
    call('library:read', { pickId: 'p1' })
    expect(lib.read).toHaveBeenCalledWith({ pickId: 'p1' })
  })

  it('library:add validates its input', () => {
    const { call, lib } = setup()
    for (const bad of [
      null,
      { pickId: 'p', title: 'T', pageCount: 0, course: null },
      { pickId: 'p', title: 'T', pageCount: 3, course: { path: 'x' } },
      { pickId: 'p', title: 'T', pageCount: 3 },
      { pickId: 1, title: 'T', pageCount: 3, course: null }
    ])
      expect(() => call('library:add', bad)).toThrow(/library:add expects/)
    expect(lib.add).not.toHaveBeenCalled()
    expect(
      call('library:add', { pickId: 'p', title: 'T', pageCount: null, course: { newName: 'Bio' } })
    ).toBe('r9')
  })

  it('library:zoom rejects values outside 0.8 to 2', () => {
    const { call, lib } = setup()
    for (const bad of [0.79, 2.01, NaN, Infinity, '1', undefined])
      expect(() => call('library:zoom', bad)).toThrow(/library:zoom expects/)
    expect(lib.setZoom).not.toHaveBeenCalled()
    call('library:zoom', 1.5)
    expect(lib.setZoom).toHaveBeenCalledWith(1.5)
  })

  it('library:settings rejects an unknown theme, key, filter or non-boolean', () => {
    const { call, lib } = setup()
    for (const bad of [
      { theme: 'neon' },
      { theme: 3 },
      { colour: 'red' },
      { darkPages: 'yes' },
      { reading: { skipEverything: true } },
      { reading: { toString: true } },
      { reading: { skipFootnotes: 'no' } },
      { reading: 'x' },
      null,
      'x'
    ])
      expect(() => call('library:settings', bad)).toThrow(/library:settings expects/)
    expect(lib.setSettings).not.toHaveBeenCalled()
  })

  it('library:settings with reading: { skipFootnotes: false } passes only that filter', () => {
    const { call, lib } = setup()
    call('library:settings', { reading: { skipFootnotes: false } })
    expect(lib.setSettings).toHaveBeenCalledWith({ reading: { skipFootnotes: false } })
    call('library:settings', { theme: 'kitty', darkPages: false })
    expect(lib.setSettings).toHaveBeenLastCalledWith({ theme: 'kitty', darkPages: false })
  })

  it('library:pronunciations rejects a non-array or a non-object entry', () => {
    const { call, lib } = setup()
    for (const bad of ['x', null, [3], [null], [{ word: 'a' }], [{ word: 1, sayAs: 'b' }]])
      expect(() => call('library:pronunciations', bad)).toThrow(/library:pronunciations expects/)
    expect(lib.setPronunciations).not.toHaveBeenCalled()
    call('library:pronunciations', [{ word: 'a', sayAs: 'b' }])
    expect(lib.setPronunciations).toHaveBeenCalledWith([{ word: 'a', sayAs: 'b' }])
  })

  it('library:choose-export-folder stores the path in main and returns only chosen or cancelled', async () => {
    const { call, lib } = setup()
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call('library:choose-export-folder')).toBe('cancelled')
    expect(lib.setExportFolder).not.toHaveBeenCalled()
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/x/Audio'] })
    expect(await call('library:choose-export-folder')).toBe('chosen')
    expect(lib.setExportFolder).toHaveBeenCalledWith('/x/Audio')
    expect(showOpenDialog.mock.calls[1].at(-1).properties).toEqual([
      'openDirectory',
      'createDirectory'
    ])
  })

  it('library:reset-export-folder clears the folder', () => {
    const { call, lib } = setup()
    call('library:reset-export-folder')
    expect(lib.setExportFolder).toHaveBeenCalledWith(null)
  })

  it('library:voice rejects an unknown voice or a speed outside SPEEDS', () => {
    const { call, lib } = setup()
    for (const [v, s] of [
      ['af_heart', 1],
      ['bf_emma', 1.1],
      ['bf_emma', '1'],
      [3, 1],
      ['bf_emma', undefined]
    ])
      expect(() => call('library:voice', v, s)).toThrow(/library:voice expects/)
    expect(lib.setVoice).not.toHaveBeenCalled()
    call('library:voice', 'am_puck', 1.25)
    expect(lib.setVoice).toHaveBeenCalledWith('am_puck', 1.25)
  })

  it('library:tip-seen validates its key', () => {
    const { call, lib } = setup()
    for (const k of [1, '', 'a'.repeat(65)])
      expect(() => call('library:tip-seen', k)).toThrow(/library:tip-seen expects/)
    call('library:tip-seen', 'voice')
    expect(lib.tipSeen).toHaveBeenCalledWith('voice')
  })

  it('library:flush resolves after the store flush', async () => {
    const { call, lib } = setup()
    let release: (v: boolean) => void = () => {}
    lib.flush.mockReturnValue(new Promise<boolean>((r) => (release = r)))
    let resolved = false
    const p = (call('library:flush') as Promise<void>).then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    release(true)
    await p
    expect(resolved).toBe(true)
  })

  it('position-only updates are broadcast at most once every 3 s, trailing; other changes are broadcast at once and carry the latest position', () => {
    vi.useFakeTimers()
    try {
      const { fireChange, send, lib } = setup()
      let page = 1
      lib.snapshot.mockImplementation(() => ({ ...snap, page }) as never)
      page = 2
      fireChange('position')
      page = 3
      vi.advanceTimersByTime(1000)
      fireChange('position')
      page = 4
      vi.advanceTimersByTime(1000)
      fireChange('position')
      expect(send).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenLastCalledWith('library:changed', { ...snap, page: 4 })
      vi.advanceTimersByTime(10_000)
      expect(send).toHaveBeenCalledTimes(1)
      // a non-position change sends now and cancels the pending trailing broadcast
      page = 5
      fireChange('position')
      page = 6
      fireChange('other')
      expect(send).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenLastCalledWith('library:changed', { ...snap, page: 6 })
      vi.advanceTimersByTime(10_000)
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('library:collapse and library:remove validate their arguments', () => {
    const { call, lib } = setup()
    expect(() => call('library:collapse', 'k', 'yes')).toThrow(/library:collapse expects/)
    expect(() => call('library:remove', 3)).toThrow(/library:remove expects/)
    call('library:collapse', 'k', true)
    call('library:remove', 'r1')
    expect(lib.setCollapsed).toHaveBeenCalledWith('k', true)
    expect(lib.remove).toHaveBeenCalledWith('r1')
  })

  it('broadcasts library:changed with the snapshot after a change', () => {
    const { fireChange, send, lib } = setup()
    expect(lib.onChange).toHaveBeenCalledTimes(1)
    fireChange()
    expect(send).toHaveBeenCalledWith('library:changed', snap)
  })

  it('commands sent before app:ready are delivered in order after it', () => {
    const { api, send } = setup()
    api.send({ type: 'add-reading' })
    api.send({ type: 'zoom', step: 1 })
    expect(send).not.toHaveBeenCalled()
    listeners.get('app:ready')!()
    expect(send.mock.calls).toEqual([
      ['app:command', { type: 'add-reading' }],
      ['app:command', { type: 'zoom', step: 1 }]
    ])
    api.send({ type: 'zoom', step: -1 })
    expect(send).toHaveBeenLastCalledWith('app:command', { type: 'zoom', step: -1 })
  })

  it('queues commands again when the window is re-created, until the next app:ready', () => {
    const { api, send, win } = setup()
    listeners.get('app:ready')!()
    api.send({ type: 'add-reading' })
    expect(send).toHaveBeenCalledTimes(1)
    send.mockClear()
    api.attachWindow(win as never) // macOS activate after the window was destroyed
    api.send({ type: 'zoom', step: 1 })
    expect(send).not.toHaveBeenCalled()
    listeners.get('app:ready')!()
    expect(send.mock.calls).toEqual([['app:command', { type: 'zoom', step: 1 }]])
  })

  it('queues commands again while the renderer reloads', () => {
    const { api, send, win, wcListeners } = setup()
    api.attachWindow(win as never)
    listeners.get('app:ready')!()
    wcListeners.get('did-start-loading')!()
    api.send({ type: 'add-reading' })
    expect(send).not.toHaveBeenCalled()
    listeners.get('app:ready')!()
    expect(send).toHaveBeenCalledWith('app:command', { type: 'add-reading' })
  })

  it('re-checks missing files when the window gains focus', () => {
    let t = 10_000
    const { lib } = setup(() => t)
    const focus = appListeners.get('browser-window-focus')!
    focus()
    expect(lib.checkMissing).toHaveBeenCalledTimes(1)
    t += 4_000
    focus()
    expect(lib.checkMissing).toHaveBeenCalledTimes(1) // throttled to once per 5 s
    t += 1_500
    focus()
    expect(lib.checkMissing).toHaveBeenCalledTimes(2)
  })
})
