/** A strip of pixel waves along the bottom of the map, above the player. Decoration only. */
export function PixelWaves(): React.JSX.Element {
  const crests = Array.from({ length: 16 }, (_, i) => i * 10)
  return (
    <svg
      data-pixel-waves
      className="pointer-events-none absolute right-0 bottom-full left-0 h-3.5 w-full"
      viewBox="0 0 160 7"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="0" y="4" width="160" height="3" fill="#2A7BA0" />
      <g fill="#4FC3D1">
        {crests.map((x, i) => (
          <rect key={x} x={x} y={i % 2 === 0 ? 3 : 2} width={i % 2 === 0 ? 6 : 4} height="1" />
        ))}
      </g>
    </svg>
  )
}
