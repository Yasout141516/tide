import { copyFileSync } from 'fs'
import { mkdtemp, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect, type Page } from '@playwright/test'
import { launchTide } from './launch'

const fixture = (name: string): string => resolve(__dirname, '..', 'fixtures', 'pdfs', name)

type App = Awaited<ReturnType<typeof launchTide>>

/** Adds a fixture to the shelf through the stubbed file dialog; the new reading opens. */
async function addAndOpen(app: App, win: Page, name: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tide-pdf-'))
  const dest = join(dir, name)
  copyFileSync(fixture(name), dest)
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never
  }, dest)
  await win.getByRole('button', { name: 'Add reading' }).first().click()
  await win
    .getByRole('dialog', { name: 'Which course is this for?' })
    .getByRole('button', { name: 'Skip' })
    .click()
}

/** True when page `n` has a canvas with at least one non-white pixel. */
const drawn = (win: Page, n: number): Promise<boolean> =>
  win.evaluate((n) => {
    const c = document.querySelector<HTMLCanvasElement>(`[data-page="${n}"] canvas`)
    if (!c || c.width === 0) return false
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 0; i < px.length; i += 4)
      if (px[i + 3] > 0 && (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240)) return true
    return false
  }, n)

const pageWidth = (win: Page): Promise<number> =>
  win.evaluate(
    () => document.querySelector<HTMLElement>('[data-page="1"]')!.getBoundingClientRect().width
  )

test('two-column.pdf and layout.pdf render real pages and the text size changes', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const messages: string[] = []
  win.on('console', (m) => messages.push(m.text()))
  win.on('pageerror', (e) => messages.push(String(e)))
  const failed: string[] = []
  win.on('requestfailed', (r) => failed.push(r.url()))

  await addAndOpen(app, win, 'two-column.pdf')
  await expect(win.locator('[data-page="1"]')).toBeVisible()
  await expect.poll(() => drawn(win, 1)).toBe(true)
  await expect(win.getByRole('contentinfo', { name: 'Player' })).toContainText(/Page 1 of \d+/)

  // Text size: View > Larger text / Smaller text (the Ctrl+= / Ctrl+- menu items).
  const before = await pageWidth(win)
  const zoom = (index: number): Promise<void> =>
    app.evaluate(({ Menu }, i) => {
      const view = Menu.getApplicationMenu()!.items.find((m) => m.label === 'View')!
      view.submenu!.items[i].click()
    }, index)
  await zoom(0)
  await expect.poll(() => pageWidth(win)).toBeGreaterThan(before * 1.05)
  await zoom(2)
  await zoom(2)
  await expect.poll(() => pageWidth(win)).toBeLessThan(before * 0.95)

  await addAndOpen(app, win, 'layout.pdf')
  await expect(win.getByRole('heading', { level: 2 })).not.toHaveText(/^$/)
  await expect.poll(() => drawn(win, 1)).toBe(true)

  expect(failed.filter((u) => u.includes('/pdfjs/'))).toEqual([])
  expect(messages.filter((m) => /Content Security Policy|Refused to/.test(m))).toEqual([])
  await app.close()
})

test('a locked PDF asks for its password and opens with the right one', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  await addAndOpen(app, win, 'locked.pdf')
  const dialog = win.getByRole('dialog', { name: 'This PDF is locked with a password.' })
  await dialog.getByLabel('Password').fill('wrong')
  await dialog.getByRole('button', { name: 'Open' }).click()
  await expect(dialog.getByText("That password didn't work. Try again.")).toBeVisible()
  await dialog.getByLabel('Password').fill('tide')
  await dialog.getByRole('button', { name: 'Open' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => drawn(win, 1)).toBe(true)
  await app.close()
})

