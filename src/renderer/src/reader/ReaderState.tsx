import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Sentence } from '../../../shared/text/types'

/** What Task 15 (highlight, stepping, resume) and the header / player label read. */
export interface ReaderStateValue {
  sentences: Sentence[]
  /** Index into `sentences` of the sentence being read, or null (none yet). */
  current: number | null
  setCurrent(i: number | null): void
  /** The page of the current sentence, else the top visible page. */
  page: number
  /** Null until a PDF is open. */
  numPages: number | null
}

/** What ReaderView reports; only ReaderView uses it. */
export interface ReaderReport {
  sentences: Sentence[]
  topPage: number
  numPages: number | null
}

const EMPTY: ReaderReport = { sentences: [], topPage: 1, numPages: null }

const StateCtx = createContext<ReaderStateValue>({
  sentences: [],
  current: null,
  setCurrent: () => {},
  page: 1,
  numPages: null
})
const ReportCtx = createContext<(r: ReaderReport) => void>(() => {})

/** Wraps the whole reading area (header, ReaderView, player), so they all see one reader state. */
export function ReaderStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [report, setReport] = useState<ReaderReport>(EMPTY)
  const [current, setCurrent] = useState<number | null>(null)
  const value = useMemo<ReaderStateValue>(() => {
    const s = current === null ? undefined : report.sentences[current]
    return {
      sentences: report.sentences,
      current: s ? current : null,
      setCurrent,
      page: s ? s.spans[0].page : report.topPage,
      numPages: report.numPages
    }
  }, [report, current])
  return (
    <ReportCtx.Provider value={setReport}>
      <StateCtx.Provider value={value}>{children}</StateCtx.Provider>
    </ReportCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the hooks belong with their provider
export function useReaderState(): ReaderStateValue {
  return useContext(StateCtx)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReportReader(): (r: ReaderReport) => void {
  return useContext(ReportCtx)
}
