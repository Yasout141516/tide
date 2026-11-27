import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  addFixtureReading,
  boxesInsideCanvas,
  highlightIds,
  openShelf,
  setTheme,
  shelfReady
} from './helpers'
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

    await setTheme(win, 'Deep Sea', 'deep-sea')
    // The native window background follows the theme too (no white flash on resize).
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())
      )
      .toMatch(/^#0B1D2C$/i)

    const filters = (): Promise<{ canvas: string; hl: string }> =>
      win.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector('canvas[data-pdf-canvas]')!).filter,
        hl: getComputedStyle(document.querySelector('[data-testid="sentence-highlight"]')!).filter
      }))
    await expect.poll(async () => (await filters()).canvas).toContain('invert')
    expect((await filters()).hl).toBe('none')
    expect(await boxesInsideCanvas(win)).toBe(true)

    await openSettings(win)
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor()
    await dialog.getByRole('switch', { name: 'Dark pages in dark themes' }).click()
    await win.keyboard.press('Escape')
    await expect.poll(async () => (await filters()).canvas).toBe('none')
  } finally {
    await app.close()
  }
})

test('the theme persists across a relaunch', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
  let app = await launchTide({ TIDE_USER_DATA: userData })
  try {
    let win = await app.firstWindow()
    await setTheme(win, 'Kitty', 'kitty')
    await app.close() // before-quit flushes the library
    app = await launchTide({ TIDE_USER_DATA: userData })
    win = await app.firstWindow()
    await shelfReady(win)
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'kitty')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('the Settings menu item (Ctrl+,) opens Settings', async () => {
  const app = await launchTide()
  try {
    const win = await app.firstWindow()
    await shelfReady(win)
    // Playwright keys do not reach native menu accelerators, so click the real menu item from main.
    const accelerator = await app.evaluate(({ Menu }) => {
      type Item = {
        label: string
        accelerator?: string | null
        submenu?: { items: Item[] } | null
        click: () => void
      }
      const find = (items: Item[]): Item | undefined => {
        for (const i of items) {
          if (i.label === 'Settings…') return i
          const hit = i.submenu ? find(i.submenu.items) : undefined
          if (hit) return hit
        }
        return undefined
      }
      const item = find(Menu.getApplicationMenu()!.items as unknown as Item[])
      if (!item) return null
      item.click()
      return item.accelerator ?? null
    })
    expect(accelerator).toBe('CmdOrCtrl+,')
    await expect(win.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  } finally {
    await app.close()
  }
})

const idNumber = async (win: Page): Promise<number> => Number((await highlightIds(win))[0])

const phase = (win: Page): Promise<string | null> =>
  win.locator('audio[data-phase]').getAttribute('data-phase')

test('a pronunciation fix changes the synthesized text', async () => {
  test.setTimeout(150_000)
  const app = await launchTide()
  try {
    const win = await app.firstWindow()
    await shelfReady(win)
    await addFixtureReading(app, win, 'single-column.pdf')
    await expect(win.locator('[data-sentence-count]')).toBeVisible({ timeout: 30_000 })

    await openSettings(win)
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Pronunciation' }).click()
    await dialog.getByRole('button', { name: /Add a word/ }).click()
    await dialog.getByLabel('Word').last().fill('attention')
    const sounds = dialog.getByLabel('Sounds like').last()
    await sounds.fill('uh-TEN-shun')
    await sounds.press('Enter')
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => window.tideTest!.recentSynthTexts())).some((t) =>
            t.includes('uh-TEN-shun')
          ),
        { timeout: 90_000, intervals: [50] }
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})

test('turning off Skip footnotes rebuilds and keeps playing', async () => {
  test.setTimeout(150_000)
  const app = await launchTide()
  try {
    const win = await app.firstWindow()
    await shelfReady(win)
    await addFixtureReading(app, win, 'single-column.pdf')
    await expect(win.locator('[data-sentence-count]')).toBeVisible({ timeout: 30_000 })
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => phase(win), { timeout: 90_000, intervals: [50] }).toBe('playing')

    await openSettings(win)
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Reading' }).click()
    const sw = dialog.getByRole('switch', { name: 'Skip footnotes' })
    const countBefore = await win
      .locator('[data-sentence-count]')
      .getAttribute('data-sentence-count')
    // Start from a sentence after the first, so a reset to the start would show.
    await expect.poll(() => idNumber(win), { timeout: 40_000 }).toBeGreaterThanOrEqual(1)
    const currentText = (): Promise<string | null> =>
      win.locator('[data-sentence-count]').getAttribute('data-current-sentence')
    const textBefore = await currentText()
    expect(textBefore).toBeTruthy()
    const before = await sw.getAttribute('aria-checked')
    await sw.click()
    await expect(sw).not.toHaveAttribute('aria-checked', before ?? '')
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // The rebuild (the footnote becomes a sentence) shows as a new sentence count; her place is kept.
    await expect
      .poll(() => win.locator('[data-sentence-count]').getAttribute('data-sentence-count'), {
        timeout: 30_000
      })
      .not.toBe(countBefore)
    await expect.poll(() => phase(win), { timeout: 30_000 }).toBe('playing')
    expect(await currentText()).toBe(textBefore)
    const after = await idNumber(win)
    await expect.poll(() => idNumber(win), { timeout: 40_000 }).toBeGreaterThan(after)
  } finally {
    await app.close()
  }
})
