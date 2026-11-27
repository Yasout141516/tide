import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ExportSpec } from '../../../shared/ipc-types'
import type { ReadingView } from '../../../shared/library/types'
import { voiceName } from '../../../shared/voices'
import { useLibrary } from '../state/useLibrary'
import { usePlayerState } from '../player/PlayerContext'
import { useReaderState } from '../reader/ReaderState'
import { defaultBaseName, durationLabel, exportFolderLabel, type SaveScope } from './names'
import { buildExportSpec, exportSentences, TOO_LONG_MESSAGE, tooLongForOneFile } from './spec'

type Kind = 'selection' | 'pages' | 'whole'

const field =
  'rounded-[10px] border border-border bg-bg px-2.5 py-1.5 font-sans text-[13px] text-ink'
const row =
  'flex min-h-9 items-center gap-2 rounded-[11px] px-1 py-1 text-[13.5px] font-semibold text-ink'
const small = 'ml-auto text-[12px] font-semibold text-muted'

const AUDIOBOOK_LINE =
  'Whole readings save as an audiobook. Open it in Books on your iPhone and it remembers your place.'

const pageOf = (s: { spans: { page: number }[] }): number => s.spans[0].page

/** "Save as audio": what to save, the file name, then Save audio. */
export function SavePanel({
  reading,
  courseName,
  range,
  onCancel,
  onSave
}: {
  reading: ReadingView
  courseName: string | null
  /** The snapped sentence range of a selection; null when opened from the More menu. */
  range: [number, number] | null
  onCancel(): void
  onSave(spec: ExportSpec, scopeLabel: string): void
}): React.JSX.Element {
  const { sentences, page, numPages } = useReaderState()
  const { snapshot, chosenSpeed, estimateSec } = usePlayerState()
  const folder = useLibrary()?.exportFolder

  const [kind, setKind] = useState<Kind>(range ? 'selection' : 'whole')
  const [from, setFrom] = useState(String(page))
  const [to, setTo] = useState(String(page))
  const [mp3Whole, setMp3Whole] = useState(false)
  const [typedName, setTypedName] = useState<string | null>(null)

  // The estimates describe the file being saved, so they use her chosen speed, not a Finish in… one.
  const scale = chosenSpeed > 0 ? snapshot.speed / chosenSpeed : 1

  const selectionPage = range && sentences[range[0]] ? pageOf(sentences[range[0]]) : page
  const f = Number(from)
  const t = Number(to)
  const rangeOk =
    from.trim() !== '' &&
    to.trim() !== '' &&
    Number.isInteger(f) &&
    Number.isInteger(t) &&
    f >= 1 &&
    f <= t &&
    t <= (numPages ?? 0)
  /** Sentence index span of the typed pages, or null when there is nothing spoken there. */
  const pagesSpan = useMemo<[number, number] | null>(() => {
    if (!rangeOk) return null
    let a = -1
    let b = -1
    sentences.forEach((s, i) => {
      const p = pageOf(s)
      if (p >= f && p <= t) {
        if (a < 0) a = i
        b = i
      }
    })
    return a < 0 ? null : [a, b]
  }, [rangeOk, sentences, f, t])

  const lastSentence = sentences.length - 1
  const selectionEstimate = useMemo(
    () => (range ? durationLabel(estimateSec(range[0], range[1]) * scale) : ''),
    // range is a fresh array each render; its ends are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estimateSec, scale, range?.[0], range?.[1]]
  )
  const pagesEstimate = useMemo(
    () => (pagesSpan ? durationLabel(estimateSec(pagesSpan[0], pagesSpan[1]) * scale) : ''),
    [estimateSec, scale, pagesSpan]
  )
  const wholeEstimate = useMemo(
    () => (lastSentence >= 0 ? durationLabel(estimateSec(0, lastSentence) * scale) : ''),
    [estimateSec, scale, lastSentence]
  )

  const span: [number, number] | null =
    kind === 'selection'
      ? range
      : kind === 'pages'
        ? pagesSpan
        : sentences.length > 0
          ? [0, sentences.length - 1]
          : null
  // Sentences as main takes them: long ones split into pieces on the same page.
  const spoken = useMemo(
    () =>
      exportSentences(
        (span ? sentences.slice(span[0], span[1] + 1) : []).map((s) => ({
          text: s.text,
          page: pageOf(s)
        }))
      ),
    // span is a fresh array each render; its ends are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sentences, span?.[0], span?.[1]]
  )
  const tooLong = tooLongForOneFile(spoken)

  const scope: SaveScope =
    kind === 'selection'
      ? { kind, page: selectionPage }
      : kind === 'pages'
        ? { kind, from: f, to: t }
        : { kind }
  const format: 'mp3' | 'm4b' = kind === 'whole' && !mp3Whole ? 'm4b' : 'mp3'
  const suggested = defaultBaseName({
    course: courseName,
    title: reading.title,
    scope: kind === 'pages' && !rangeOk ? { kind: 'whole' } : scope
  })
  const baseName = typedName ?? suggested
  // An invalid range says so; a valid one with no spoken text says there is nothing to read.
  const pagesMessage =
    kind === 'pages'
      ? !rangeOk
        ? 'Check the page numbers.'
        : spoken.length === 0
          ? 'Nothing to read on those pages.'
          : null
      : null

  const scopeLabel =
    kind === 'selection'
      ? 'Selection'
      : kind === 'whole'
        ? 'Whole reading'
        : f === t
          ? `Page ${f}`
          : `Pages ${f}–${t}`

  const save = (): void => {
    onSave(
      buildExportSpec({
        readingId: reading.id,
        format,
        baseName,
        title: defaultBaseName({ course: null, title: reading.title, scope }),
        sentences: spoken,
        voice: snapshot.voice,
        speed: chosenSpeed
      }),
      scopeLabel
    )
  }

  const pageField = (label: string, value: string, set: (v: string) => void): React.JSX.Element => (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={value}
      min={1}
      max={numPages ?? undefined}
      onFocus={() => setKind('pages')}
      onChange={(e) => {
        setKind('pages')
        set(e.target.value)
      }}
      className={`${field} w-[68px]`}
    />
  )

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content className="fixed top-1/2 left-1/2 max-h-[calc(100%-32px)] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[18px] bg-surface p-[22px] text-ink shadow-[0_24px_50px_var(--shadow)]">
          <Dialog.Title className="m-0 mb-1 font-display text-xl font-bold text-ink">
            Save as audio
          </Dialog.Title>
          <Dialog.Description className="m-0 text-[13px] leading-[1.45] text-muted">
            An audio file you can play on your phone, at the gym or anywhere.
          </Dialog.Description>

          <div className="mt-4 mb-1 text-[12px] font-extrabold tracking-wide text-muted">
            What to save
          </div>
          {range ? (
            <label className={row}>
              <input
                type="radio"
                name="scope"
                checked={kind === 'selection'}
                onChange={() => setKind('selection')}
                className="accent-primary"
              />
              The text I selected
              <span className={small}>{selectionEstimate}</span>
            </label>
          ) : null}
          <div className={row}>
            <input
              id="save-pages"
              type="radio"
              name="scope"
              checked={kind === 'pages'}
              onChange={() => setKind('pages')}
              className="accent-primary"
            />
            <label htmlFor="save-pages">Pages</label>
            {pageField('From page', from, setFrom)}
            <span>to</span>
            {pageField('To page', to, setTo)}
            <span className={small}>{pagesEstimate}</span>
          </div>
          {pagesMessage ? (
            <p role="alert" className="m-0 mb-1 px-1 text-[12.5px] font-semibold text-warn">
              {pagesMessage}
            </p>
          ) : null}
          {tooLong ? (
            <p role="alert" className="m-0 mb-1 px-1 text-[12.5px] font-semibold text-warn">
              {TOO_LONG_MESSAGE}
            </p>
          ) : null}
          <label className={row}>
            <input
              type="radio"
              name="scope"
              checked={kind === 'whole'}
              onChange={() => setKind('whole')}
              className="accent-primary"
            />
            The whole reading
            <span className={small}>{wholeEstimate}</span>
          </label>
          {kind === 'whole' ? (
            <div className="px-1 pb-1 text-[12.5px] leading-[1.45] text-muted">
              {format === 'm4b' ? <p className="m-0 mb-1">{AUDIOBOOK_LINE}</p> : null}
              <button
                type="button"
                onClick={() => setMp3Whole((v) => !v)}
                className="cursor-pointer border-0 bg-transparent p-0 font-sans text-[12.5px] font-extrabold text-primary underline"
              >
                {mp3Whole ? 'Save as audiobook instead' : 'Save as MP3 instead'}
              </button>
            </div>
          ) : null}

          <div className="mt-3 mb-1 text-[12px] font-extrabold tracking-wide text-muted">
            File name
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              aria-label="File name"
              value={baseName}
              onChange={(e) => setTypedName(e.target.value)}
              className={`${field} min-w-0 flex-1`}
            />
            <span className="text-[13px] font-semibold text-muted">.{format}</span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
            <span>{`Voice: ${voiceName(snapshot.voice)} · ${Number(chosenSpeed.toFixed(2))}×`}</span>
            <span className="ml-auto">
              Saves to <b className="text-ink">{exportFolderLabel(folder)}</b>
            </span>
          </div>

          <div className="mt-[18px] flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-soft px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-soft-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={spoken.length === 0 || tooLong}
              onClick={save}
              className="btn-primary min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-on-primary disabled:cursor-default disabled:opacity-60"
            >
              ↓ Save audio
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
