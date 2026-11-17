export function Wordmark(): React.JSX.Element {
  return (
    <div className="mx-1 flex items-center gap-2">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="17" cy="7" r="3.2" fill="#9DD2F5" />
        <path
          d="M1 14c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0"
          stroke="#1E88C7"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M1 19c3-3 5-3 7.5 0s4.5 3 7 0 5-3 7.5 0"
          stroke="#4FB0E8"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <h1 className="m-0 font-display text-[21px] leading-none font-bold text-primary-deep">
        Tide
      </h1>
    </div>
  )
}
