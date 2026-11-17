/**
 * Prints what Tide would speak for a PDF: one sentence per line, with a `--- page N ---` line when
 * the page changes (the page of each sentence's first text item).
 *
 *   npm run spoken-text -- <file.pdf> [--everything]
 *
 * `--everything` uses READ_EVERYTHING (no filters, citations kept) instead of the default filters.
 * A summary (pages, sentences, pages without text) goes to stderr, so stdout can be redirected to a
 * file and compared with a golden snapshot.
 */
import { readFileSync } from 'node:fs'
import { extractPages } from '../src/shared/text/extract'
import { buildSentences, renderSentences } from '../src/shared/text/pipeline'
import { DEFAULT_FILTERS, READ_EVERYTHING } from '../src/shared/text/types'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const everything = args.includes('--everything')
  const files = args.filter((a) => !a.startsWith('--'))
  if (files.length !== 1) {
    process.stderr.write('usage: npm run spoken-text -- <file.pdf> [--everything]\n')
    process.exit(2)
  }
  const pages = await extractPages(readFileSync(files[0]))
  const { sentences, textlessPages, skippedPages } = buildSentences(
    pages,
    everything ? READ_EVERYTHING : DEFAULT_FILTERS
  )
  process.stdout.write(renderSentences(sentences))
  process.stderr.write(
    `${pages.length} pages, ${sentences.length} sentences` +
      (textlessPages.length ? `, no text on pages ${textlessPages.join(', ')}` : '') +
      (skippedPages.length
        ? `, skipped pages ${skippedPages.map((s) => `${s.page} (${s.reason})`).join(', ')}`
        : '') +
      '\n'
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
