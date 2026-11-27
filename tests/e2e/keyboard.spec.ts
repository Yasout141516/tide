import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addFixtureReading, setTheme, shelfReady } from './helpers'
import { launchTide } from './launch'

test.setTimeout(120_000)

type Stop = {
  name: string
  keyboardFocus: boolean
  outline: string
  shadow: string
  /** The same element's box-shadow when it does not have focus (a resting drop shadow is not a focus ring). */
  restShadow: string
}

/** Presses Tab until `until` matches the focused control's name (or `max` presses), recording each stop. */
async function tabThrough(
  win: Page,
  until: RegExp,
  max = 40,
  startWithCurrent = false
): Promise<Stop[]> {
  const stops: Stop[] = []
  for (let i = 0; i < max; i++) {
    if (i > 0 || !startWithCurrent) await win.keyboard.press('Tab')
    const stop = await win.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      const out = {
        name,
        keyboardFocus: el.matches(':focus-visible'),
        outline: cs.outlineStyle,
        shadow: cs.boxShadow,
        restShadow: ''
      }
      el.blur()
      out.restShadow = getComputedStyle(el).boxShadow
      el.focus()
      return out
    })
    stops.push(stop)
    if (until.test(stop.name)) break
  }
  return stops
}

function expectReached(stops: Stop[], patterns: RegExp[]): void {
  for (const p of patterns) {
    const stop = stops.find((s) => p.test(s.name))
    expect.soft(stop, `Tab reaches ${p}`).toBeTruthy()
    if (!stop) continue
    // keyboard focus must be visible: an outline or a box-shadow ring that is not there at rest.
    expect.soft(stop.keyboardFocus, `${p} matches :focus-visible`).toBe(true)
    expect
      .soft(
        stop.outline !== 'none' || (stop.shadow !== 'none' && stop.shadow !== stop.restShadow),
        `${p} shows a focus indicator (outline ${stop.outline}, shadow ${stop.shadow})`
      )
      .toBe(true)
  }
}

for (const [label, theme] of [
  ['Sky & Sea', 'sky-sea'],
  ['Deep Sea', 'deep-sea']
] as const) {
  test(`every control is reachable by Tab with a visible focus indicator in ${label}`, async () => {
    const app = await launchTide()
    try {
      const win = await app.firstWindow()
      await shelfReady(win)
      await addFixtureReading(app, win, 'single-column.pdf')
      await expect(win.locator('[data-testid="sentence-highlight"]').first()).toBeVisible({
        timeout: 30_000
      })

      // Pick the theme through Settings, then close it.
      await setTheme(win, label, theme)

      // The player's controls, from the top of the page.
      await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await win.locator('body').click({ position: { x: 1, y: 1 } })
      const player = await tabThrough(win, /Sleep|Nap/i, 60)
      expectReached(player, [/^Play$/, /^Back 15s$/, /^Forward 15s$/, /·/, /Sleep|Nap/i])

      // The shelf (behind the Shelf button in the narrow window), opened from the keyboard.
      const shelfButton = win.getByRole('button', { name: 'Shelf', exact: true })
      await shelfButton.focus()
      await win.keyboard.press('Enter')
      await win.getByRole('navigation', { name: 'Readings' }).waitFor()
      const shelf = await tabThrough(win, /Settings/, 30, true)
      expectReached(shelf, [/Add reading/, /PSYC 201/, /Settings/])
    } finally {
      await app.close()
    }
  })
}
