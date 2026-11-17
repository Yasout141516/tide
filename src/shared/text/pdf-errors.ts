/** Why a PDF could not be opened. */
export type PdfOpenFailure = 'needs-password' | 'wrong-password' | 'damaged'

/**
 * Classifies the error pdf.js rejects `getDocument` with. A `PasswordException` carries pdf.js's
 * `PasswordResponses` code: 1 = a password is needed, 2 = the one given is wrong. Anything else
 * (not a PDF, truncated, empty, ...) is `damaged`.
 */
export function classifyPdfError(err: unknown): PdfOpenFailure {
  const e = err as { name?: unknown; code?: unknown } | null
  if (e?.name === 'PasswordException') {
    if (e.code === 1) return 'needs-password'
    if (e.code === 2) return 'wrong-password'
  }
  return 'damaged'
}
