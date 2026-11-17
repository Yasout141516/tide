import { readFileSync } from 'fs'
import { resolve } from 'path'
import { test, expect } from '@playwright/test'
import { launchTide } from './launch'

type Probe = { kind: string; numPages?: number; firstPageText?: string; reopened?: boolean }
type ProbeWindow = { __tidePdfProbe: (bytes: number[]) => Promise<Probe> }

const fixture = (name: string): number[] =>
  Array.from(readFileSync(resolve(__dirname, '..', 'fixtures', 'pdfs', name)))

test('the renderer opens a PDF with the pdf.js worker under the CSP', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const messages: string[] = []
  win.on('console', (m) => messages.push(m.text()))
  win.on('pageerror', (e) => messages.push(String(e)))
  await win.waitForFunction(() => '__tidePdfProbe' in window)
  const probe = (bytes: number[]): Promise<Probe> =>
    win.evaluate((b) => (window as unknown as ProbeWindow).__tidePdfProbe(b), bytes)

  const ok = await probe(fixture('single-column.pdf'))
  expect(ok.kind).toBe('ok')
  expect(ok.numPages).toBe(4)
  expect(ok.firstPageText).toContain('PSYC 201')
  // The same bytes open a second time: openPdf hands pdf.js a copy.
  expect(ok.reopened).toBe(true)

  expect((await probe(fixture('locked.pdf'))).kind).toBe('needs-password')
  expect((await probe(fixture('not-a-pdf.pdf'))).kind).toBe('damaged')

  expect(messages.filter((m) => /Content Security Policy|Refused to/.test(m))).toEqual([])
  await app.close()
})
