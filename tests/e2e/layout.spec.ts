import { test, expect } from '@playwright/test'
import { launchTide } from './launch'

// The only test that does not pin the window: it checks the layout Tide opens with on a roomy screen.
test('on a wide screen the shelf and "Add reading" are visible by default, with no Shelf button', async () => {
  const app = await launchTide({}, { pinWindow: false })
  try {
    const { width } = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize)
    test.skip(
      width < 1200,
      `primary display work area is ${width} px wide; the default 1200 px window cannot open`
    )
    const win = await app.firstWindow()
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1100)
    await expect(win.getByRole('navigation', { name: 'Readings' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Add reading' }).first()).toBeVisible()
    await expect(win.getByRole('button', { name: 'Shelf', exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
