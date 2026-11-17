/** Holds the player's place until M4: the wave line in its "off" colour and a label slot. No buttons. */
export function PlayerBarPlaceholder({ label }: { label?: string }): React.JSX.Element {
  return (
    <footer
      aria-label="Player"
      className="flex items-center gap-4 border-t border-border bg-surface px-[22px] py-3"
    >
      <div className="min-w-[120px] flex-1">
        <svg
          viewBox="0 0 400 20"
          width="100%"
          height="20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 10 Q 12.5 1 25 10 T 50 10 T 75 10 T 100 10 T 125 10 T 150 10 T 175 10 T 200 10 T 225 10 T 250 10 T 275 10 T 300 10 T 325 10 T 350 10 T 375 10 T 400 10"
            fill="none"
            strokeWidth="3.2"
            strokeLinecap="round"
            style={{ stroke: 'var(--wave-off)' }}
          />
        </svg>
        <div className="mt-0.5 min-h-[1em] text-[11.5px] font-semibold text-muted">{label}</div>
      </div>
    </footer>
  )
}
