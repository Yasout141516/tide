import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ExportEvent, ExportSpec, TtsAudio } from '../../../src/shared/ipc-types'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
const showItemInFolder = vi.fn()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  },
  app: { getPath: () => 'REAL-MUSIC' },
  dialog: { showOpenDialog: (...a: unknown[]) => showOpenDialog(...a) },
  shell: { showItemInFolder: (p: string) => showItemInFolder(p) }
}))

const { registerExportIpc, resolveMusicDir } = await import('../../../src/main/export/ipc')

const spec = (over: Partial<ExportSpec> = {}): ExportSpec => ({
  readingId: 'r1',
  format: 'm4b',
  baseName: 'Week 3: Memory',
  title: 'Week 3 notes',
  sentences: [
    { text: 'First sentence.', page: 1 },
    { text: 'Second sentence.', page: 2 }
  ],
  voice: 'bf_emma',
  speed: 1,
  ...over
})
const audio = (): TtsAudio => ({
  pcm: Float32Array.from({ length: 12000 }, (_, i) => 0.2 * Math.sin(i / 10)),
  sampleRate: 24000,
  synthMs: 1,
  chunks: 1
})

describe('export:start and friends', () => {
  let music: string
  let events: ExportEvent[]
  let gate: { resolve(): void } | null
  let pendingRejects: ((e: Error) => void)[]
  const host = {
    synthesize: vi.fn(
      () =>
        new Promise<TtsAudio>((resolve, reject) => {
          pendingRejects.push(reject)
          gate = { resolve: () => resolve(audio()) }
        })
    ),
    cancel: vi.fn(() => {
      for (const r of pendingRejects.splice(0))
        r(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    })
  }
  const win = {
    isDestroyed: () => false,
    webContents: { send: (_c: string, e: ExportEvent) => events.push(e) }
  } as unknown as BrowserWindow
  const start = (s: unknown, o?: unknown): Promise<unknown> =>
    Promise.resolve(handlers.get('export:start')!({}, s, o))
  const until = async (pred: (e: ExportEvent) => boolean): Promise<ExportEvent> => {
    for (let i = 0; i < 400; i++) {
      const hit = events.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('event never came: ' + JSON.stringify(events))
  }

  beforeEach(() => {
    music = mkdtempSync(join(tmpdir(), 'tide-ipc-'))
    events = []
    gate = null
    pendingRejects = []
    handlers.clear()
    showOpenDialog.mockReset()
    showItemInFolder.mockReset()
    host.synthesize.mockClear()
    host.cancel.mockClear()
    registerExportIpc({
      host,
      window: () => win,
      env: { TIDE_E2E: '1', TIDE_MUSIC_DIR: music },
      albumFor: (id) => (id === 'r1' ? 'PSYC 201' : null)
    })
  })
  afterEach(() => rmSync(music, { recursive: true, force: true }))

  it('rejects a bad spec', () => {
    host.synthesize.mockClear()
    const bad: unknown[] = [
      null,
      'x',
      spec({ format: 'wav' as 'mp3' }),
      spec({ voice: 'af_heart' }),
      spec({ speed: 1.1 }),
      spec({ speed: NaN }),
      spec({ sentences: [] }),
      spec({
        sentences: [
          { text: '', page: 1 },
          { text: ' 	 ', page: 2 }
        ]
      }),
      spec({ sentences: [{ text: 'x'.repeat(5001), page: 1 }] }),
      spec({ sentences: [{ text: 'ok', page: 0 }] }),
      spec({ sentences: [{ text: 'ok', page: 1.5 }] }),
      spec({ sentences: [{ text: 5 as unknown as string, page: 1 }] }),
      spec({ baseName: 'x'.repeat(201) }),
      spec({ title: 7 as unknown as string }),
      spec({ readingId: 3 as unknown as string })
    ]
    for (const s of bad)
      expect(() => handlers.get('export:start')!({}, s), JSON.stringify(s)).toThrow(
        /export:start expects/
      )
    const many = Array.from({ length: 20001 }, () => ({ text: 'a', page: 1 }))
    expect(() => handlers.get('export:start')!({}, spec({ sentences: many }))).toThrow()
    expect(host.synthesize).not.toHaveBeenCalled()
  })

  it('returns busy while a job runs, cancels it cleanly and then accepts another', async () => {
    const first = (await start(spec())) as { jobId: string }
    expect(first.jobId).toEqual(expect.any(String))
    expect(await start(spec())).toEqual({ busy: true })

    await vi.waitFor(() => expect(host.synthesize).toHaveBeenCalled())
    await handlers.get('export:cancel')!({}, first.jobId)
    expect(await until((e) => e.kind === 'cancelled')).toMatchObject({ jobId: first.jobId })
    expect(host.cancel).toHaveBeenCalledWith(`export-${first.jobId}`)
    expect(readdirSync(join(music, 'Tide'))).toEqual([])

    const second = await start(spec())
    expect(second).toEqual({ jobId: expect.any(String) })
    await handlers.get('export:cancel')!({}, (second as { jobId: string }).jobId)
  })

  it('saves a safely named, chaptered file, reports progress and reveals it', async () => {
    const { jobId } = (await start(spec())) as { jobId: string }
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() => expect(host.synthesize).toHaveBeenCalledTimes(i + 1))
      gate!.resolve()
    }
    const saved = await until((e) => e.kind === 'saved')
    expect(saved).toEqual({ jobId, kind: 'saved', fileName: 'Week 3- Memory.m4b' })
    expect(events.filter((e) => e.kind === 'progress').at(-1)).toMatchObject({ done: 2, total: 2 })
    expect(host.synthesize).toHaveBeenCalledWith(
      'First sentence.',
      expect.objectContaining({ priority: 'export', gen: `export-${jobId}`, speed: 1 })
    )
    expect(readdirSync(join(music, 'Tide'))).toEqual(['Week 3- Memory.m4b'])

    await handlers.get('export:reveal')!({}, jobId)
    expect(showItemInFolder).toHaveBeenCalledWith(join(music, 'Tide', 'Week 3- Memory.m4b'))
  })

  it('reports a failure when the folder cannot be made', async () => {
    rmSync(music, { recursive: true, force: true })
    handlers.clear()
    registerExportIpc({
      host,
      window: () => win,
      env: { TIDE_E2E: '1', TIDE_MUSIC_DIR: join(music, 'a\u0000b') }
    })
    await start(spec())
    expect(await until((e) => e.kind === 'failed')).toMatchObject({ kind: 'failed' })
  })

  it('chooseFolder uses main’s own dialog and a cancel starts nothing', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await start(spec(), { chooseFolder: true })).toEqual({ cancelled: true })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    expect(host.synthesize).not.toHaveBeenCalled()
    expect(existsSync(join(music, 'Tide'))).toBe(false)
    // and the cancelled dialog did not leave the service busy
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await start(spec(), { chooseFolder: true })).toEqual({ cancelled: true })
  })

  it('calls the host as a method: its synthesize and cancel depend on `this`', async () => {
    handlers.clear()
    const real = {
      calls: 0,
      synthesize(): Promise<TtsAudio> {
        this.calls++
        return Promise.resolve(audio())
      },
      cancel(): void {
        this.calls++
      }
    }
    registerExportIpc({
      host: real,
      window: () => win,
      env: { TIDE_E2E: '1', TIDE_MUSIC_DIR: music }
    })
    await start(spec())
    expect(await until((e) => e.kind === 'saved' || e.kind === 'failed')).toMatchObject({
      kind: 'saved'
    })
    expect(real.calls).toBeGreaterThan(0)
  })

  it('rejects bad cancel and reveal ids', () => {
    expect(() => handlers.get('export:cancel')!({}, 5)).toThrow()
    expect(() => handlers.get('export:reveal')!({}, 'x'.repeat(65))).toThrow()
  })
})

describe('resolveMusicDir', () => {
  it('TIDE_MUSIC_DIR is ignored without TIDE_E2E', () => {
    const getPath = (): string => 'REAL-MUSIC'
    expect(resolveMusicDir({ TIDE_MUSIC_DIR: '/elsewhere' }, getPath)).toBe('REAL-MUSIC')
    expect(resolveMusicDir({ TIDE_E2E: '0', TIDE_MUSIC_DIR: '/elsewhere' }, getPath)).toBe(
      'REAL-MUSIC'
    )
    expect(resolveMusicDir({ TIDE_E2E: '1', TIDE_MUSIC_DIR: '/elsewhere' }, getPath)).toBe(
      '/elsewhere'
    )
    expect(resolveMusicDir({ TIDE_E2E: '1' }, getPath)).toBe('REAL-MUSIC')
  })
})
