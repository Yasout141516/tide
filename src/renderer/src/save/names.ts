import { formatMinutes } from '../lib/minutes'

export type SaveScope =
  | { kind: 'selection'; page: number }
  | { kind: 'pages'; from: number; to: number }
  | { kind: 'whole' }

/** The suggested file name (no extension): `COURSE – Title – p31–40`, trimmed to what the scope needs. */
export function defaultBaseName(o: {
  course: string | null
  title: string
  scope: SaveScope
}): string {
  const head = o.course ? `${o.course} – ${o.title}` : o.title
  const { scope } = o
  if (scope.kind === 'whole') return head
  if (scope.kind === 'selection') return `${head} – p${scope.page}`
  return scope.from === scope.to
    ? `${head} – p${scope.from}`
    : `${head} – p${scope.from}–${scope.to}`
}

/** How long a saved file will play, in her words. */
export function durationLabel(sec: number): string {
  return sec < 60 ? 'under a minute' : `about ${formatMinutes(Math.round(sec / 60))}`
}

/** Where saved audio goes, in her words. */
export function exportFolderLabel(folder: { name: string; custom: boolean } | undefined): string {
  return folder?.custom ? folder.name : 'Music › Tide'
}
