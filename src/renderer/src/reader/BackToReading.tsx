/**
 * Shown while she has scrolled away from the line being read. Bottom-centre of the stage, above the
 * player bar and one step above the toast (which sits at the bar's top edge), so neither hides the other.
 */
export function BackToReading({
  page,
  onClick
}: {
  page: number
  onClick(): void
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[4.75rem] z-20 flex justify-center px-4">
      <button
        type="button"
        data-back-to-reading=""
        onClick={onClick}
        className="on-page-float pointer-events-auto inline-flex min-h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-0 bg-primary px-5 font-sans text-[13.5px] font-extrabold text-on-primary shadow-[0_8px_24px_var(--shadow)]"
      >
        Back to reading · Page {page}
      </button>
    </div>
  )
}
