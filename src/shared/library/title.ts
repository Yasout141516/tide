// Picks the title a new reading gets: the PDF's own title when it looks like a real one, else the file name.

const PLACEHOLDER = /^(untitled|document\d*|title|slide \d+)$/i
const OFFICE_PREFIX = /^microsoft (word|powerpoint)\b/i
const FILE_EXTENSION = /\.(docx?|pptx?|pdf|indd|tex|qxd)\b/i

function usableMetaTitle(raw: string | undefined): string | null {
  const t = raw?.trim() ?? ''
  if (t.length < 4 || t.length > 120) return null
  if ((t.match(/\p{L}/gu) ?? []).length < 2) return null
  if (PLACEHOLDER.test(t) || OFFICE_PREFIX.test(t) || FILE_EXTENSION.test(t)) return null
  return t
}

export function readingTitle(metaTitle: string | undefined, fileName: string): string {
  const meta = usableMetaTitle(metaTitle)
  if (meta) return meta
  const fromFile = fileName
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return fromFile === '' ? 'Untitled reading' : fromFile
}