test('the bundled pdf.js cMaps, standard fonts, ICC profiles and wasm load same-origin under the CSP', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const messages: string[] = []
  win.on('console', (m) => messages.push(m.text()))
  await win.getByRole('button', { name: 'Add reading' }).first().waitFor()
  // The directories the build copies (electron.vite.config.ts); one real file from each is fetched
  // exactly as pdf.js does, relative to index.html.
  const assets = await win.evaluate(async () => {
    const urls = [
      'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
      'pdfjs/cmaps/UniJIS-UTF16-H.bcmap',
      'pdfjs/standard_fonts/FoxitSerif.pfb',
      'pdfjs/standard_fonts/LiberationSans-Regular.ttf',
      'pdfjs/iccs/CGATS001Compat-v2-micro.icc',
      'pdfjs/wasm/qcms_bg.wasm',
      'pdfjs/wasm/openjpeg.wasm',
      'pdfjs/wasm/jbig2.wasm'
    ]
    return Promise.all(
      urls.map(async (u) => {
        try {
          const r = await fetch(new URL(u, document.baseURI))
          return { u, ok: r.ok, bytes: (await r.arrayBuffer()).byteLength }
        } catch (e) {
          return { u, ok: false, bytes: 0, error: String(e) }
        }
      })
    )
  })
  for (const a of assets) expect(a, a.u).toMatchObject({ ok: true })
  for (const a of assets) expect(a.bytes, a.u).toBeGreaterThan(100)
  expect(messages.filter((m) => /Content Security Policy|Refused to/.test(m))).toEqual([])
  await app.close()
  // Cross-check the names above against what the build actually copied.
  const built = await readdir(resolve(__dirname, '..', '..', 'out', 'renderer', 'pdfjs'))
  expect(built.sort()).toEqual(['cmaps', 'iccs', 'standard_fonts', 'wasm'])
})

test('the text pipeline runs in its worker: a PDF with no text shows the scanned-copy message', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const messages: string[] = []
  win.on('console', (m) => messages.push(m.text()))
  win.on('pageerror', (e) => messages.push(String(e)))
  await addAndOpen(app, win, 'no-text.pdf')
  // Only a finished worker build (textlessPages) produces this message.
  await expect(
    win.getByText("Tide couldn't find any text in this PDF. It may be a scanned copy.")
  ).toBeVisible()
  expect(messages.filter((m) => /Content Security Policy|Refused to|Worker/.test(m))).toEqual([])
  await app.close()
})

test('at 200% the left edge of the page can be scrolled into view', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  await addAndOpen(app, win, 'two-column.pdf')
  await expect(win.locator('[data-page="1"]')).toBeVisible()
  for (let i = 0; i < 10; i++)
    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((m) => m.label === 'View')!
      view.submenu!.items[0].click()
    })
  // At 200% the page is twice the column, wider than the stage.
  await expect
    .poll(() =>
      win.evaluate(() => {
        const page = document.querySelector<HTMLElement>('[data-page="1"]')!
        return page.clientWidth / page.closest<HTMLElement>('.overflow-y-auto')!.clientWidth
      })
    )
    .toBeGreaterThan(1.2)
  const edge = await win.evaluate(() => {
    const page = document.querySelector<HTMLElement>('[data-page="1"]')!
    const scroller = page.closest<HTMLElement>('.overflow-y-auto')!
    scroller.scrollLeft = 0
    return {
      overflows: scroller.scrollWidth > scroller.clientWidth,
      left: page.getBoundingClientRect().left - scroller.getBoundingClientRect().left
    }
  })
  expect(edge.overflows).toBe(true)
  // At scrollLeft 0 the page starts inside the scroller (its left gutter), not off to the left.
  expect(edge.left).toBeGreaterThanOrEqual(0)
  await app.close()
})

test('text-bearing PDFs are built into sentences by the pipeline worker', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const workers: string[] = []
  win.on('worker', (w) => workers.push(w.url()))
  await addAndOpen(app, win, 'two-column.pdf')
  // Only a finished build carries a sentence count; a PDF with text must give some.
  const view = win.locator('[data-sentence-count]')
  await expect(view).toBeVisible()
  expect(Number(await view.getAttribute('data-sentence-count'))).toBeGreaterThan(10)
  // And it was the pipeline worker (a module worker next to the pdf.js one) that ran it.
  expect(workers.some((u) => u.includes('pipeline.worker'))).toBe(true)
  await app.close()
})
