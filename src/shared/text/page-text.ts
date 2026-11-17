import type { PageText, TextItem } from './types'

/** The part of a pdf.js `TextItem` the pipeline reads (marked-content items have no `str`). */
export interface RawTextItem {
  str?: string
  transform: number[]
  width: number
  height: number
}

/**
 * Maps one page's pdf.js text items to a `PageText`, shared by the Node extractor and the renderer.
 *
 * - Empty-string items (pdf.js end-of-line markers) are skipped, but `index` stays the item's index in
 *   `getTextContent().items`, so a highlight can address the same item later.
 * - `view` is `page.view` ([x0, y0, x1, y1]); coordinates become PDF points with a top-left origin.
 */
export function pageTextFromContent(page: number, view: number[], items: RawTextItem[]): PageText {
  const [x0, y0, x1, y1] = view
  const out: TextItem[] = []
  items.forEach((item, index) => {
    if (item.str === undefined || item.str === '') return
    const [, , c, d, e, f] = item.transform
    out.push({
      page,
      index,
      str: item.str,
      x: e - x0,
      y: y1 - f,
      width: item.width,
      fontSize: Math.hypot(c, d) || item.height
    })
  })
  return { page, width: x1 - x0, height: y1 - y0, items: out }
}
