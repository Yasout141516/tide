import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LibrarySnapshot, ReadingView } from '../../../shared/library/types'
import type { BuildResult } from '../../../shared/text/pipeline'
import { anchorOf, resolveAnchor } from '../../../shared/text/anchor'
import { sentenceAt, spanRects, type Rect } from '../../../shared/text/highlight'
import type { PageText, ReadingFilters } from '../../../shared/text/types'
import { tide } from '../lib/tide'
import { leavesKeysAlone, usePlayer } from '../player/PlayerContext'
import { MessageDialog } from '../add/MessageDialog'
import { ChoiceDialog, ghostButton, primaryButton } from '../reading/ChoiceDialog'
import { FileMovedDialog } from '../reading/FileMovedDialog'
import { RemoveDialog } from '../reading/RemoveDialog'
import { useReaderDeps } from './deps'
import { filtersFor } from './filters'
import { BackToReading } from './BackToReading'
import { PasswordDialog } from './PasswordDialog'
import type { PdfDoc } from './pdf'
import { PdfPage } from './PdfPage'
import { useReaderState, useReportReader } from './ReaderState'
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
 * Mount with `key={reading.id}`: it holds one open PDF. When the file is found again from the File moved
 * dialog, the whole session is remounted, so a different file opens at the start and a relinked one at her place.
 */
export function ReaderView(props: Props): React.JSX.Element {
  const [run, setRun] = useState({ generation: 0, fresh: false })
  return (
    <ReaderSession
      key={run.generation}
      {...props}
      fresh={run.fresh}
      onReopen={(fresh) => setRun((r) => ({ generation: r.generation + 1, fresh }))}
    />
  )
}

