/**
 * Her real course readings, run through the whole text pipeline. They live only in the git-ignored
 * `local-fixtures/` folder, so this suite skips itself on CI and on any machine without them.
 *
 * For every `local-fixtures/<name>.pdf`: if an approved `local-fixtures/spoken/<name>.txt` exists the
 * spoken text must match it; otherwise (or on a mismatch) `local-fixtures/spoken/<name>.actual.txt`
 * is written for review. Approve a reading by renaming its `.actual.txt` to `.txt`.
 *
 * Each reading also logs one aggregate line (reading index, pages, sentences, changed lines against the
 * approved text or null): numbers only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPages } from '../../../src/shared/text/extract'
import { buildSentences, renderSentences } from '../../../src/shared/text/pipeline'

const DIR = join(__dirname, '..', '..', '..', 'local-fixtures')
const OUT = join(DIR, 'spoken')
const pdfs = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort()
  : []

/** Size of the symmetric difference between two texts' lines (multiset), so a changed line counts twice. */
function changedLineCount(a: string, b: string): number {
  const count = new Map<string, number>()
  for (const l of a.split('\n')) count.set(l, (count.get(l) ?? 0) + 1)
  for (const l of b.split('\n')) count.set(l, (count.get(l) ?? 0) - 1)
  let n = 0
  for (const v of count.values()) n += Math.abs(v)
  return n
}

describe.skipIf(!existsSync(DIR) || pdfs.length === 0)('local readings', () => {
  pdfs.forEach((file, index) =>
    it(file, { timeout: 120_000 }, async () => {
      const name = file.replace(/\.pdf$/i, '')
      const pages = await extractPages(readFileSync(join(DIR, file)))
      const { sentences } = buildSentences(pages)
      const got = renderSentences(sentences)
      const approved = join(OUT, `${name}.txt`)
      const want = existsSync(approved) ? readFileSync(approved, 'utf8') : null
      // Aggregate numbers only: never a file name or any text.
      console.log(
        JSON.stringify({
          reading: index + 1,
          pages: pages.length,
          sentences: sentences.length,
          changedLines: want === null ? null : changedLineCount(want, got)
        })
      )
      if (want !== got) {
        mkdirSync(OUT, { recursive: true })
        writeFileSync(join(OUT, `${name}.actual.txt`), got)
      }
      if (want !== null) expect(got).toBe(want)
    })
  )
})
