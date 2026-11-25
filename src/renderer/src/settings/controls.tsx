import { Switch } from './Switch'

/** The soft rounded button of the settings tabs. */
export const softButton =
  'min-h-9 min-w-9 cursor-pointer rounded-[11px] border-0 bg-soft px-[11px] py-[5px] font-sans text-[13px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-50'

/** One labelled on/off setting: the label (and optional hint) on the left, the switch on the right. */
export function SettingRow({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  /** Id of the label; the switch is named by it. */
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange(next: boolean): void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3.5 border-b border-border px-0.5 py-[11px]">
      <div className="text-[13.5px] font-bold">
        <span id={id}>{label}</span>
        {hint ? (
          <small className="mt-0.5 block text-xs font-normal text-muted">{hint}</small>
        ) : null}
      </div>
      <Switch checked={checked} labelledBy={id} onChange={onChange} />
    </div>
  )
}
