/**
 * Mochi: Tide's original Kitty mascot, a ginger tabby kitten (round head, tabby stripes, pink nose,
 * a small smiling mouth, whiskers). Drawn here as plain SVG: the head, a peeking pose (over the
 * player bar), a box pose (empty shelf), plus the sleepy kitten, paw print, paw-pad toes and yarn
 * ball the Kitty theme reuses. Illustration keeps fixed art colours (the ART constant), so the
 * kittens look the same on any surface. Nothing here is a licensed character.
 */
/** Fixed illustration colours (not theme tokens). */
const ART = {
  line: '#4A3236',
  gingerFur: '#F2A65A',
  gingerFace: '#FFD9C2',
  innerEar: '#F6B9C8',
  nose: '#E07C95',
  white: '#FFFFFF',
  cheek: '#F6B9C8',
  box: '#E9C9A6',
  boxFlap: '#F2D9BC',
  yarn: '#F6B9C8',
  yarnLine: '#B8456A',
  zzz: '#8E2F52',
  /** Voice avatar coats, by voice id (fur and face). */
  coats: {
    af_kore: { fur: '#F2A65A', face: '#FFD9C2' },
    af_nicole: { fur: '#9AA3AE', face: '#E3E7EC' },
    af_sarah: { fur: '#B98B6C', face: '#F1DCCB' },
    am_fenrir: { fur: '#6B5A66', face: '#D9CBD3' },
    am_michael: { fur: '#E8C36A', face: '#FFF0C9' },
    am_puck: { fur: '#8FB3D9', face: '#E1EEFA' },
    bf_emma: { fur: '#B9A3E0', face: '#EEE6FB' },
    bf_isabella: { fur: '#7FBF9E', face: '#DDF1E5' },
    bm_fable: { fur: '#E58F8F', face: '#FBDCDC' },
    bm_george: { fur: '#4F4A5C', face: '#CFCBD8' }
  } as Record<string, Coat>
}

export interface Coat {
  fur: string
  face: string
}

/** Mochi's own coat. */
// eslint-disable-next-line react-refresh/only-export-components -- art data belongs with the art
export const GINGER: Coat = { fur: ART.gingerFur, face: ART.gingerFace }

/** A distinct kitten coat per voice id (ginger for an unknown id); none is plain white and every face has a mouth. */
// eslint-disable-next-line react-refresh/only-export-components -- art data belongs with the art
export function voiceCoat(voiceId: string): Coat {
  return Object.hasOwn(ART.coats, voiceId) ? ART.coats[voiceId] : GINGER
}

/** The head, in an 80x66 box. */
function Head({ coat }: { coat: Coat }): React.JSX.Element {
  const stroke = { stroke: ART.line, strokeLinejoin: 'round' as const }
  return (
    <>
      <path d="M14 26 L18 6 L32 20 Z" fill={coat.fur} strokeWidth="2.4" {...stroke} />
      <path d="M66 26 L62 6 L48 20 Z" fill={coat.fur} strokeWidth="2.4" {...stroke} />
      <path d="M19 21 L20.5 12 L27 18.5 Z" fill={ART.innerEar} />
      <path d="M61 21 L59.5 12 L53 18.5 Z" fill={ART.innerEar} />
      <ellipse
        cx="40"
        cy="40"
        rx="30"
        ry="25"
        fill={coat.face}
        stroke={ART.line}
        strokeWidth="2.4"
      />
      <path
        d="M34 17 q2 6 0 9 M40 16 q1 7 0 10 M46 17 q-2 6 0 9"
        stroke={coat.fur}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="29" cy="40" rx="4.6" ry="5.4" fill={ART.line} />
      <ellipse cx="51" cy="40" rx="4.6" ry="5.4" fill={ART.line} />
      <circle cx="30.6" cy="38" r="1.6" fill={ART.white} />
      <circle cx="52.6" cy="38" r="1.6" fill={ART.white} />
      <ellipse cx="21" cy="48" rx="4.5" ry="2.6" fill={ART.cheek} opacity=".85" />
      <ellipse cx="59" cy="48" rx="4.5" ry="2.6" fill={ART.cheek} opacity=".85" />
      <path d="M38 46 h4 l-2 2.4 z" fill={ART.nose} />
      <path
        d="M36 50 q2 2.4 4 0 q2 2.4 4 0"
        stroke={ART.line}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8 44 h12 M9 50 l11 -2 M72 44 h-12 M71 50 l-11 -2"
        stroke={ART.line}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".6"
      />
    </>
  )
}

/** Mochi's head alone (wordmark, headings), or a differently coated kitten for a voice avatar. */
export function MochiHead({
  size = 28,
  coat = GINGER,
  avatar = false
}: {
  size?: number
  coat?: Coat
  /** Marks a voice avatar and records its coat colour. */
  avatar?: boolean
}): React.JSX.Element {
  return (
    <svg
      data-mascot="mochi"
      data-pose="head"
      data-voice-avatar={avatar ? '' : undefined}
      data-tint={avatar ? coat.fur : undefined}
      width={size}
      height={Math.round((size * 66) / 80)}
      viewBox="0 0 80 66"
      aria-hidden="true"
    >
      <Head coat={coat} />
    </svg>
  )
}

