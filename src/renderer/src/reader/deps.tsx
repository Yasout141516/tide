import { createContext, useContext, type ReactNode } from 'react'
import type { OpenPdfResult } from './pdf'
import type { BuildResult } from '../../../shared/text/pipeline'
import type { PageText, ReadingFilters } from '../../../shared/text/types'

/** Things the renderer gets from outside React (pdf.js and the text worker). Tests provide fakes; later tasks extend this. */
export interface ReaderDepsValue {
  openPdf(data: Uint8Array, password?: string): Promise<OpenPdfResult>
  /** The text pipeline; the default runs it in a Web Worker. */
  buildSentences(pages: PageText[], filters: ReadingFilters): Promise<BuildResult>
}

// pdf.js is loaded on first use, so importing this file (and App) never pulls it into jsdom tests.
const defaultDeps: ReaderDepsValue = {
  openPdf: async (data, password) => (await import('./pdf')).openPdf(data, password),
  buildSentences: async (pages, filters) =>
    (await import('./pipeline-client')).buildSentencesInWorker(pages, filters)
}

const ReaderDeps = createContext<ReaderDepsValue>(defaultDeps)

export function ReaderDepsProvider({
  value,
  children
}: {
  /** Anything left out keeps its real implementation. */
  value: Partial<ReaderDepsValue>
  children: ReactNode
}): React.JSX.Element {
  return <ReaderDeps.Provider value={{ ...defaultDeps, ...value }}>{children}</ReaderDeps.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useReaderDeps(): ReaderDepsValue {
  return useContext(ReaderDeps)
}
