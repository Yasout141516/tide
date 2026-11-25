import { MochiBox, MochiHead } from './mascots/Mochi'
import { Sprout } from './mascots/Sprout'
import { useTheme } from './theme'

/**
 * The theme's mark: Mochi for Kitty, the Sprout for Pixel Quest, the sun and waves otherwise.
 * 'small' sits beside the wordmark; 'hero' fills the empty shelf. The two sun-and-wave drawings
 * are laid out for their own size (stroke widths and curves differ), so each keeps its own path set.
 */
export function ThemeMark({ size }: { size: 'small' | 'hero' }): React.JSX.Element {
  const { resolved } = useTheme()
  const small = size === 'small'
  if (resolved === 'kitty') return small ? <MochiHead size={32} /> : <MochiBox />
  if (resolved === 'pixel-quest') return <Sprout size={small ? 28 : 96} />
  const wave = small
    ? 'M1 14c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0'
    : 'M4 44c9-9 15-9 22 0s14 9 22 0 15-9 22 0 14 9 22 0 15-9 22 0'
  const waveB = small
    ? 'M1 19c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0'
    : 'M4 58c9-9 15-9 22 0s14 9 22 0 15-9 22 0 14 9 22 0 15-9 22 0'
  return (
    <svg
      width={small ? 24 : 120}
      height={small ? 24 : 70}
      viewBox={small ? '0 0 24 24' : '0 0 120 70'}
      aria-hidden="true"
    >
      <circle
        cx={small ? 17 : 88}
        cy={small ? 7 : 20}
        r={small ? 3.2 : 11}
        style={{ fill: 'var(--logo-sun)' }}
      />
      <path
        d={wave}
        style={{ stroke: 'var(--logo-wave-a)' }}
        strokeWidth={small ? 2.4 : 4}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={waveB}
        style={{ stroke: 'var(--logo-wave-b)' }}
        strokeWidth={small ? 2.4 : 4}
        fill="none"
        strokeLinecap="round"
        opacity={small ? undefined : '.7'}
      />
    </svg>
  )
}
