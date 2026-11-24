/**
 * Sprout: Tide's original Pixel Quest mascot, a little teal block critter with a two-leaf sprout.
 * Drawn on a 10x10 pixel grid. It is illustration, so it keeps fixed art colours (the ART constant)
 * and looks the same on any map, like the theme tile swatches.
 */
/** Fixed illustration colours (not theme tokens). */
const ART = {
  leaf: '#5BAA4E',
  leafLight: '#7FD06E',
  outline: '#071624',
  body: '#8FD3C8',
  mouth: '#F2A0A8'
}

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
      <rect x="5" y="0" width="1" height="1" fill={ART.leaf} />
      <rect x="6" y="0" width="1" height="1" fill={ART.leafLight} />
      <rect x="5" y="1" width="1" height="1" fill={ART.leaf} />
      {/* body outline */}
      <rect x="3" y="2" width="4" height="1" fill={ART.outline} />
      <rect x="2" y="3" width="1" height="5" fill={ART.outline} />
      <rect x="7" y="3" width="1" height="5" fill={ART.outline} />
      <rect x="3" y="8" width="4" height="1" fill={ART.outline} />
      {/* body */}
      <rect x="3" y="3" width="4" height="5" fill={ART.body} />
      {/* face */}
      <rect x="3" y="5" width="1" height="1" fill={ART.outline} />
      <rect x="6" y="5" width="1" height="1" fill={ART.outline} />
      <rect x="4" y="6" width="2" height="1" fill={ART.mouth} />
    </svg>
  )
}
