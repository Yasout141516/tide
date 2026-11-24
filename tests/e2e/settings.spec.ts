import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addFixtureReading, boxesInsideCanvas, openShelf, shelfReady } from './helpers'
import { launchTide } from './launch'

/** Opens Settings from the shelf's button (the native menu accelerator is not reachable from page keys). */
async function openSettings(win: Page): Promise<void> {
  await openShelf(win)
  await win.getByRole('button', { name: /Settings/ }).click()
}

test('dark pages invert only the canvas in a dark theme and can be turned off', async () => {
  const app = await launchTide()
  try {
    const win = await app.firstWindow()
    await shelfReady(win)
    await addFixtureReading(app, win, 'single-column.pdf')
    const canvas = win.locator('[data-page="1"] canvas[data-pdf-canvas]')
    await canvas.waitFor()
    await expect(win.locator('[data-testid="sentence-highlight"]').first()).toBeVisible({
      timeout: 30_000
    })

    await openSettings(win)
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor()
    await dialog.getByRole('radio', { name: 'Deep Sea' }).click()
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    const filters = (): Promise<{ canvas: string; hl: string }> =>
      win.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector('canvas[data-pdf-canvas]')!).filter,
        hl: getComputedStyle(document.querySelector('[data-testid="sentence-highlight"]')!).filter
      }))
    await expect.poll(async () => (await filters()).canvas).toContain('invert')
    expect((await filters()).hl).toBe('none')
    expect(await boxesInsideCanvas(win)).toBe(true)

    await openSettings(win)
    await dialog.waitFor()
    await dialog.getByRole('switch', { name: 'Dark pages in dark themes' }).click()
    await win.keyboard.press('Escape')
    await expect.poll(async () => (await filters()).canvas).toBe('none')
  } finally {
    await app.close()
  }
})
