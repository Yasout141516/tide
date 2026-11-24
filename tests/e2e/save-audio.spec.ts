import { execFileSync, spawnSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { ffmpegPath } from '../../src/main/export/ffmpeg'
import { addFixtureReading, highlightIds } from './helpers'
import { launchTide } from './launch'

// A first export loads the voice model (several seconds cold) and synthesizes for real.
test.setTimeout(240_000)
const SAVE_MS = 150_000

/** Pages of listen.pdf that have spoken sentences, from its fixture sidecar (not pageCount). */
const LISTEN_PAGES_WITH_TEXT = (
  JSON.parse(
    readFileSync(resolve(__dirname, '..', 'fixtures', 'pdfs', 'listen.json'), 'utf8')
  ) as { pages: { spoken: string }[] }
).pages.filter((p) => p.spoken.trim() !== '').length

const resultsDir = resolve(__dirname, '..', '..', 'test-results')

async function launch(file: string): Promise<{ app: ElectronApplication; win: Page; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tide-music-'))
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1', TIDE_MUSIC_DIR: dir })
  const win = await app.firstWindow()
  await addFixtureReading(app, win, file, 'PSYC 201')
  await expect(win.locator('[data-sentence-count]')).toBeVisible({ timeout: 30_000 })
  await expect(win.locator('[data-page="1"] [data-item-index]').nth(1)).toBeVisible()
  // The one-time selection tip slides in above the pages and moves them, so settle it first.
  await win.getByRole('button', { name: 'Got it' }).click()
  await expect(win.getByRole('button', { name: 'Got it' })).toHaveCount(0)
  return { app, win, dir: join(dir, 'Tide') }
}

const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])

/** What ffmpeg says about a file (it exits non-zero with no output file; the info is on stderr). */
const probe = (file: string): string =>
  spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr

const durationSec = (info: string): number => {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(info)
  if (!m) throw new Error('no duration in ffmpeg output')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Selects text by a real mouse drag over the page-1 text layer, from the start of line `from` to the
 * middle of line `to` (the text layer's divs are the lines, in reading order).
 */
async function dragSelect(win: Page, from: number, to: number): Promise<void> {
  const items = win.locator('[data-page="1"] [data-item-index]')
  const a = (await items.nth(from).boundingBox())!
  const b = (await items.nth(to).boundingBox())!
  await win.mouse.move(a.x + 2, a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 5 })
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await win.mouse.up()
  await expect(win.getByRole('toolbar', { name: 'Selected text' })).toBeVisible()
}

async function openSavePanelFromMenu(win: Page): Promise<void> {
  await win.getByRole('button', { name: /^More options for/ }).click()
  await win.getByRole('menuitem', { name: 'Save as audio…' }).click()
  await expect(win.getByRole('dialog', { name: 'Save as audio' })).toBeVisible()
}

const saveAudio = (win: Page): Promise<void> =>
  win.getByRole('button', { name: '↓ Save audio' }).click()

const saved = (win: Page): ReturnType<Page['getByText']> => win.getByText(/✓ Saved “/)

const bubbleButton = (win: Page, name: string): ReturnType<Page['getByRole']> =>
  win.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name })

const phase = (win: Page): Promise<string | null> =>
  win.locator('audio[data-phase]').getAttribute('data-phase')

test('select text, Save as audio, saves an MP3 with tags', async () => {
  const { app, win, dir } = await launch('listen.pdf')
  await dragSelect(win, 0, 1)
  // The drag covers all of sentence 0 and the start of sentence 1 ("Gulls followed ...").
  const selected = await win.evaluate(() => String(window.getSelection()))
  expect(selected).toContain('one by one.')
  expect(selected).toContain('Gulls followed')
  await bubbleButton(win, 'Save as audio').click()
  const panel = win.getByRole('dialog', { name: 'Save as audio' })
  await expect(panel.getByRole('radio', { name: /The text I selected/ })).toBeChecked()
  await saveAudio(win)
  await expect(saved(win)).toBeVisible({ timeout: SAVE_MS })

  const out = files(dir)
  expect(out.filter((f) => f.endsWith('.mp3'))).toHaveLength(1)
  expect(out).toHaveLength(1)
  expect(out.some((f) => f.endsWith('.part'))).toBe(false)
  const info = probe(join(dir, out[0]))
  expect(durationSec(info)).toBeGreaterThan(1)
  expect(info).toMatch(/title\s*:\s*\S/)
  expect(info).toMatch(/artist\s*:\s*Tide · Emma/)
  console.log(`selection mp3: ${durationSec(info)} s of audio`)
  await app.close()
})

