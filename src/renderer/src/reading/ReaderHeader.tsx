import type { ReactNode } from 'react'
import type { ReadingView } from '../../../shared/library/types'

type Props = {
  reading: ReadingView
  courseName: string | null
  page: number | null
  menu: ReactNode
}

export function ReaderHeader({ reading, courseName, page, menu }: Props): React.JSX.Element {
  const meta = `${courseName ?? 'Other'}${page !== null ? ` · Page ${page}` : ''}`
  return (
    <header className="flex min-h-12 items-center gap-3 px-4 py-2">
      <span className="shrink-0 text-[10.5px] font-extrabold tracking-[1px] text-page-meta uppercase">
        {meta}
      </span>
      <h2 className="m-0 min-w-0 flex-1 truncate font-sans text-[15px] font-extrabold text-ink">
        {reading.title}
      </h2>
      {menu}
    </header>
  )
}
