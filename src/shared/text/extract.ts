import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageText, TextItem } from './types'

/**
 * Reads every page's text items with pdf.js.
 *
 * - Empty-string items (pdf.js end-of-line markers) are skipped, but `index` stays the item's index in
 *   `getTextContent().items`, so a highlight can address the same item later.
 * - Item text is kept exactly as written in the PDF (`disableNormalization`), so ligatures survive;
 *   `normalizeText` is applied downstream.
 * - A password-protected PDF rejects with `Error('PDF is password-protected')`.
 */
export async function extractPages(data: Uint8Array): Promise<PageText[]> {
  const task = getDocument({
    // pdf.js transfers (detaches) the buffer it is given, so it gets a copy. A copy also turns a Node
    // Buffer into the plain Uint8Array pdf.js expects.
    data: new Uint8Array(data),
    // Text extraction needs no font faces or worker-side fetching. Under Node pdf.js runs its worker
    // in-process ("fake worker") from the legacy build's pdf.worker.mjs; no workerSrc setup is needed.
    disableFontFace: true,
    useWorkerFetch: false,
    // Non-embedded standard fonts (e.g. Helvetica) only need pdf.js's built-in metrics for text
    // positions; without `standardFontDataUrl` pdf.js would warn about the missing glyph outlines on
    // every such font. Only errors are logged.
    verbosity: VerbosityLevel.ERRORS
  })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    await task.destroy()
    if ((err as { name?: string } | null)?.name === 'PasswordException')
      throw new Error('PDF is password-protected', { cause: err })
    throw err
  }
  try {
    const pages: PageText[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const [x0, y0, x1, y1] = page.view
      const height = y1 - y0
      const content = await page.getTextContent({ disableNormalization: true })
      const items: TextItem[] = []
      content.items.forEach((item, index) => {
        if (!('str' in item) || item.str === '') return
        const [, , c, d, e, f] = item.transform as number[]
        items.push({
          page: n,
          index,
          str: item.str,
          x: e - x0,
          y: y1 - f,
          width: item.width,
          fontSize: Math.hypot(c, d) || item.height
        })
      })
      pages.push({ page: n, width: x1 - x0, height, items })
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}
