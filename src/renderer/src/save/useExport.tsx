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

const Ctx = createContext<ExportUi>({ openPanel: () => {}, progress: null })

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

  const start = useCallback(
    async (spec: ExportSpec, label: string, chooseFolder = false): Promise<void> => {
      // Busy from the moment of asking: the folder dialog and a quick event can both come first.
      set({ id: null, label, percent: 0, spec })
      let r
      try {
        r = await tide().export.start(spec, chooseFolder ? { chooseFolder: true } : undefined)
      } catch {
        r = { busy: true as const }
      }
      if ('jobId' in r) {
        const cur = jobRef.current
        if (cur && cur.spec === spec) set({ ...cur, id: cur.id ?? r.jobId })
        return
      }
      if (jobRef.current?.spec === spec) set(null)
      if ('busy' in r) toast.show({ text: BUSY })
    },
    [set, toast]
  )
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
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
        const t = toastRef.current
        if (e.kind === 'saved') {
          t.show({
            text: `✓ Saved “${e.fileName}”`,
            actions: [
              {
                label: tide().platform === 'darwin' ? 'Show in Finder' : 'Show in folder',
                onClick: () => void tide().export.reveal(e.jobId)
              }
            ]
          })
        } else if (e.kind === 'failed') {
          const again = (folder: boolean) => (): void =>
            void startRef.current(cur.spec, cur.label, folder)
          t.show({
            text: `Couldn't save the audio: ${REASONS[e.reason]}.`,
            ms: Infinity,
            actions: [
              { label: 'Try again', onClick: again(false) },
              { label: 'Choose another folder', onClick: again(true) }
            ]
          })
        } else t.show({ text: 'Audio not saved.' })
      }),
    [set]
  )

  const busy = job !== null
  const ui = useMemo<ExportUi>(
    () => ({
      openPanel: (range) => {
        if (jobRef.current) toastRef.current.show({ text: BUSY })
        else setPanel({ range: range ?? null })
      },
      progress: job ? (
        <ExportProgress
          label={job.label}
          percent={job.percent}
          onCancel={() => {
            if (job.id) void tide().export.cancel(job.id)
          }}
        />
      ) : null
    }),
    [job]
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
