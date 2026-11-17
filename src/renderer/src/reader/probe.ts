import { openPdf } from './pdf'

export interface PdfProbeResult {
  kind: string
  numPages?: number
  firstPageText?: string
  /** True when the same bytes opened a second time (pdf.js must not have detached the caller's copy). */
  reopened?: boolean
}

declare global {
  interface Window {
    /** Present only when the app runs with TIDE_E2E=1 (see main.tsx). */
    __tidePdfProbe?: (bytes: number[]) => Promise<PdfProbeResult>
  }
}

/** Opens a PDF through the real `openPdf` and reports what came out. Test-only. */
export function installPdfProbe(): void {
  window.__tidePdfProbe = async (bytes) => {
    const data = new Uint8Array(bytes)
    const r = await openPdf(data)
    if (r.kind !== 'ok') return { kind: r.kind }
    try {
      const page = await r.doc.pageText(1)
      // Same Uint8Array again: openPdf passes pdf.js a copy, so this must still work.
      const again = await openPdf(data)
      if (again.kind === 'ok') await again.doc.destroy()
      return {
        kind: 'ok',
        numPages: r.doc.numPages,
        firstPageText: page.items.map((i) => i.str).join(' '),
        reopened: again.kind === 'ok'
      }
    } finally {
      await r.doc.destroy()
    }
  }
}
