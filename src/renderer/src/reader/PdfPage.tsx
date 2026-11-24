import { memo, useEffect, useRef } from 'react'
import type { Rect } from '../../../shared/text/highlight'
import { HighlightLayer } from './HighlightLayer'
import type { PdfDoc } from './pdf'

type Props = {
  doc: PdfDoc
  n: number
  /** CSS px of the page box. */
  width: number
  height: number
  /** CSS px per PDF point. */
  scale: number
  /** Inside the render window: holds a canvas. Outside it the canvas is released. */
  active: boolean
  textless: boolean
  /** Called when a render finished, failed or was aborted (she scrolled away): text extraction must not wait on pixels. */
  onSettled(n: number): void
  /** The current sentence's rectangles on this page (PDF points). */
  highlight?: { rects: Rect[]; sentenceId: number }
  /** A click on the page, in PDF points from the page's top-left corner. */
  onPick?(n: number, x: number, y: number): void
}

function PdfPageView({
  doc,
  n,
  width,
  height,
  scale,
  active,
  textless,
  onSettled,
  highlight,
  onPick
}: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const settled = useRef(onSettled)
  useEffect(() => {
    settled.current = onSettled
  })

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (!active) {
      // Release the backing store.
      el.width = 0
      el.height = 0
      return
    }
    const ctl = new AbortController()
    doc
      .render(n, el, scale, ctl.signal)
      .then(() => settled.current(n))
      .catch(() => settled.current(n))
    return () => ctl.abort()
  }, [doc, n, scale, active])

  const textLayer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = textLayer.current
    if (!el) return
    // Clear first: a previous (scale change) or aborted render leaves its divs behind.
    el.replaceChildren()
    if (!active) return
    const ctl = new AbortController()
    doc.renderTextLayer(n, el, scale, ctl.signal).catch(() => {})
    return () => ctl.abort()
  }, [doc, n, scale, active])

  return (
    <div
      data-page={n}
      role="img"
      aria-label={`Page ${n}`}
      className="relative shrink-0 overflow-hidden rounded-[3px] bg-page shadow-[0_8px_24px_var(--shadow)]"
      style={{ width, height }}
      onClick={(e) => {
        // A drag-selection ends in a click too: only a plain click picks a sentence.
        if (window.getSelection()?.isCollapsed === false) return
        const box = e.currentTarget.getBoundingClientRect()
        onPick?.(n, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
      }}
    >
      <canvas ref={canvas} className="block" />
      {highlight && highlight.rects.length > 0 ? (
        <HighlightLayer rects={highlight.rects} scale={scale} sentenceId={highlight.sentenceId} />
      ) : null}
      <div ref={textLayer} className="textLayer" />
      {textless ? (
        <p className="absolute inset-x-0 top-0 m-0 bg-warn-soft px-3 py-1 text-center text-[12px] font-bold text-warn">
          No readable text on this page, skipping.
        </p>
      ) : null}
    </div>
  )
}

/** Re-renders only when its own props change: stepping the highlight touches two pages. */
export const PdfPage = memo(PdfPageView)