const paws = (
  <>
    <ellipse
      cx="26"
      cy="58"
      rx="11"
      ry="7"
      fill={ART.gingerFace}
      stroke={ART.line}
      strokeWidth="2.2"
    />
    <ellipse
      cx="70"
      cy="58"
      rx="11"
      ry="7"
      fill={ART.gingerFace}
      stroke={ART.line}
      strokeWidth="2.2"
    />
    <path
      d="M22 56 v4 M26 55 v5 M30 56 v4 M66 56 v4 M70 55 v5 M74 56 v4"
      stroke={ART.line}
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </>
)

/** Mochi peeking over the edge of the player bar, paws on the rim. Still (any motion is CSS). */
export function MochiPeek({ width = 96 }: { width?: number }): React.JSX.Element {
  return (
    <svg
      data-mascot="mochi"
      data-pose="peek"
      width={width}
      height={Math.round((width * 62) / 96)}
      viewBox="0 0 96 62"
      aria-hidden="true"
    >
      <g transform="translate(8,0)">
        <Head coat={GINGER} />
      </g>
      {paws}
    </svg>
  )
}

/** Mochi sitting in a cardboard box, for the empty shelf. */
export function MochiBox({ width = 150 }: { width?: number }): React.JSX.Element {
  return (
    <svg
      data-mascot="mochi"
      data-pose="box"
      width={width}
      height={Math.round((width * 120) / 150)}
      viewBox="0 0 150 120"
      aria-hidden="true"
    >
      <g transform="translate(35,8)">
        <Head coat={GINGER} />
      </g>
      <path
        d="M20 62 h110 l-8 52 h-94 z"
        fill={ART.box}
        stroke={ART.line}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M20 62 l-12 -14 h40 l10 14 M130 62 l12 -14 h-40 l-10 14"
        fill={ART.boxFlap}
        stroke={ART.line}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <ellipse
        cx="58"
        cy="64"
        rx="9"
        ry="6"
        fill={ART.gingerFace}
        stroke={ART.line}
        strokeWidth="2"
      />
      <ellipse
        cx="92"
        cy="64"
        rx="9"
        ry="6"
        fill={ART.gingerFace}
        stroke={ART.line}
        strokeWidth="2"
      />
    </svg>
  )
}

/** The curled-up sleeping kitten beside "Nap timer". */
export function SleepyKitten({ width = 30 }: { width?: number }): React.JSX.Element {
  return (
    <svg
      data-mascot="sleepy"
      width={width}
      height={Math.round((width * 44) / 66)}
      viewBox="0 0 66 44"
      aria-hidden="true"
    >
      <ellipse
        cx="30"
        cy="28"
        rx="24"
        ry="13"
        fill={ART.gingerFace}
        stroke={ART.line}
        strokeWidth="2"
      />
      <path
        d="M10 22 L13 9 L22 17 Z M50 22 L47 9 L38 17 Z"
        fill={ART.gingerFur}
        stroke={ART.line}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M20 27 q3 3 6 0 M34 27 q3 3 6 0"
        stroke={ART.line}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M52 34 q10 0 8 -10"
        stroke={ART.gingerFur}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <text x="52" y="12" fontFamily="Fredoka" fontSize="10" fill={ART.zzz} fontWeight="700">
        z
      </text>
      <text x="58" y="6" fontFamily="Fredoka" fontSize="8" fill={ART.zzz} fontWeight="700">
        z
      </text>
    </svg>
  )
}

/** A paw print in the current text colour (course labels, the saved toast). */
export function PawPrint({
  size = 13,
  attr
}: {
  size?: number
  /** A data attribute to mark it with (tests and CSS hooks). */
  attr?: 'data-course-paw' | 'data-toast-paw'
}): React.JSX.Element {
  const mark = attr ? { [attr]: '' } : {}
  return (
    <svg
      {...mark}
      width={size}
      height={Math.round((size * 22) / 24)}
      viewBox="0 0 24 22"
      fill="currentColor"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="15" rx="5.5" ry="4.6" />
      <circle cx="5.5" cy="8.5" r="2.4" />
      <circle cx="10" cy="5" r="2.4" />
      <circle cx="14.5" cy="5" r="2.4" />
      <circle cx="19" cy="8.5" r="2.4" />
    </svg>
  )
}

/** The four toe beans that sit above the play button, which is the pad (filled by the primary colour). */
export function PawToes(): React.JSX.Element {
  return (
    <svg
      data-paw-pad=""
      className="kt-toes"
      width="62"
      height="14"
      viewBox="0 0 62 14"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="5" />
      <circle cx="22" cy="5" r="5.2" />
      <circle cx="40" cy="5" r="5.2" />
      <circle cx="53" cy="9" r="5" />
    </svg>
  )
}

/** The ball of yarn that rides the progress thread. */
export function YarnBall({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg data-yarn-ball="" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={ART.yarn} stroke={ART.yarnLine} strokeWidth="1.6" />
      <path
        d="M3 7 q7 3 14 -2 M2.5 11 q8 4 15 -3 M5 16 q6 -1 11 -8 M8 2 q-1 9 6 17"
        stroke={ART.yarnLine}
        strokeWidth="1.2"
        fill="none"
      />
    </svg>
  )
}