function ReaderSession({
  reading,
  snapshot,
  onClose,
  fresh,
  onReopen
}: Props & {
  /** A different file was accepted: ignore the stored place. */
  fresh: boolean
  onReopen(fresh: boolean): void
}): React.JSX.Element {
  const deps = useReaderDeps()
  const report = useReportReader()
  const { current, setCurrent, sentences: reported } = useReaderState()
  const zoom = snapshot.settings.zoom

  // Where she resumes: read once, so later position writes never scroll the page.
  const [anchorPage] = useState(() => (fresh ? 1 : (reading.position?.page ?? 1)))
  const [open, setOpen] = useState<Open>({ kind: 'loading' })
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
  const followingRef = useRef(true)
  /** During a pause: has the line been out of view yet? Only then does coming back resume following. */
  const leftView = useRef(false)

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
  }, [reading.id, tryOpen])

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
    // The read line came back into view through her own scrolling: follow again.
    if (!followingRef.current) {
      if (!lineInView()) leftView.current = true
      else if (leftView.current) follow(true)
    }
  }
  useLayoutEffect(() => {
    if (lastZoom.current === zoom && lastWidth.current === colWidth) return
    lastZoom.current = zoom
    lastWidth.current = colWidth
    const el = scroller.current
    if (el && scrolled.current) el.scrollTop = place.current * el.scrollHeight
  }, [zoom, colWidth])

  // --- Text: the page of her place is drawn first, then every page's text -------------------
  const anchorRef = useRef(anchor)
  useEffect(() => {
    anchorRef.current = anchor
  })
  const settle = useCallback((n: number) => {
    if (n === anchorRef.current) setAnchorDone(true)
  }, [])

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
    const ctl = new AbortController()
    deps
      .buildSentences(pages, filters, ctl.signal)
      .then((r) => {
        if (!stale) setBuilt(r)
      })
      .catch(() => {
        if (!stale) setTextFailed(true)
      })
    return () => {
      stale = true
      // Stop the superseded worker, not just ignore its answer.
      ctl.abort()
    }
  }, [pages, filters, deps])

  // --- Tell the rest of the reading area -----------------------------------------------------
  const sentences = built?.sentences
  useEffect(() => {
    report({ sentences: sentences ?? [], topPage, numPages: doc?.numPages ?? null })
  }, [report, sentences, topPage, doc])
  useEffect(() => () => report({ sentences: [], topPage: 1, numPages: null }), [report])

  // --- Current sentence: resume, stepping, saving her place -----------------------------------
  const [startAnchor] = useState(() => (fresh ? null : reading.position))
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  })
  const prevSentences = useRef<typeof sentences>(undefined)
  const firstBuild = useRef(true)
  /** The index whose anchor is already stored; -1 forces a write. */
  const saved = useRef<number | null>(null)
  /** The index to centre on opening; dropped once she moves elsewhere. */
  const jump = useRef<number | null>(null)

  useEffect(() => {
    if (!built) return
    const next = built.sentences
    const old = prevSentences.current?.[currentRef.current ?? -1]
    prevSentences.current = next
    if (next.length === 0) return setCurrent(null)
    let idx: number
    if (firstBuild.current) {
      firstBuild.current = false
      idx = startAnchor ? resolveAnchor(next, startAnchor) : 0
      saved.current = idx // where she already was: nothing to write
      jump.current = idx
    } else {
      idx = old ? resolveAnchor(next, anchorOf(old)) : 0
      saved.current = idx
      // The list changed under her: store the re-resolved place (never a stale index into the new list).
      void tide()
        .library.update(reading.id, { position: anchorOf(next[idx]) })
        .catch(() => {})
    }
    setCurrent(idx)
  }, [built, setCurrent, startAnchor, reading.id])
  useEffect(() => () => setCurrent(null), [setCurrent])

  // Every change is sent at once; main debounces the disk writes and flushes on quit.
  useEffect(() => {
    const s = current === null ? undefined : sentences?.[current]
    if (current === null || !s || saved.current === current) return
    saved.current = current
    void tide()
      .library.update(reading.id, { position: anchorOf(s) })
      .catch(() => {})
    // Only a change of `current` writes; a rebuilt list writes its own re-resolved anchor above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reading.id])

  const itemOf = useCallback(
    (p: number, i: number) => pages?.[p - 1]?.items.find((t) => t.index === i),
    [pages]
  )
  const sizeOf = useCallback(
    (p: number) => ({ width: pages?.[p - 1]?.width ?? 0, height: pages?.[p - 1]?.height ?? 0 }),
    [pages]
  )
  const currentRects = useMemo(
    () =>
      // `reported` lags a rebuilt list by one render; until it catches up `current` is stale.
      sentences && reported === sentences && pages && current !== null && sentences[current]
        ? spanRects(sentences[current].spans, itemOf, sizeOf)
        : [],
    [sentences, reported, pages, current, itemOf, sizeOf]
  )

  // --- Following ------------------------------------------------------------------------------
  // The page follows the read line instantly. Her own scrolling (wheel, touch, scroll keys, the
  // scrollbar) pauses that and shows "Back to reading". Tide's own scrollIntoView never counts: it
  // fires `scroll`, which only ever resumes following, and the pause signals above are not `scroll`.
  const [following, setFollowing] = useState(true)
  const noteLeft = useCallback(() => {
    leftView.current = true
  }, [])
  const follow = useCallback((on: boolean) => {
    followingRef.current = on
    leftView.current = false
    setFollowing(on)
  }, [])
  const phase = usePlayer().snapshot.phase

  const lineEl = (): Element | null =>
    scroller.current?.querySelector('[data-testid="sentence-highlight"]') ?? null
  /** The line's vertical centre as a fraction of the stage, or null when it cannot be measured. */
  const lineBox = (): { r: DOMRect; s: DOMRect } | null => {
    const root = scroller.current
    const el = lineEl()
    return root && el ? { r: el.getBoundingClientRect(), s: root.getBoundingClientRect() } : null
  }
  const lineInView = (): boolean => {
    const b = lineBox()
    return !!b && b.r.top >= b.s.top && b.r.bottom <= b.s.bottom
  }
  /** Instant, never smooth: the read line to the middle of the stage. */
  const centreLine = (): void => {
    lineEl()?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }

  useEffect(() => {
    const pause = (): void => {
      if (followingRef.current) follow(false)
    }
    const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])
    const onKey = (e: KeyboardEvent): void => {
      if (SCROLL_KEYS.has(e.key) && !leavesKeysAlone(e, '')) pause()
    }
    const el = scroller.current
    document.addEventListener('keydown', onKey)
    el?.addEventListener('wheel', pause, { passive: true })
    el?.addEventListener('touchmove', pause, { passive: true })
    const onDown = (e: PointerEvent): void => {
      // A press on the scroller itself (not on a page) is the scrollbar; the middle button autoscrolls.
      if (e.target === el || e.button === 1) pause()
    }
    el?.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      el?.removeEventListener('wheel', pause)
      el?.removeEventListener('touchmove', pause)
      el?.removeEventListener('pointerdown', onDown)
    }
  }, [follow])

  // Every change of the current sentence: centre it unless it already sits in the middle third.
  useEffect(() => {
    if (jump.current !== null && current !== null && jump.current !== current) jump.current = null
    const b = lineBox()
    if (!b) return
    const force = jump.current !== null
    jump.current = null
    if (!force && !followingRef.current) {
      // Playback moved on while she is away: the line leaving view counts as out of view.
      if (b.r.top < b.s.top || b.r.bottom > b.s.bottom) noteLeft()
      return
    }
    const third = (b.s.bottom - b.s.top) / 3
    const mid = (b.r.top + b.r.bottom) / 2
    if (!force && mid >= b.s.top + third && mid <= b.s.bottom - third) return
    centreLine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRects])

  // Play after a pause: back to the line.
  const lastPhase = useRef(phase)
  useEffect(() => {
    const was = lastPhase.current
    lastPhase.current = phase
    if (phase !== 'playing' || was === 'playing' || followingRef.current) return
    follow(true)
    centreLine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, follow])

  const backToReading = (): void => {
    follow(true)
    centreLine()
  }
  const currentPage = current !== null ? sentences?.[current]?.spans[0].page : undefined
  const showPill = !following && currentRects.length > 0 && currentPage !== undefined

  const pickNow = (n: number, x: number, y: number): void => {
    if (!sentences) return
    const bySentence: Rect[][] = sentences.map((s) =>
      s.spans.some((sp) => sp.page === n) ? spanRects(s.spans, itemOf, sizeOf) : []
    )
    const hit = sentenceAt(bySentence, n, x, y)
    if (hit !== null) setCurrent(hit)
  }
  // Test-only (TIDE_E2E exposes window.tideTest): where a click picks sentence i, as fractions of its
  // page, so Playwright can click a chosen sentence instead of searching for one.
  useEffect(() => {
    if (!window.tideTest || !sentences) return
    const w = window as unknown as { __tideSentenceCentre?: (i: number) => unknown }
    w.__tideSentenceCentre = (i) => {
      const s = sentences[i]
      const r = s ? spanRects(s.spans, itemOf, sizeOf)[0] : undefined
      const size = r ? sizeOf(r.page) : null
      return r && size?.width && size.height
        ? { page: r.page, fx: (r.x + r.w / 2) / size.width, fy: (r.y + r.h / 2) / size.height }
        : null
    }
    return () => {
      delete w.__tideSentenceCentre
    }
  }, [sentences, itemOf, sizeOf])
  // Pages are memoised: a stable handler that reads the latest closure.
  const pickRef = useRef(pickNow)
  useEffect(() => {
    pickRef.current = pickNow
  })
  const pick = useCallback((n: number, x: number, y: number) => pickRef.current(n, x, y), [])

  // The highlight each page gets: a page whose highlight did not change keeps the same value.
  const highlights = useMemo(() => {
    const m = new Map<number, { rects: Rect[]; sentenceId: number }>()
    if (current === null) return m
    for (const r of currentRects) {
      const h = m.get(r.page)
      if (h) h.rects.push(r)
      else m.set(r.page, { rects: [r], sentenceId: current })
    }
    return m
  }, [currentRects, current])

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
        onDone={(opened, isFresh) => {
          if (!opened) return onClose()
          onReopen(isFresh === true)
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
          tryOpen(data, pw, () => !alive.current)
            .catch(() => {
              if (alive.current) setOpen({ kind: 'damaged' })
            })
            .finally(() => {
              opening.current = false
            })
        }}
      />
    )

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        onScroll={onScroll}
        // Test-only (TIDE_E2E exposes window.tideTest): lets Playwright see that the worker built sentences.
        data-sentence-count={window.tideTest && built ? built.sentences.length : undefined}
        className="relative h-full overflow-y-auto"
      >
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
                  onPick={pick}
                  highlight={highlights.get(n)}
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
      {showPill ? <BackToReading page={currentPage} onClick={backToReading} /> : null}
    </div>
  )
}
