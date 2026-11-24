/**
 * Sprout: Tide's original Pixel Quest mascot, a little teal block critter with a two-leaf sprout.
 * Drawn on a 10x10 pixel grid; every colour is the theme's own (outline and leaves are fixed art
 * colours so the critter looks the same on any map).
 */
export function Sprout({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      data-mascot="sprout"
      width={size}
      height={size}
      viewBox="0 0 10 10"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* sprout */}
      <rect x="5" y="0" width="1" height="1" fill="#5BAA4E" />
      <rect x="6" y="0" width="1" height="1" fill="#7FD06E" />
      <rect x="5" y="1" width="1" height="1" fill="#5BAA4E" />
      {/* body outline */}
      <rect x="3" y="2" width="4" height="1" fill="#071624" />
      <rect x="2" y="3" width="1" height="5" fill="#071624" />
      <rect x="7" y="3" width="1" height="5" fill="#071624" />
      <rect x="3" y="8" width="4" height="1" fill="#071624" />
      {/* body */}
      <rect x="3" y="3" width="4" height="5" fill="#8FD3C8" />
      {/* face */}
      <rect x="3" y="5" width="1" height="1" fill="#071624" />
      <rect x="6" y="5" width="1" height="1" fill="#071624" />
      <rect x="4" y="6" width="2" height="1" fill="#F2A0A8" />
    </svg>
  )
}
