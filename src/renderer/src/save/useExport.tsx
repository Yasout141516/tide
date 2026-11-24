import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ExportEvent, ExportFailure, ExportSpec } from '../../../shared/ipc-types'
import type { ReadingView } from '../../../shared/library/types'
import { tide } from '../lib/tide'
import { useLatest } from '../lib/useLatest'
import { useToast } from '../shell/Toast'
import { ExportProgress } from './ExportProgress'
import { SavePanel } from './SavePanel'

const BUSY = 'Tide is still making your last audio.'

const REASONS: Record<ExportFailure, string> = {
  'disk-full': 'your disk is full',
  'no-permission': "Tide isn't allowed to save there",
  'folder-missing': 'the folder is missing',
  failed: 'something went wrong'
}

type StartFn = (spec: ExportSpec, label: string, chooseFolder?: boolean) => Promise<void>

interface Job {
  id: string | null
  label: string
  percent: number
  spec: ExportSpec
}

interface ExportUi {
  /** Open the Save panel (on a selection's sentence range, or on the whole reading's options). */
  openPanel(range?: [number, number]): void
  /** The running job's card, shown above the player. */
  progress: ReactNode
}

// eslint-disable-next-line react-refresh/only-export-components -- tests supply a fake export UI
export const ExportUiContext = createContext<ExportUi>({ openPanel: () => {}, progress: null })
const Ctx = ExportUiContext

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useExportUi(): ExportUi {
  return useContext(Ctx)
}

/** Owns the Save panel and the one running export; renders the panel, hands out the progress card. */
export function ExportProvider({
  reading,
  courseName,
  children
}: {
  reading: ReadingView | null
  courseName: string | null
  children: ReactNode
}): React.JSX.Element {
  const toast = useToast()
  const [panel, setPanel] = useState<{ range: [number, number] | null } | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const jobRef = useRef<Job | null>(null)
  const set = useCallback((j: Job | null): void => {
    jobRef.current = j
    setJob(j)
  }, [])

  const toastRef = useLatest(toast)
  // The key of the last toast this provider showed, so starting a job removes only that one.
  const ownToast = useRef<number | null>(null)
  const showOwn = useCallback(
    (t: Parameters<typeof toast.show>[0]): void => {
      ownToast.current = toastRef.current.show(t)
    },
    [toastRef]
  )

  // showFailure's retry actions call the latest `start`, which is defined below it.
  const startRef = useRef<StartFn | null>(null)

  const showFailure = useCallback(
    (spec: ExportSpec, label: string, reason: ExportFailure): void => {
      const again = (folder: boolean) => (): void => void startRef.current?.(spec, label, folder)
      showOwn({
        text: `Couldn't save the audio: ${REASONS[reason]}.`,
        ms: Infinity,
        actions: [
          { label: 'Try again', onClick: again(false) },
          { label: 'Choose another folder', onClick: again(true) }
        ]
      })
    },
    [showOwn]
  )

  const start = useCallback<StartFn>(
    async (spec, label, chooseFolder = false) => {
      // A stale toast's action (or anything else) never overwrites a running job.
      if (jobRef.current) {
        showOwn({ text: BUSY })
        return
      }
      // A new job replaces what the last one left on screen (a sticky failure toast), nothing else.
      if (ownToast.current !== null) toast.dismiss(ownToast.current)
      // Busy from the moment of asking: the folder dialog and a quick event can both come first.
      set({ id: null, label, percent: 0, spec })
      // Events may replace the job across the awaits below, so read it afresh each time.
      const live = jobRef as { current: Job | null }
      let r
      try {
        r = await tide().export.start(spec, chooseFolder ? { chooseFolder: true } : undefined)
      } catch {
        if (live.current?.spec === spec) set(null)
        showFailure(spec, label, 'failed')
        return
      }
      if ('jobId' in r) {
        const cur = live.current
        if (cur && cur.spec === spec) set({ ...cur, id: cur.id ?? r.jobId })
        return
      }
      if (live.current?.spec === spec) set(null)
      if ('busy' in r) showOwn({ text: BUSY })
    },
    [set, toast, showFailure, showOwn]
  )
  useEffect(() => {
    startRef.current = start
  })

  useEffect(
    () =>
      tide().export.onEvent((e: ExportEvent) => {
        const cur = jobRef.current
        if (!cur || (cur.id !== null && cur.id !== e.jobId)) return
        const mine = { ...cur, id: e.jobId }
        if (e.kind === 'progress') {
          set({ ...mine, percent: e.total > 0 ? Math.round((e.done / e.total) * 100) : 0 })
          return
        }
        set(null)
        if (e.kind === 'saved') {
          showOwn({
            text: `✓ Saved “${e.fileName}”`,
            actions: [
              {
                label: tide().platform === 'darwin' ? 'Show in Finder' : 'Show in folder',
                onClick: () => void tide().export.reveal(e.jobId)
              }
            ]
          })
        } else if (e.kind === 'failed') showFailure(cur.spec, cur.label, e.reason)
        else showOwn({ text: 'Audio not saved.' })
      }),
    [set, showFailure, showOwn]
  )

  const busy = job !== null
  const ui = useMemo<ExportUi>(
    () => ({
      openPanel: (range) => {
        if (jobRef.current) showOwn({ text: BUSY })
        else setPanel({ range: range ?? null })
      },
      progress: job ? (
        <ExportProgress
          label={job.label}
          percent={job.percent}
          cancellable={job.id !== null}
          onCancel={() => {
            if (job.id) void tide().export.cancel(job.id)
          }}
        />
      ) : null
    }),
    [job, showOwn]
  )

  return (
    <Ctx.Provider value={ui}>
      {children}
      {panel && reading && !busy ? (
        <SavePanel
          reading={reading}
          courseName={courseName}
          range={panel.range}
          onCancel={() => setPanel(null)}
          onSave={(spec, label) => {
            setPanel(null)
            void start(spec, label)
          }}
        />
      ) : null}
    </Ctx.Provider>
  )
}

/** Where the running job's card sits (above the player). */
export function ExportProgressSlot(): React.JSX.Element {
  return <>{useContext(Ctx).progress}</>
}
