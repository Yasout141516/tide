import type { ReadingFilters } from '../../../shared/text/types'
import { useLibrary } from '../state/useLibrary'
import { tide } from '../lib/tide'
import { useAttempt } from './useAttempt'
import { Switch } from './Switch'

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

const button =
  'min-h-9 min-w-9 cursor-pointer rounded-[11px] border-0 bg-soft px-[11px] py-[5px] font-sans text-[13px] font-extrabold text-soft-ink'

export function ReadingTab(): React.JSX.Element {
  const library = useLibrary()
  const attempt = useAttempt()
  const filters = library?.settings.reading
  const folder = library?.exportFolder ?? { name: 'Tide', custom: false }
  return (
    <section aria-labelledby="reading-heading">
      <h4 id="reading-heading" className="m-0 mb-3 font-display text-[19px] font-bold">
        Reading
      </h4>
      {ROWS.map((r) => (
        <div
          key={r.key}
          className="flex items-center justify-between gap-3.5 border-b border-border px-0.5 py-[11px]"
        >
          <div className="text-[13.5px] font-bold">
            <span id={`reading-${r.key}`}>{r.label}</span>
            {r.hint ? (
              <small className="mt-0.5 block text-xs font-normal text-muted">{r.hint}</small>
            ) : null}
          </div>
          <Switch
            checked={filters?.[r.key] ?? false}
            labelledBy={`reading-${r.key}`}
            onChange={(next) =>
              attempt(
                tide().library.setSettings({ reading: { [r.key]: next } }),
                "Couldn't change that setting. Please try again."
              )
            }
          />
        </div>
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
          {folder.custom ? folder.name : 'Music › Tide'}
        </span>
        <button
          type="button"
          className={button}
          onClick={() =>
            attempt(
              tide().library.chooseExportFolder(),
              "Couldn't change the folder. Please try again."
            )
          }
        >
          Change folder…
        </button>
        {folder.custom ? (
          <button
            type="button"
            className={button}
            onClick={() =>
              attempt(
                tide().library.resetExportFolder(),
                "Couldn't change the folder. Please try again."
              )
            }
          >
            Use Music › Tide
          </button>
        ) : null}
      </div>
    </section>
  )
}
