import { copyFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

/** The distinct sentence ids currently highlighted on the page. */
export const highlightIds = (win: Page): Promise<string[]> =>
  win.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[data-testid="sentence-highlight"]')].map(
        (e) => (e as HTMLElement).dataset.sentenceId!
      )
    )
  ])

/** Every highlight box of the current sentence lies inside its page canvas. */
export const boxesInsideCanvas = (win: Page): Promise<boolean> =>
  win.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid="sentence-highlight"]')]
    if (boxes.length === 0) return false
    return boxes.every((b) => {
      const canvas = b.closest('[data-page]')!.querySelector('canvas')!.getBoundingClientRect()
      const r = b.getBoundingClientRect()
      const e = 1
      return (
        r.left >= canvas.left - e &&
        r.top >= canvas.top - e &&
        r.right <= canvas.right + e &&
        r.bottom <= canvas.bottom + e
      )
    })
  })

const shelfButton = (win: Page): Locator => win.getByRole('button', { name: 'Shelf', exact: true })
const shelfRegion = (win: Page): Locator => win.getByRole('navigation', { name: 'Readings' })

/** Resolves once the app has rendered its shelf (wide layout) or its Shelf button (narrow layout). */
export async function shelfReady(win: Page): Promise<void> {
  await shelfRegion(win).or(shelfButton(win)).first().waitFor()
}

/**
 * Makes the shelf usable in either layout and returns its region. In the narrow layout (the e2e
 * windows are pinned to one, see launchTide) the shelf sits behind the "Shelf" button, so it is opened
 * first; picking a reading closes that overlay again, so call this before every shelf interaction.
 * In the wide layout, or with the overlay already open, there is no visible Shelf button and nothing is clicked.
 */
export async function openShelf(win: Page): Promise<Locator> {
  await shelfReady(win)
  const button = shelfButton(win)
  if (await button.isVisible()) await button.click()
  const shelf = shelfRegion(win)
  await shelf.waitFor()
  return shelf
}

/** Opens Settings from the shelf, picks the theme radio labelled `label`, closes Settings and checks html[data-theme]. */
export async function setTheme(win: Page, label: string, id: string): Promise<void> {
  await openShelf(win)
  await win.getByRole('button', { name: /Settings/ }).click()
  const dialog = win.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('radio', { name: label }).click()
  await win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(win.locator('html')).toHaveAttribute('data-theme', id)
}

/** Opens the shelf if needed and clicks "Add reading" (a sibling of the readings list, not inside it). */
export async function clickAddReading(win: Page): Promise<void> {
  await openShelf(win)
  await win.getByRole('button', { name: 'Add reading' }).click()
}

/** Closes the narrow-layout Shelf overlay if it is open, so the reader behind it is reachable again. */
export async function closeShelf(win: Page): Promise<void> {
  const overlay = win.getByRole('dialog', { name: 'Shelf', exact: true })
  if (await overlay.isVisible()) await win.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
}

/**
 * Clicks the centre of sentence `id` (the app, under TIDE_E2E, says where it is) and waits for it to be
 * the highlighted one. A click picks the sentence under it; there is no key that steps one sentence now
 * (← / → skip 15 s).
 */
export async function clickSentence(win: Page, id: number): Promise<void> {
  const at = await win.evaluate(
    (i) =>
      (
        window as unknown as {
          __tideSentenceCentre?: (i: number) => { page: number; fx: number; fy: number } | null
        }
      ).__tideSentenceCentre?.(i) ?? null,
    id
  )
  if (!at) throw new Error(`sentence ${id} has no place on a page`)
  const page = win.locator(`[data-page="${at.page}"]`)
  const box = await page.boundingBox()
  if (!box) throw new Error(`page ${at.page} is not on screen`)
  await page.click({ position: { x: box.width * at.fx, y: box.height * at.fy } })
  await expect.poll(() => highlightIds(win), { timeout: 5_000 }).toEqual([String(id)])
}

/**
 * Adds a fixture PDF through the stubbed file dialog (the new reading opens), under a new course named
 * `course`, or with no course ("Skip"). The dialog is stubbed from the main process; no production hook.
 */
export async function addFixtureReading(
  app: ElectronApplication,
  win: Page,
  file: string,
  course?: string
): Promise<void> {
  const dest = join(await mkdtemp(join(tmpdir(), 'tide-pdf-')), file)
  copyFileSync(resolve(__dirname, '..', 'fixtures', 'pdfs', file), dest)
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never
  }, dest)
  await clickAddReading(win)
  const picker = win.getByRole('dialog', { name: 'Which course is this for?' })
  if (course === undefined) {
    await picker.getByRole('button', { name: 'Skip' }).click()
  } else {
    await picker.getByRole('button', { name: '＋ New course' }).click()
    await picker.getByPlaceholder('Course name, e.g. PSYC 201').fill(course)
    await picker.getByRole('button', { name: 'Add to shelf' }).click()
  }
  await closeShelf(win)
}
