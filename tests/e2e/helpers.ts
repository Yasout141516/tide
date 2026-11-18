import { expect, type Locator, type Page } from '@playwright/test'

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
