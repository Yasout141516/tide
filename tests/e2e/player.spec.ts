import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect, type Page } from '@playwright/test'
import { addFixtureReading, highlightIds, openShelf } from './helpers'
import { launchTide } from './launch'

// The first Play loads the voice model (several seconds on a cold start); a sentence is a few seconds.
test.setTimeout(150_000)
const LOAD_MS = 90_000
const ADVANCE_MS = 40_000

/** The player's phase, which the provider mirrors on its hidden <audio> when window.tideTest exists. */
const phase = (win: Page): Promise<string | null> =>
  win.locator('audio[data-phase]').getAttribute('data-phase')

const ids = async (win: Page): Promise<string> => (await highlightIds(win)).join(',')
const idNumber = async (win: Page): Promise<number> => Number((await highlightIds(win))[0])

const playButton = (win: Page): ReturnType<Page['getByRole']> =>
  win.getByRole('button', { name: 'Play', exact: true })

/** Space is ignored on a focused button, so drop focus before using the keyboard like a listener. */
const releaseFocus = (win: Page): Promise<void> =>
  win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

/** Clicks Play and returns the milliseconds until the player reports `playing` (first audio). */
async function playAndTime(win: Page): Promise<number> {
  const t0 = Date.now()
  await playButton(win).click()
  await expect.poll(() => phase(win), { timeout: LOAD_MS, intervals: [50] }).toBe('playing')
  return Date.now() - t0
}

async function openListen(app: Awaited<ReturnType<typeof launchTide>>): Promise<Page> {
  const win = await app.firstWindow()
  await addFixtureReading(app, win, 'listen.pdf', 'PSYC 201')
  // Building sentences runs in a worker, which is slow when several Tide windows share the machine.
  await expect(win.locator('[data-sentence-count]')).toBeVisible({ timeout: 30_000 })
  await expect(playButton(win)).toBeEnabled()
  return win
}

test('Play speaks and the highlight advances to the next sentence', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  expect(await ids(win)).toBe('0')

  const firstAudioMs = await playAndTime(win)
  console.log(`first audio: ${firstAudioMs} ms from Play to playing`)
  const dir = resolve(__dirname, '..', '..', 'test-results')
  mkdirSync(dir, { recursive: true })
  // CI prints this file in the job summary (the first-audio latency of the voice player).
  writeFileSync(join(dir, 'first-audio.json'), JSON.stringify({ firstAudioMs }))

  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)
  const at = await idNumber(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThan(at)
  expect(await phase(win)).toBe('playing')
  await app.close()
})

test('Space pauses and the position is flushed: a restart opens at the same sentence', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
  let app = await launchTide({ TIDE_USER_DATA: userData, TIDE_OFFLINE_GUARD: '1' })
  let win = await openListen(app)

  await releaseFocus(win)
  await win.keyboard.press('Space')
  await expect.poll(() => phase(win), { timeout: LOAD_MS }).toBe('playing')
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)
  await win.keyboard.press('Space')
  await expect.poll(() => phase(win), { timeout: 5_000 }).toBe('paused')
  const at = await ids(win)
  expect(Number(at)).toBeGreaterThanOrEqual(1)
  // Paused: the sentence stays put.
  await win.waitForTimeout(1_500)
  expect(await ids(win)).toBe(at)
  // Pausing flushes the place to disk without waiting for a quit.
  await expect
    .poll(
      () =>
        (
          JSON.parse(readFileSync(join(userData, 'library.json'), 'utf8')) as {
            readings: { position: unknown }[]
          }
        ).readings[0].position,
      { timeout: 10_000 }
    )
    .toMatchObject({ page: expect.any(Number), textItemIndex: expect.any(Number) })
  await app.close()

  app = await launchTide({ TIDE_USER_DATA: userData, TIDE_OFFLINE_GUARD: '1' })
  win = await app.firstWindow()
  await (await openShelf(win)).getByRole('button', { name: /Harbour Tides/ }).click()
  await expect.poll(() => ids(win), { timeout: 20_000 }).toBe(at)
  await app.close()
})

test('→ skips forward and ← goes back', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  expect(await ids(win)).toBe('0')
  await releaseFocus(win)

  // Each skip is 15 s, several of these short sentences.
  await win.keyboard.press('ArrowRight')
  await expect.poll(() => idNumber(win), { timeout: 5_000 }).toBeGreaterThanOrEqual(2)
  const forward = await idNumber(win)
  await win.keyboard.press('ArrowRight')
  await expect.poll(() => idNumber(win), { timeout: 5_000 }).toBeGreaterThan(forward)
  const further = await idNumber(win)
  await win.keyboard.press('ArrowLeft')
  await expect.poll(() => idNumber(win), { timeout: 5_000 }).toBeLessThan(further)
  await app.close()
})

test('playback continues while the window is minimised', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  await playAndTime(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.minimize()
    // On macOS the window can also be hidden (Cmd+H); audio must survive that too.
    if (process.platform === 'darwin') w.hide()
  })
  const at = await idNumber(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThan(at)
  expect(await phase(win)).toBe('playing')
  await app.close()
})

test('Now Playing metadata names the reading and course', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  await expect
    .poll(() =>
      win.evaluate(() => {
        const m = navigator.mediaSession.metadata
        return m ? { title: m.title, artist: m.artist } : null
      })
    )
    .toEqual({ title: 'Harbour Tides Week 2', artist: 'PSYC 201' })
  await app.close()
})

test('changing speed re-synthesises and keeps playing', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  await playAndTime(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)

  await win.getByRole('button', { name: 'Emma · 1×' }).click()
  await win.getByRole('radio', { name: '1.5×' }).click()
  await expect(win.getByRole('button', { name: 'Emma · 1.5×' })).toBeVisible()
  await win.keyboard.press('Escape')

  const at = await idNumber(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThan(at)
  expect(await phase(win)).toBe('playing')
  await app.close()
})

test('reaching the end offers the next reading', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  // The reading added last is the newest, so the one added first is the one offered after it.
  await addFixtureReading(app, win, 'listen-next.pdf')
  await addFixtureReading(app, win, 'listen-short.pdf')
  await expect(win.getByRole('heading', { level: 2, name: 'Lantern Notes Week 1' })).toBeVisible()
  await expect(win.locator('[data-sentence-count]')).toBeVisible({ timeout: 30_000 })
  await expect(playButton(win)).toBeEnabled()

  await playButton(win).click()
  await expect(win.getByText('Finished ✓ · Next: Lantern Notes Week 2')).toBeVisible({
    timeout: LOAD_MS
  })
  await win.getByRole('button', { name: 'Play next' }).click()
  await expect(win.getByRole('heading', { level: 2, name: 'Lantern Notes Week 2' })).toBeVisible()
  await expect.poll(() => phase(win), { timeout: LOAD_MS }).toBe('playing')
  await app.close()
})
