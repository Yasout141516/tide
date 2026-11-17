/**
 * Her real course readings, run through the whole text pipeline. They live only in the git-ignored
 * `local-fixtures/` folder, so this suite skips itself on CI and on any machine without them.
 *
 * For every `local-fixtures/<name>.pdf`: if an approved `local-fixtures/spoken/<name>.txt` exists the
 * spoken text must match it; otherwise (or on a mismatch) `local-fixtures/spoken/<name>.actual.txt`
 * is written for review. Approve a reading by renaming its `.actual.txt` to `.txt`.
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

describe.skipIf(!existsSync(DIR) || pdfs.length === 0)('local readings', () => {
  for (const file of pdfs)
    it(file, { timeout: 120_000 }, async () => {
      const name = file.replace(/\.pdf$/i, '')
      const pages = await extractPages(new Uint8Array(readFileSync(join(DIR, file))))
      const got = renderSentences(buildSentences(pages).sentences)
      const approved = join(OUT, `${name}.txt`)
      const want = existsSync(approved) ? readFileSync(approved, 'utf8') : null
      if (want !== got) {
        mkdirSync(OUT, { recursive: true })
        writeFileSync(join(OUT, `${name}.actual.txt`), got)
      }
      if (want !== null) expect(got).toBe(want)
    })
})
