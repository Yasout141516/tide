type Props = {
  checked: boolean
  /** id of the element that names the switch. */
  labelledBy: string
  onChange(next: boolean): void
}

/** Accessible on/off switch: a 36 px tall hit area around a 24×40 track. */
export function Switch({ checked, labelledBy, onChange }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className="flex min-h-9 flex-none cursor-pointer items-center border-0 bg-transparent p-0"
    >
      <span
        aria-hidden="true"
        className={`relative block h-6 w-10 rounded-full ${checked ? 'bg-primary' : 'bg-border'}`}
      >
        <span
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface shadow-[0_1px_2px_var(--shadow)] ${
            checked ? 'left-[19px]' : 'left-[3px]'
          }`}
        />
      </span>
    </button>
  )
}
