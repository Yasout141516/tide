import type { Rect } from '../../../shared/text/highlight'

type Props = {
  /** The sentence's rectangles on this page, in PDF points (top-left origin). */
  rects: Rect[]
  /** CSS px per PDF point. */
  scale: number
  sentenceId: number
}

/** The wash over the current sentence: multiply keeps the PDF's ink readable through it. */
export function HighlightLayer({ rects, scale, sentenceId }: Props): React.JSX.Element {
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          data-testid="sentence-highlight"
          data-sentence-id={sentenceId}
          className="pointer-events-none absolute"
          style={{
            left: r.x * scale,
            top: r.y * scale,
            width: r.w * scale,
            height: r.h * scale,
            background: 'var(--hl)',
            mixBlendMode: 'multiply',
            boxShadow: 'inset 0 -2px 0 var(--hl-line)',
            borderRadius: 3
          }}
        />
      ))}
    </>
  )
}
