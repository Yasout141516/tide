import { describe, it, expect } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPages } from '../../../src/shared/text/extract'
import { pageTextFromContent } from '../../../src/shared/text/page-text'
import { classifyPdfError } from '../../../src/shared/text/pdf-errors'
import { readFixture } from './helpers'

/** The error pdf.js rejects `getDocument` with for these bytes. */
async function openError(data: Uint8Array, password?: string): Promise<unknown> {
  const task = getDocument({ data: new Uint8Array(data), password, verbosity: 0 })
  try {
    await task.promise
  } catch (err) {
    return err
  } finally {
    await task.destroy()
  }
  throw new Error('expected the PDF to fail to open')
}

describe('pageTextFromContent', () => {
  it('maps pdf.js items to top-origin points and skips empty strings', () => {
    const p = pageTextFromContent(
      2,
      [0, 0, 612, 792],
      [
        { str: '', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
        { str: 'Hi', transform: [9, 0, 0, 9, 72, 752], width: 10, height: 9 }
      ]
    )
    expect(p).toEqual({
      page: 2,
      width: 612,
      height: 792,
      items: [{ page: 2, index: 1, str: 'Hi', x: 72, y: 40, width: 10, fontSize: 9 }]
    })
  })

  it('skips marked-content items that have no str', () => {
    const p = pageTextFromContent(1, [0, 0, 100, 100], [{ transform: [], width: 0, height: 0 }])
    expect(p.items).toEqual([])
  })
})

describe('password-protected PDFs', () => {
  it('a locked PDF needs a password and opens with the right one', async () => {
    await expect(extractPages(readFixture('locked.pdf'))).rejects.toThrow(
      'PDF is password-protected'
    )
    const [p] = await extractPages(readFixture('locked.pdf'), 'tide')
    expect(p.items.map((i) => i.str).join('')).toBe('Locked fixture text.')
  })

  it('classifies a missing and a wrong password', async () => {
    expect(classifyPdfError(await openError(readFixture('locked.pdf')))).toBe('needs-password')
    expect(classifyPdfError(await openError(readFixture('locked.pdf'), 'nope'))).toBe(
      'wrong-password'
    )
  })

  it('classifies a non-PDF and an empty file as damaged', async () => {
    expect(classifyPdfError(await openError(readFixture('not-a-pdf.pdf')))).toBe('damaged')
    expect(classifyPdfError(await openError(new Uint8Array(0)))).toBe('damaged')
    expect(classifyPdfError('boom')).toBe('damaged')
    expect(classifyPdfError(null)).toBe('damaged')
  })
})
