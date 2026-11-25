const crests = Array.from({ length: 16 }, (_, i) => i * 10)

/** A strip of pixel waves at the top edge of the player bar, in layout flow (never over the page). Decoration only. */
export function PixelWaves(): React.JSX.Element {
  return (
    <svg
      className="pointer-events-none -mx-[22px] -mt-3 -mb-1 block h-3.5 shrink-0 basis-[calc(100%+44px)]"
      viewBox="0 0 160 7"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="0" y="4" width="160" height="3" style={{ fill: 'var(--wave-sea)' }} />
      <g style={{ fill: 'var(--wave-on)' }}>
        {crests.map((x, i) => (
          <rect key={x} x={x} y={i % 2 === 0 ? 3 : 2} width={i % 2 === 0 ? 6 : 4} height="1" />
        ))}
      </g>
    </svg>
  )
}
