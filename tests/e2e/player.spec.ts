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
  // The only writer: the first Play of a fresh launch (it includes the model load). CI prints it.
  writeFileSync(
    join(dir, 'first-audio.json'),
    JSON.stringify({ measured: 'first Play of a fresh launch', firstAudioMs })
  )

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

/** Starts playing, then minimises or hides the window and expects the highlight to keep advancing. */
async function playsThrough(
  app: Awaited<ReturnType<typeof launchTide>>,
  action: 'minimize' | 'hide'
): Promise<void> {
  const win = await openListen(app)
  await playAndTime(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)
  await app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0][a](), action)
  const at = await idNumber(win)
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThan(at)
  expect(await phase(win)).toBe('playing')
}

test('playback continues while the window is minimised', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  await playsThrough(app, 'minimize')
  await app.close()
})

test('playback continues while the window is hidden (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'hide() is the Cmd+H case, which only exists on macOS')
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  await playsThrough(app, 'hide')
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

/** Writes the jump timing next to first-audio.json (the only writer of jump-audio.json). */
function logJump(jumpMs: number): void {
  const dir = resolve(__dirname, '..', '..', 'test-results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'jump-audio.json'),
    JSON.stringify({
      measured: 'click on a sentence outside the prefetch window to playing',
      packaged: process.env.TIDE_PACKAGED === '1',
      jumpMs
    })
  )
}

// Limit (R32): 4500 ms locally (uncached packaged runs measured 2.4-3.4 s); on CI the larger of 6000 ms and
// twice this run's own first audio, so a slow runner does not fail a test that measures a regression.
test('a jump to another paragraph starts speaking promptly', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  expect(await ids(win)).toBe('0')
  const firstAudioMs = await playAndTime(win)
  // Warm: let the voice settle on the first paragraph, as a listener who has been reading a while.
  await expect.poll(() => idNumber(win), { timeout: ADVANCE_MS }).toBeGreaterThanOrEqual(1)

  // The last sentence is on page 3: far outside the cached window, so it is not synthesised yet.
  const target = 19
  const at = await win.evaluate(
    (i) =>
      (
        window as unknown as {
          __tideSentenceCentre?: (i: number) => { page: number; fx: number; fy: number } | null
        }
      ).__tideSentenceCentre?.(i) ?? null,
    target
  )
  if (!at) throw new Error(`sentence ${target} has no place on a page`)
  const page = win.locator(`[data-page="${at.page}"]`)
  await page.scrollIntoViewIfNeeded()
  const box = await page.boundingBox()
  if (!box) throw new Error(`page ${at.page} is not on screen`)

  // Only a 'buffering' seen after this click counts; nothing before it can.
  let sawBuffering = false
  const t0 = Date.now()
  await page.click({ position: { x: box.width * at.fx, y: box.height * at.fy } })
  await expect
    .poll(
      async () => {
        const p = await phase(win)
        if (p === 'buffering') sawBuffering = true
        // The highlight moves on the click while the old clip may still show 'playing' for a frame, so
        // only a 'playing' that follows 'buffering' is the target's own audio.
        return sawBuffering && (await ids(win)) === String(target) && p === 'playing'
      },
      { timeout: 15_000, intervals: [20] }
    )
    .toBe(true)
  const jumpMs = Date.now() - t0
  console.log(`jump: ${jumpMs} ms from click to playing`)
  logJump(jumpMs)
  const limit = process.env.CI ? Math.max(6000, 2 * firstAudioMs) : 4500
  console.log(`jump limit: ${limit} ms (first audio in this test: ${firstAudioMs} ms)`)
  expect(jumpMs).toBeLessThanOrEqual(limit)
  await app.close()
})

test('Finish in 60 min shows the estimate and the effective speed', async () => {
  // Each launch has its own throw-away user data dir, so the reading's finishIn never outlives the test.
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await openListen(app)
  await win.getByRole('button', { name: 'More options for Harbour Tides Week 2' }).click()
  await win.getByRole('menuitem', { name: /Finish in/ }).click()
  // Keyboard: a pointer click on the submenu item does not register under Playwright here.
  const sixty = win.getByRole('menuitemradio', { name: '60 min' })
  await expect(sixty).toBeVisible()
  await win.keyboard.press('ArrowRight')
  for (let i = 0; i < 6 && (await sixty.getAttribute('data-highlighted')) === null; i++)
    await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  // A short reading fits in an hour at 1×, so the speed stays 1×, and the estimate names it.
  await expect(win.getByText(/^Finishes in about \d+ min at 1×$/)).toBeVisible()
  await expect(win.getByRole('button', { name: 'Emma · 1×' })).toBeVisible()
  await app.close()
})