test('the whole reading saves an audiobook with one chapter per page with text', async () => {
  const { app, win, dir } = await launch('listen.pdf')
  await openSavePanelFromMenu(win)
  await expect(win.getByRole('radio', { name: /The whole reading/ })).toBeChecked()
  const t0 = Date.now()
  await saveAudio(win)
  await expect(saved(win)).toBeVisible({ timeout: SAVE_MS })
  const wallSec = (Date.now() - t0) / 1000

  const out = files(dir)
  expect(out).toHaveLength(1)
  expect(out[0].endsWith('.m4b')).toBe(true)
  const m4b = join(dir, out[0])
  const meta = execFileSync(ffmpegPath(), ['-v', 'error', '-i', m4b, '-f', 'ffmetadata', '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  expect(meta.match(/\[CHAPTER\]/g)).toHaveLength(LISTEN_PAGES_WITH_TEXT)
  expect(meta).toContain('title=Page 1')
  expect(meta).toContain(`title=Page ${LISTEN_PAGES_WITH_TEXT}`)
  const audioSec = durationSec(probe(m4b))
  console.log(
    `whole m4b: ${audioSec.toFixed(1)} s of audio in ${wallSec.toFixed(1)} s (${(audioSec / wallSec).toFixed(2)} s/s, no playback, includes model load)`
  )
  // CI's macOS job checks this file's chapters with AVFoundation (scripts/check-chapters.swift).
  mkdirSync(resultsDir, { recursive: true })
  copyFileSync(m4b, join(resultsDir, 'whole.m4b'))
  writeFileSync(join(resultsDir, 'whole.chapters'), String(LISTEN_PAGES_WITH_TEXT))
  await app.close()
})

test('cancelling leaves no file', async () => {
  const { app, win, dir } = await launch('two-column.pdf')
  await openSavePanelFromMenu(win)
  await saveAudio(win)
  await win.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(win.getByText('Audio not saved.')).toBeVisible({ timeout: 60_000 })
  await expect(saved(win)).toHaveCount(0)
  expect(files(dir)).toEqual([])
  await app.close()
})

test('exporting while playing keeps playback going', async () => {
  const { app, win, dir } = await launch('listen.pdf')
  await win.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => phase(win), { timeout: 90_000 }).toBe('playing')
  const idNow = async (): Promise<number> => Number((await highlightIds(win))[0])

  await openSavePanelFromMenu(win)
  await win.getByRole('radio', { name: 'Pages' }).check()
  await win.getByLabel('From page').fill('1')
  await win.getByLabel('To page').fill('3')
  const t0 = Date.now()
  await saveAudio(win)
  // Playback keeps advancing while the export is running.
  const start = await idNow()
  let advanced = false
  const deadline = Date.now() + SAVE_MS
  while (Date.now() < deadline && (await saved(win).count()) === 0) {
    if ((await idNow()) > start) advanced = true
    await win.waitForTimeout(250)
  }
  await expect(saved(win)).toBeVisible({ timeout: 30_000 })
  const wallSec = (Date.now() - t0) / 1000
  expect(advanced).toBe(true)
  // The reading may even have finished meanwhile (the export is slower than speech while both run).
  expect(['playing', 'finished']).toContain(await phase(win))

  const out = files(dir)
  expect(out).toHaveLength(1)
  const audioSec = durationSec(probe(join(dir, out[0])))
  console.log(
    `export with playback: ${audioSec.toFixed(1)} s of audio in ${wallSec.toFixed(1)} s (${(audioSec / wallSec).toFixed(2)} s/s)`
  )
  await app.close()
})

test('Read from here starts at the selected sentence', async () => {
  const { app, win } = await launch('listen.pdf')
  // Line 2 of page 1 starts inside sentence 1 ("Gulls followed them past the lighthouse.").
  await dragSelect(win, 1, 1)
  await bubbleButton(win, 'Read from here').click()
  await expect.poll(() => phase(win), { timeout: 90_000 }).toBe('playing')
  // The first sentence spoken is the one the drag started in (sentence 1), not a later one.
  expect(await highlightIds(win)).toEqual(['1'])
  await app.close()
})
