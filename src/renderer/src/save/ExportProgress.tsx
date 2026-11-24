/** The card above the player while audio is being made. */
export function ExportProgress({
  label,
  percent,
  onCancel
}: {
  label: string
  percent: number
  onCancel(): void
}): React.JSX.Element {
  return (
    <section
      aria-label="Saving audio"
      className="mx-4 mb-2 rounded-[14px] border border-border bg-surface px-[18px] py-4 text-ink shadow-[0_8px_20px_var(--shadow)]"
    >
      <div className="flex items-center gap-3">
        <b className="text-[14px]">Making your audio…</b>
        <span className="ml-auto text-[12.5px] text-muted">
          {label} · {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Making your audio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-soft"
      >
        <i className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[12.5px] text-muted">
        <span>You can keep reading while this finishes.</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto min-h-9 cursor-pointer rounded-[10px] border-0 bg-transparent px-3 font-sans text-[12.5px] font-extrabold text-soft-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
