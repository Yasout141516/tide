import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LibrarySnapshot, ReadingView } from '../../../shared/library/types'
import type { BuildResult } from '../../../shared/text/pipeline'
import type { PageText, ReadingFilters } from '../../../shared/text/types'
import { tide } from '../lib/tide'
import { MessageDialog } from '../add/MessageDialog'
import { ChoiceDialog, ghostButton, primaryButton } from '../reading/ChoiceDialog'
import { FileMovedDialog } from '../reading/FileMovedDialog'
import { RemoveDialog } from '../reading/RemoveDialog'
import { useReaderDeps } from './deps'
import { filtersFor } from './filters'
import { PasswordDialog } from './PasswordDialog'
import type { PdfDoc } from './pdf'
import { PdfPage } from './PdfPage'
import { useReportReader } from './ReaderState'
import { renderWindow } from './renderWindow'

type Props = {
  reading: ReadingView
  snapshot: LibrarySnapshot
  /** Back to the empty stage (Keep, Cancel, or a reading that went away). */
  onClose(): void
}

type Open =
  | { kind: 'loading' }
  | { kind: 'moved' }
  | { kind: 'damaged' }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'ready'; doc: PdfDoc }

type Size = { width: number; height: number }

const GUTTER = 28
const MAX_PAGE_WIDTH = 820
/** Used until the stage has been measured (and in jsdom, which has no layout). */
const FALLBACK_STAGE_WIDTH = MAX_PAGE_WIDTH + 2 * GUTTER

const noticeCard =
  'sticky top-2 z-10 mx-auto my-2 flex max-w-[460px] flex-col items-center gap-2 rounded-2xl bg-surface p-4 text-center text-[14px] font-semibold text-ink shadow-[0_8px_24px_var(--shadow)]'

/**
 * The reading's pages (lazy canvases), its text (pipeline in a worker) and the states around them.
 * Mount with `key={reading.id}`: it holds one open PDF.
 */
