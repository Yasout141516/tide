import type { ReadingFilters } from '../../../shared/text/types'
import { useLibrary } from '../state/useLibrary'
import { tide } from '../lib/tide'
import { useAttempt } from './useAttempt'
import { exportFolderLabel } from '../save/names'
import { SettingRow, softButton } from './controls'

const ROWS: { key: keyof ReadingFilters; label: string; hint?: string }[] = [
  { key: 'skipHeadersFooters', label: 'Skip page numbers, headers and footers' },
  { key: 'skipFootnotes', label: 'Skip footnotes' },
  { key: 'stopAtReferences', label: 'Stop at References' },
  { key: 'skipCaptionsTables', label: 'Skip captions and table text' },
  { key: 'skipCoverPages', label: 'Skip cover and copyright pages' },
  {
    key: 'readCitations',
    label: 'Read citations aloud',
    hint: 'e.g. “(Smith, 2019)”. Off reads more smoothly.'
  }
]

const FOLDER_FAILED = "Couldn't change the folder. Please try again."

export function ReadingTab(): React.JSX.Element {
  const library = useLibrary()
  const attempt = useAttempt()
  const filters = library?.settings.reading
  const folder = library?.exportFolder
  return (
    <section aria-labelledby="reading-heading">
      <h4 id="reading-heading" className="m-0 mb-3 font-display text-[19px] font-bold">
        Reading
      </h4>
      {ROWS.map((r) => (
        <SettingRow
          key={r.key}
          id={`reading-${r.key}`}
          label={r.label}
          hint={r.hint}
          checked={filters?.[r.key] ?? false}
          onChange={(next) => attempt(tide().library.setSettings({ reading: { [r.key]: next } }))}
        />
      ))}
      <p className="mt-2.5 mb-0 text-xs text-muted">
        A reading set to Read everything ignores these.
      </p>

      <h4 id="save-audio-heading" className="m-0 mt-6 mb-2 font-display text-[16px] font-bold">
        Save audio to
      </h4>
      <div
        role="group"
        aria-labelledby="save-audio-heading"
        className="flex flex-wrap items-center gap-2.5"
      >
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">
          {exportFolderLabel(folder)}
        </span>
        <button
          type="button"
          className={softButton}
          onClick={() => attempt(tide().library.chooseExportFolder(), FOLDER_FAILED)}
        >
          Change folder…
        </button>
        {folder?.custom ? (
          <button
            type="button"
            className={softButton}
            onClick={() => attempt(tide().library.resetExportFolder(), FOLDER_FAILED)}
          >
            Use Music › Tide
          </button>
        ) : null}
      </div>
    </section>
  )
}
