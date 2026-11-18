import type { Sentence } from './types'

/** Resume anchor: the first span of the current sentence (spec §6.4). */
export interface Anchor {
  page: number
  textItemIndex: number
  charOffset: number
}

/** The anchor of a sentence: its first span. */
export function anchorOf(s: Sentence): Anchor {
  const { page, itemIndex, start } = s.spans[0]
  return { page, textItemIndex: itemIndex, charOffset: start }
}

/**
 * Index of the sentence to resume at after the sentence list changed (settings flipped):
 * the sentence covering the anchor, else the first one after it, else the last; -1 only when empty.
 */
export function resolveAnchor(sentences: Sentence[], a: Anchor): number {
  if (sentences.length === 0) return -1
  const covering = sentences.findIndex((s) =>
    s.spans.some(
      (sp) =>
        sp.page === a.page &&
        sp.itemIndex === a.textItemIndex &&
        sp.start <= a.charOffset &&
        a.charOffset < sp.end
    )
  )
  if (covering >= 0) return covering
  const after = sentences.findIndex((s) => {
    const f = s.spans[0]
    return !!f && (f.page - a.page || f.itemIndex - a.textItemIndex || f.start - a.charOffset) > 0
  })
  return after >= 0 ? after : sentences.length - 1
}
