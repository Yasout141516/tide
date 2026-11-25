import { ThemeMark } from '../theme/ThemeMark'

export function Wordmark(): React.JSX.Element {
  return (
    <div className="mx-1 flex items-center gap-2">
      <ThemeMark size="small" />
      <h1 className="m-0 font-display text-[21px] leading-none font-bold text-primary-deep">
        Tide
      </h1>
    </div>
  )
}
