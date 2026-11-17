import { createContext, useContext, type ReactNode } from 'react'
import type { OpenPdfResult } from './pdf'

/** Things the renderer gets from outside React (pdf.js). Tests provide fakes; later tasks extend this. */
export interface ReaderDepsValue {
  openPdf(data: Uint8Array, password?: string): Promise<OpenPdfResult>
}

// pdf.js is loaded on first use, so importing this file (and App) never pulls it into jsdom tests.
const defaultDeps: ReaderDepsValue = {
  openPdf: async (data, password) => (await import('./pdf')).openPdf(data, password)
}

const ReaderDeps = createContext<ReaderDepsValue>(defaultDeps)

export function ReaderDepsProvider({
  value,
  children
}: {
  value: ReaderDepsValue
  children: ReactNode
}): React.JSX.Element {
  return <ReaderDeps.Provider value={value}>{children}</ReaderDeps.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useReaderDeps(): ReaderDepsValue {
  return useContext(ReaderDeps)
}
