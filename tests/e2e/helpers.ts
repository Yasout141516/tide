import type { Page } from '@playwright/test'

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
