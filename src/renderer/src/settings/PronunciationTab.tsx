import { useEffect, useRef, useState } from 'react'
import { DEFAULT_VOICE } from '../../../shared/voices'
import { PRONUNCIATION_LIMITS, type Pronunciation } from '../../../shared/library/types'
import { useLibrary } from '../state/useLibrary'
import { tide } from '../lib/tide'
import { usePlayerActions } from '../player/PlayerContext'
import { useToast } from '../shell/Toast'
import { useAttempt } from './useAttempt'

type Row = { key: number; word: string; sayAs: string }

const button =
  'min-h-9 min-w-9 cursor-pointer rounded-[11px] border-0 bg-soft px-[11px] py-[5px] font-sans text-[13px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-50'
const field =
  'min-h-9 min-w-0 rounded-[9px] border border-border bg-surface px-2.5 py-[5px] font-sans text-[13px] text-ink'

/** Only complete rows are sent; an unfinished one stays a draft on screen. */
const complete = (rows: Row[]): Pronunciation[] =>
  rows
    .filter((r) => r.word.trim() !== '' && r.sayAs.trim() !== '')
    .map((r) => ({ word: r.word, sayAs: r.sayAs }))

export function PronunciationTab(): React.JSX.Element {
  const library = useLibrary()
  const toast = useToast()
  const attempt = useAttempt()
  const { previewClip, stopPreview } = usePlayerActions()
  const voice = library?.settings.voice ?? DEFAULT_VOICE
  /** Counts Listen presses; a clip that is not from the latest press (or arrives after leaving) is dropped. */
  const listenId = useRef(0)
  // Local rows, seeded once: a snapshot that arrives while she types never overwrites them.
  const [rows, setRows] = useState<Row[]>(() =>
    (library?.settings.pronunciations ?? []).map((p, i) => ({
      key: i,
      word: p.word,
      sayAs: p.sayAs
    }))
  )
  // New rows count on from the seeded ones (keys only need to be unique within the tab).
  const nextKey = useRef(rows.length)
  const focusKey = useRef<number | null>(null)
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const L = PRONUNCIATION_LIMITS

  // Leaving the tab (or the dialog) stops a clip that is still playing.
  useEffect(
    () => () => {
      listenId.current = -1
      stopPreview()
    },
    [stopPreview]
  )
  useEffect(() => {
    if (focusKey.current === null) return
    inputs.current.get(focusKey.current)?.focus()
    focusKey.current = null
  }, [rows.length])

  const rowsRef = useRef(rows)
  /** The complete rows last sent (or seeded), so closing only saves what changed. */
  const saved = useRef(JSON.stringify(complete(rows)))
  const save = (next: Row[]): void => {
    const list = complete(next)
    saved.current = JSON.stringify(list)
    attempt(tide().library.setPronunciations(list), "Couldn't save that word. Please try again.")
  }
  const saveRef = useRef(save)
  useEffect(() => {
    rowsRef.current = rows
    saveRef.current = save
  })
  // Escape or a click outside closes Settings without a blur: save what she typed on the way out.
  useEffect(
    () => () => {
      if (JSON.stringify(complete(rowsRef.current)) !== saved.current) {
        saveRef.current(rowsRef.current)
      }
    },
    []
  )
  const edit = (key: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const listen = (sayAs: string): void => {
    const id = ++listenId.current
    tide()
      .tts.synthesize(sayAs.trim(), { voice, speed: 1, priority: 'preview' })
      .then((clip) => {
        if (listenId.current === id) previewClip(clip)
      })
      .catch(() => {
        if (listenId.current === id) toast.show({ text: "Couldn't play that. Please try again." })
      })
  }

  return (
    <section aria-labelledby="pron-heading">
      <h4 id="pron-heading" className="m-0 mb-1.5 font-display text-[19px] font-bold">
        Pronunciation
      </h4>
      <p className="m-0 mb-3 text-[13px] text-muted">
        For words the voice gets wrong. Type how it should sound, then Listen to check.
      </p>
      {rows.map((r) => (
        <div
          key={r.key}
          className="mb-1.5 flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-bg px-2.5 py-2 text-[13px]"
        >
          <input
            ref={(el) => {
              if (el) inputs.current.set(r.key, el)
              else inputs.current.delete(r.key)
            }}
            aria-label="Word"
            className={`${field} w-[130px] font-bold`}
            maxLength={L.wordLen}
            value={r.word}
            onChange={(e) => edit(r.key, { word: e.target.value })}
            onBlur={() => save(rows)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(rows)
            }}
          />
          <span>says</span>
          <input
            aria-label="Sounds like"
            className={`${field} min-w-[140px] flex-1 font-extrabold text-primary`}
            maxLength={L.sayAsLen}
            value={r.sayAs}
            onChange={(e) => edit(r.key, { sayAs: e.target.value })}
            onBlur={() => save(rows)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(rows)
            }}
          />
          <button
            type="button"
            className={button}
            aria-label={r.word.trim() ? `Listen to ${r.word.trim()}` : 'Listen'}
            disabled={r.sayAs.trim() === ''}
            onClick={() => listen(r.sayAs)}
          >
            ▶ Listen
          </button>
          <button
            type="button"
            className={button}
            aria-label={r.word.trim() ? `Remove ${r.word.trim()}` : 'Remove'}
            onClick={() => {
              const next = rows.filter((x) => x.key !== r.key)
              setRows(next)
              save(next)
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`${button} mt-1.5`}
        disabled={rows.length >= L.words}
        onClick={() => {
          const key = nextKey.current++
          focusKey.current = key
          setRows((rs) => [...rs, { key, word: '', sayAs: '' }])
        }}
      >
        ＋ Add a word
      </button>
      {rows.length >= L.words ? (
        <p className="mt-2.5 mb-0 text-xs text-muted">That&apos;s the most Tide can keep.</p>
      ) : null}
    </section>
  )
}
