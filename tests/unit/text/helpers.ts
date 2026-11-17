import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractPages } from '../../../src/shared/text/extract'
import { dropHeadersFooters } from '../../../src/shared/text/filters'
import { buildLines } from '../../../src/shared/text/lines'
import { SpokenText } from '../../../src/shared/text/spoken'
import type { Line, PageText, TextItem } from '../../../src/shared/text/types'

export const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'pdfs')
/** A fixture's bytes. `extractPages` copies its input, so the same buffer can be passed again. */
export const readFixture = (name: string): Buffer => readFileSync(join(FIXTURES, name))

/** A fixture's JSON sidecar: what the pipeline should produce for it (see each file's `format`). */
export interface Sidecar {
  fixture: string
  pageCount: number
  pages: Array<{
    page: number
    lines: string[]
    spoken: string
    spokenReadEverything: string
    /** Only in citations.json: the spoken text with readCitations on. */
    spokenWithCitations?: string
    skipped: Array<{ text: string; reason: string }>
  }>
}

/** Every fixture's sidecar, in file-name order. */
export const loadSidecars = (): Sidecar[] =>
  readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Sidecar)

export type ItemSpec = Partial<TextItem> & { str: string; x: number; y: number }

/** A synthetic page; item `index` defaults to the position in `items`, `width` to 5pt per character. */
export function page(items: ItemSpec[], pageNo = 1, width = 612, height = 792): PageText {
  return {
    page: pageNo,
    width,
    height,
    items: items.map((i, index) => ({
      page: pageNo,
      index,
      fontSize: 10,
      width: i.str.length * 5,
      ...i
    }))
  }
}

/** A real `buildLines` line made of one text item (`str` kept as given, `text` normalized). */
export function line(str: string, pageNo = 1, itemIndex = 0, y = 100): Line {
  return lineOf([{ str, x: 72, y, index: itemIndex }], pageNo)
}

/** A real `buildLines` line from several items on one baseline (they must form a single line). */
export function lineOf(items: ItemSpec[], pageNo = 1): Line {
  const lines = buildLines(page(items, pageNo))
  if (lines.length !== 1) throw new Error(`expected one line, got ${lines.length}`)
  return lines[0]
}

/** Lines of every page of a fixture. */
export async function linesOf(file: string): Promise<{ pages: PageText[]; lines: Line[][] }> {
  const pages = await extractPages(readFixture(file))
  return { pages, lines: pages.map(buildLines) }
}

/**
 * Spoken text of a fixture: extract -> lines -> the filters under test -> SpokenText, with the
 * blocks joined by single spaces.
 */
export async function spokenOf(
  file: string,
  opts: { onlyHeadersFooters?: boolean } = {}
): Promise<string> {
  const { pages, lines } = await linesOf(file)
  const kept = opts.onlyHeadersFooters
    ? dropHeadersFooters(
        lines,
        pages.map((p) => p.height)
      )
    : lines
  const s = new SpokenText()
  for (const l of kept.flat()) s.appendLine(l)
  return s
    .blocks()
    .map((b) => b.text)
    .join(' ')
}
