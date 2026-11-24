const gotIt =
  'inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border-0 bg-primary px-4 font-sans text-[13px] font-extrabold text-on-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/** The one-time hint, stuck near the top of the stage (so near the top of the first visible page). */
export function SelectTip({ onGotIt }: { onGotIt(): void }): React.JSX.Element {
  return (
    <div
      role="status"
      className="sticky top-2 z-10 mx-auto my-2 flex max-w-[460px] items-center gap-3 rounded-2xl bg-surface p-3 pl-4 text-[14px] font-semibold text-ink shadow-[0_8px_24px_var(--shadow)]"
    >
      <span>Select any text to read from there or save it as audio.</span>
      <button type="button" onClick={onGotIt} className={gotIt}>
        Got it
      </button>
    </div>
  )
}
