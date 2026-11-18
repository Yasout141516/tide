import { useEffect, useRef } from 'react'
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
  /** Called when a render finished (or failed); not when it was aborted. */
  onSettled(n: number): void
}

export function PdfPage({
  doc,
  n,
  width,
  height,
  scale,
  active,
  textless,
  onSettled
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
      .catch(() => {
        if (!ctl.signal.aborted) settled.current(n)
      })
    return () => ctl.abort()
  }, [doc, n, scale, active])

  return (
    <div
      data-page={n}
      role="img"
      aria-label={`Page ${n}`}
      className="relative shrink-0 overflow-hidden rounded-[3px] bg-page shadow-[0_8px_24px_var(--shadow)]"
      style={{ width, height }}
    >
      <canvas ref={canvas} className="block" />
      {textless ? (
        <p className="absolute inset-x-0 top-0 m-0 bg-warn-soft px-3 py-1 text-center text-[12px] font-bold text-warn">
          No readable text on this page, skipping.
        </p>
      ) : null}
    </div>
  )
}
