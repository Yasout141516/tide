import type { Point } from '../../../shared/text/selection'

const ITEM = '[data-item-index]'

/** The element of the text layer a node belongs to, or the first/last one inside an element's child slot. */
function itemOf(node: Node, offset: number): { el: HTMLElement; at: number } | null {
  const own = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(ITEM)
  if (own) {
    const r = document.createRange()
    r.selectNodeContents(own)
    r.setEnd(node, offset)
    return { el: own, at: r.toString().length }
  }
  // A boundary between items (the selection ends on the layer itself): snap to the neighbouring item.
  if (!(node instanceof Element)) return null
  const next = node.childNodes[offset]
  const nextEl =
    next instanceof HTMLElement
      ? next.matches(ITEM)
        ? next
        : next.querySelector<HTMLElement>(ITEM)
      : null
  if (nextEl) return { el: nextEl, at: 0 }
  const prev = node.childNodes[offset - 1]
  const items = prev instanceof HTMLElement ? [...prev.querySelectorAll<HTMLElement>(ITEM)] : []
  if (prev instanceof HTMLElement && prev.matches(ITEM)) items.push(prev)
  const el = items.at(-1)
  return el ? { el, at: el.textContent?.length ?? 0 } : null
}

/** The page-text position of a DOM boundary inside a rendered text layer; null elsewhere. */
export function pointFromDom(node: Node, offset: number): Point | null {
  const hit = itemOf(node, offset)
  if (!hit) return null
  const page = hit.el.closest<HTMLElement>('[data-page]')
  if (!page) return null
  return {
    page: Number(page.dataset.page),
    itemIndex: Number(hit.el.dataset.itemIndex),
    offset: hit.at
  }
}

/** The current non-empty selection when it lies in `root`'s text layers: both ends, and its on-screen box. */
export function currentSelection(root: HTMLElement): { a: Point; b: Point; rect: DOMRect } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.anchorNode || !sel.focusNode)
    return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const a = pointFromDom(sel.anchorNode, sel.anchorOffset)
  const b = pointFromDom(sel.focusNode, sel.focusOffset)
  return a && b ? { a, b, rect: range.getBoundingClientRect() } : null
}
