import { Sprout } from '../theme/mascots/Sprout'
import { useTheme } from '../theme/theme'

export function Wordmark(): React.JSX.Element {
  const { resolved } = useTheme()
  return (
    <div className="mx-1 flex items-center gap-2">
      {resolved === 'pixel-quest' ? (
        <Sprout size={28} />
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="17" cy="7" r="3.2" style={{ fill: 'var(--logo-sun)' }} />
          <path
            d="M1 14c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0"
            style={{ stroke: 'var(--logo-wave-a)' }}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M1 19c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0"
            style={{ stroke: 'var(--logo-wave-b)' }}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )}
      <h1 className="m-0 font-display text-[21px] leading-none font-bold text-primary-deep">
        Tide
      </h1>
    </div>
  )
}