export function ReaderView({ reading, snapshot, onClose }: Props): React.JSX.Element {
  const deps = useReaderDeps()
  const report = useReportReader()
  const zoom = snapshot.settings.zoom

  // Where she resumes: read once, so later position writes never scroll the page.
  const [anchorPage] = useState(() => reading.position?.page ?? 1)
  const [open, setOpen] = useState<Open>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const bytes = useRef<Uint8Array | null>(null)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [stageWidth, setStageWidth] = useState(0)
  // Bumped on each wrong password, so the dialog starts with an empty field again.
  const [wrongCount, setWrongCount] = useState(0)
  const alive = useRef(true)
  const opening = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [range, setRange] = useState<[number, number] | null>(null)
  const [topPage, setTopPage] = useState(anchorPage)
  const [anchorDone, setAnchorDone] = useState(false)
  const [pages, setPages] = useState<PageText[] | null>(null)
  const [built, setBuilt] = useState<BuildResult | null>(null)
  const [textFailed, setTextFailed] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // --- Open the PDF -------------------------------------------------------------------------
  const tryOpen = useCallback(
    async (data: Uint8Array, password: string | undefined, cancelled: () => boolean) => {
      const r = await deps.openPdf(data, password)
      if (cancelled()) {
        if (r.kind === 'ok') void r.doc.destroy()
        return
      }
      if (r.kind === 'ok') setOpen({ kind: 'ready', doc: r.doc })
      else if (r.kind === 'damaged') setOpen({ kind: 'damaged' })
      else {
        if (r.kind === 'wrong-password') setWrongCount((c) => c + 1)
        setOpen({ kind: 'password', wrong: r.kind === 'wrong-password' })
      }
    },
    [deps]
  )

  useEffect(() => {
    let dead = false
    const cancelled = (): boolean => dead
    tide()
      .library.readPdf({ readingId: reading.id })
      .then(async (r) => {
        if (dead) return
        if (!r.ok) return setOpen({ kind: r.reason === 'missing' ? 'moved' : 'damaged' })
        bytes.current = r.data
        await tryOpen(r.data, undefined, cancelled)
      })
      .catch(() => {
        if (!dead) setOpen({ kind: 'damaged' })
      })
    return () => {
      dead = true
    }
  }, [reading.id, attempt, tryOpen])

  const doc = open.kind === 'ready' ? open.doc : null
  useEffect(() => {
    if (!doc) return
    return () => void doc.destroy()
  }, [doc])

  // The reading's page count, once the file says something different.
  useEffect(() => {
    if (doc && doc.numPages !== reading.pageCount)
      void tide()
        .library.update(reading.id, { pageCount: doc.numPages })
        .catch(() => {})
    // Only when a (new) document opens: a later pageCount from the snapshot must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // --- Page sizes ---------------------------------------------------------------------------
  useEffect(() => {
    if (!doc) return
    let dead = false
    Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.pageSize(i + 1)))
      .then((s) => {
        if (!dead) setSizes(s)
      })
      .catch(() => {
        if (!dead) setOpen({ kind: 'damaged' })
      })
    return () => {
      dead = true
    }
  }, [doc])

  // --- Stage width --------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = (): void => setStageWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const colWidth = Math.min((stageWidth || FALLBACK_STAGE_WIDTH) - 2 * GUTTER, MAX_PAGE_WIDTH)
  const total = doc?.numPages ?? 0
  const anchor = Math.min(Math.max(anchorPage, 1), Math.max(total, 1))

  // --- Scroll to her place, once the pages have a size --------------------------------------
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (!sizes || scrolled.current) return
    scrolled.current = true
    scroller.current?.querySelector(`[data-page="${anchor}"]`)?.scrollIntoView({ block: 'start' })
    // The render window starts around her place.
    setRange([anchor, anchor])
    setTopPage(anchor)
  }, [sizes, anchor])

  // --- Which pages are visible ---------------------------------------------------------------
  useEffect(() => {
    const root = scroller.current
    if (!sizes || !root || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          if (e.isIntersecting) visible.add(n)
          else visible.delete(n)
        }
        if (visible.size === 0) return
        const nums = [...visible]
        const first = Math.min(...nums)
        const last = Math.max(...nums)
        setRange((r) => (r && r[0] === first && r[1] === last ? r : [first, last]))
        setTopPage(first)
      },
      { root }
    )
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [sizes])

  // --- Text size: keep her place when the pages re-scale ------------------------------------
  const place = useRef(0)
  const lastZoom = useRef(zoom)
  const lastWidth = useRef(colWidth)
  const onScroll = (): void => {
    const el = scroller.current
    if (el && el.scrollHeight > 0) place.current = el.scrollTop / el.scrollHeight
  }
  useLayoutEffect(() => {
    if (lastZoom.current === zoom && lastWidth.current === colWidth) return
    lastZoom.current = zoom
    lastWidth.current = colWidth
    const el = scroller.current
    if (el && scrolled.current) el.scrollTop = place.current * el.scrollHeight
  }, [zoom, colWidth])

  // --- Text: the page of her place is drawn first, then every page's text -------------------
  const settle = useCallback(
    (n: number) => {
      if (n === anchor) setAnchorDone(true)
    },
    [anchor]
  )

  useEffect(() => {
    if (!doc || !anchorDone) return
    let dead = false
    ;(async () => {
      const out: PageText[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        out.push(await doc.pageText(n))
        if (dead) return
      }
      setPages(out)
    })().catch(() => {
      if (!dead) setTextFailed(true)
    })
    return () => {
      dead = true
    }
  }, [doc, anchorDone])

  // Only this step reruns when the filters change (Read everything): the extracted pages are kept.
  const filtersKey = JSON.stringify(filtersFor(snapshot.settings, reading.readEverything))
  const filters = useMemo(() => JSON.parse(filtersKey) as ReadingFilters, [filtersKey])
  useEffect(() => {
    if (!pages) return
    let stale = false
    deps
      .buildSentences(pages, filters)
      .then((r) => {
        if (!stale) setBuilt(r)
      })
      .catch(() => {
        if (!stale) setTextFailed(true)
      })
    return () => {
      stale = true
    }
  }, [pages, filters, deps])

  // --- Tell the rest of the reading area -----------------------------------------------------
  const sentences = built?.sentences
  useEffect(() => {
    report({ sentences: sentences ?? [], topPage, numPages: doc?.numPages ?? null })
  }, [report, sentences, topPage, doc])
  useEffect(() => () => report({ sentences: [], topPage: 1, numPages: null }), [report])

  // --- Render -------------------------------------------------------------------------------
  const textless = useMemo(() => new Set(built?.textlessPages ?? []), [built])
  const active = useMemo(
    () => new Set(doc && range ? renderWindow(range[0], range[1], total) : []),
    [doc, range, total]
  )

  const removeReading = (): void => {
    setRemoving(false)
    tide()
      .library.remove(reading.id)
      .catch(() => setNotice("Tide couldn't remove that reading."))
  }

  let message: React.JSX.Element | null = null
  if (built && total > 0 && textless.size === total)
    message = (
      <div role="status" className={noticeCard}>
        <span>Tide couldn&apos;t find any text in this PDF. It may be a scanned copy.</span>
        <button type="button" onClick={() => setRemoving(true)} className={ghostButton}>
          Remove from shelf
        </button>
      </div>
    )
  else if (built && built.sentences.length === 0)
    message = (
      <div role="status" className={noticeCard}>
        <span>Tide skipped everything in this reading.</span>
        {reading.readEverything ? null : (
          <button
            type="button"
            className={primaryButton}
            onClick={() => void tide().library.update(reading.id, { readEverything: true })}
          >
            Read everything
          </button>
        )}
      </div>
    )
  else if (textFailed)
    message = (
      <div role="status" className={noticeCard}>
        Tide couldn&apos;t prepare the text of this reading.
      </div>
    )

  let dialog: React.JSX.Element | null = null
  if (open.kind === 'moved')
    dialog = (
      <FileMovedDialog
        reading={reading}
        onDone={(opened) => {
          if (!opened) return onClose()
          setOpen({ kind: 'loading' })
          setAttempt((a) => a + 1)
        }}
      />
    )
  else if (open.kind === 'damaged')
    dialog = (
      <ChoiceDialog
        title="Tide can't open this PDF. It may be damaged."
        onDismiss={onClose}
        actions={
          <>
            <button type="button" onClick={onClose} className={ghostButton}>
              Keep
            </button>
            <button type="button" onClick={() => setRemoving(true)} className={primaryButton}>
              Remove from shelf
            </button>
          </>
        }
      />
    )
  else if (open.kind === 'password')
    dialog = (
      <PasswordDialog
        key={wrongCount}
        wrong={open.wrong}
        onCancel={onClose}
        onOpen={(pw) => {
          const data = bytes.current
          if (!data || opening.current) return
          opening.current = true
          void tryOpen(data, pw, () => !alive.current).finally(() => {
            opening.current = false
          })
        }}
      />
    )

  return (
    <div ref={scroller} onScroll={onScroll} className="relative h-full overflow-y-auto">
      {message}
      {doc && sizes ? (
        <div className="flex w-max min-w-full flex-col items-center gap-4 px-7 py-4">
          {sizes.map((s, i) => {
            const n = i + 1
            // Each page fills the column; its own width sets its scale.
            const scale = (colWidth * zoom) / s.width
            return (
              <PdfPage
                key={n}
                doc={doc}
                n={n}
                width={s.width * scale}
                height={s.height * scale}
                scale={scale}
                active={active.has(n)}
                textless={textless.has(n)}
                onSettled={settle}
              />
            )
          })}
        </div>
      ) : null}
      {removing ? (
        <RemoveDialog
          title={reading.title}
          onKeep={() => setRemoving(false)}
          onRemove={removeReading}
        />
      ) : (
        dialog
      )}
      {notice ? <MessageDialog title={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  )
}
