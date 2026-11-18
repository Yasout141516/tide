/**
 * Her real readings in the real app. They live only in the git-ignored `local-fixtures/` folder, so
 * this spec has no tests on CI or on any machine without them. Test names carry the reading's index
 * only, and nothing from a reading (name, title, text) is ever logged or asserted on.
 *
 * For each reading: it renders (a canvas has non-white pixels), stepping moves the highlight with every
 * box inside its page canvas, and quit + relaunch lands on the same sentence.
 */
import { copyFileSync, existsSync, readdirSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect, type Page } from '@playwright/test'
import { launchTide } from './launch'

const DIR = resolve(__dirname, '..', '..', 'local-fixtures')
const pdfs = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort()
  : []

const current = (win: Page): Promise<string[]> =>
  win.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[data-testid="sentence-highlight"]')].map(
        (e) => (e as HTMLElement).dataset.sentenceId!
      )
    )
  ])

const insideCanvas = (win: Page): Promise<boolean> =>
  win.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid="sentence-highlight"]')]
    return (
      boxes.length > 0 &&
      boxes.every((b) => {
        const c = b.closest('[data-page]')!.querySelector('canvas')!.getBoundingClientRect()
        const r = b.getBoundingClientRect()
        return (
          r.left >= c.left - 1 &&
          r.top >= c.top - 1 &&
          r.right <= c.right + 1 &&
          r.bottom <= c.bottom + 1
        )
      })
    )
  })

pdfs.forEach((file, i) => {
  test(`local reading ${i + 1}: renders, steps, and resumes after a restart`, async () => {
    test.setTimeout(180_000)
    const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
    const dest = join(await mkdtemp(join(tmpdir(), 'tide-pdf-')), 'reading.pdf')
    copyFileSync(join(DIR, file), dest)

    let app = await launchTide({ TIDE_USER_DATA: userData })
    let win = await app.firstWindow()
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never
    }, dest)
    await win.getByRole('button', { name: 'Add reading' }).first().click()
    await win
      .getByRole('dialog', { name: 'Which course is this for?' })
      .getByRole('button', { name: 'Skip' })
      .click()

    // Renders: some page canvas has non-white pixels.
    await expect
      .poll(
        () =>
          win.evaluate(() =>
            [...document.querySelectorAll<HTMLCanvasElement>('[data-page] canvas')].some((c) => {
              if (c.width === 0) return false
              const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
              for (let k = 0; k < px.length; k += 4)
                if (px[k + 3] > 0 && (px[k] < 240 || px[k + 1] < 240 || px[k + 2] < 240))
                  return true
              return false
            })
          ),
        { timeout: 60_000 }
      )
      .toBe(true)

    // Steps: the highlight appears, moves one sentence per press, and stays inside its canvas.
    await expect(win.locator('[data-testid="sentence-highlight"]').first()).toBeVisible({
      timeout: 60_000
    })
    const first = Number((await current(win))[0])
    expect(await insideCanvas(win)).toBe(true)
    for (let step = 1; step <= 3; step++) {
      await win.keyboard.press('ArrowRight')
      await expect.poll(() => current(win)).toEqual([String(first + step)])
      expect(await insideCanvas(win)).toBe(true)
    }
    const at = String(first + 3)

    // Resumes: the same sentence after a quit and relaunch.
    await app.close()
    app = await launchTide({ TIDE_USER_DATA: userData })
    win = await app.firstWindow()
    await win
      .getByRole('navigation', { name: 'Readings' })
      .getByRole('button')
      .filter({ hasNot: win.locator('[aria-label^="More options"]') })
      .filter({ hasText: /\S/ })
      .last()
      .click()
    await expect.poll(() => current(win), { timeout: 60_000 }).toEqual([at])
    await app.close()
  })
})
