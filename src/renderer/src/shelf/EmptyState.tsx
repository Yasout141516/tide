type Props = { onAdd(): void; platform: string }

export function EmptyState({ onAdd, platform }: Props): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-[30px] text-center">
      <svg width="120" height="70" viewBox="0 0 120 70" aria-hidden="true">
        <circle cx="88" cy="20" r="11" style={{ fill: 'var(--logo-sun)' }} />
        <path
          d="M4 44c9-9 15-9 22 0s14 9 22 0 15-9 22 0 14 9 22 0 15-9 22 0"
          style={{ stroke: 'var(--logo-wave-a)' }}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M4 58c9-9 15-9 22 0s14 9 22 0 15-9 22 0 14 9 22 0 15-9 22 0"
          style={{ stroke: 'var(--logo-wave-b)' }}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          opacity=".7"
        />
      </svg>
      <h2 className="mt-4 mb-1.5 font-display text-2xl font-bold text-ink">Your shelf is empty</h2>
      <p className="mb-[18px] max-w-[340px] text-sm leading-normal text-muted">
        Add a PDF from your course and Tide will read it to you in a calm voice.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[22px] py-[13px] font-sans text-[15px] font-extrabold text-on-primary"
      >
        ＋ Add your first reading
      </button>
      {platform === 'darwin' ? (
        <div className="mt-[18px] max-w-[380px] rounded-xl border border-dashed border-border bg-surface px-3.5 py-2.5 text-[13px] leading-normal text-muted">
          <b>Tip:</b> you can also right-click any PDF in Finder and choose <b>Open With → Tide</b>.
        </div>
      ) : null}
    </div>
  )
}
