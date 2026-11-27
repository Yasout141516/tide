import { themeCopy } from '../theme/copy'
import { ThemeMark } from '../theme/ThemeMark'
import { useTheme } from '../theme/theme'

type Props = { onAdd(): void; platform: string }

export function EmptyState({ onAdd, platform }: Props): React.JSX.Element {
  const { resolved } = useTheme()
  return (
    <div className="flex h-full flex-col items-center justify-center p-[30px] text-center">
      <ThemeMark size="hero" />
      <h2 className="mt-4 mb-1.5 font-display text-2xl font-bold text-ink">Your shelf is empty</h2>
      {themeCopy(resolved, 'emptyShelf') ? (
        <p
          aria-hidden="true"
          className="kt-line m-0 mb-1.5 font-display text-base text-primary-deep"
        >
          {themeCopy(resolved, 'emptyShelf')}
        </p>
      ) : null}
      <p className="mb-[18px] max-w-[340px] text-sm leading-normal text-muted">
        Add a PDF from your course and Tide will read it to you in a calm voice.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="pq-add kt-add min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[22px] py-[13px] font-sans text-[15px] font-extrabold text-on-primary"
      >
        ＋ Add your first reading
      </button>
      {platform === 'darwin' ? (
        <div className="mt-[18px] max-w-[380px] rounded-xl border border-dashed border-border bg-surface px-3.5 py-2.5 text-[12.5px] leading-normal text-muted">
          <b>Tip:</b> you can also right-click any PDF in Finder and choose <b>Open With → Tide</b>.
        </div>
      ) : null}
    </div>
  )
}
