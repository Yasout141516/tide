import { EDGE_ZONE } from './lines'
import type { Line } from './types'

/** "Page 3", "12", "xiv", "Page 4 of 10": a page number on its own. */
const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d{1,4})?$/i

type Zone = 'top' | 'bottom'

/** The digit-insensitive key that identifies a running header or footer across pages. */
const headerKey = (text: string): string =>
  text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

function zoneOf(line: Line, pageHeight: number): Zone | null {
  if (line.y < pageHeight * EDGE_ZONE) return 'top'
  if (line.y > pageHeight * (1 - EDGE_ZONE)) return 'bottom'
  return null
}

/**
 * Drops running headers, footers and page numbers.
 *
 * Only lines in the top or bottom 8% of their page (by baseline) are candidates. A candidate goes if
 * its digit-normalized key appears in the same zone on at least min(3, ceil(pageCount / 2)) pages, or
 * if it is a page number on its own (see `PAGE_NUMBER`). Kept lines are returned as-is, in order.
 *
 * @param pagesLines the lines of every page, in page order
 * @param pageHeights the height of each page, same order
 */
export function dropHeadersFooters(pagesLines: Line[][], pageHeights: number[]): Line[][] {
  const threshold = Math.min(3, Math.ceil(0.5 * pagesLines.length))
  const zones = pagesLines.map((lines, p) => lines.map((l) => zoneOf(l, pageHeights[p])))

  // Number of pages on which each key appears, per zone.
  const pagesWith = new Map<string, number>()
  pagesLines.forEach((lines, p) => {
    const seen = new Set<string>()
    lines.forEach((l, i) => {
      const zone = zones[p][i]
      if (zone) seen.add(`${zone}\u0000${headerKey(l.text)}`)
    })
    for (const k of seen) pagesWith.set(k, (pagesWith.get(k) ?? 0) + 1)
  })

  return pagesLines.map((lines, p) =>
    lines.filter((l, i) => {
      const zone = zones[p][i]
      if (!zone) return true
      if (PAGE_NUMBER.test(l.text.trim())) return false
      return (pagesWith.get(`${zone}\u0000${headerKey(l.text)}`) ?? 0) < threshold
    })
  )
}
