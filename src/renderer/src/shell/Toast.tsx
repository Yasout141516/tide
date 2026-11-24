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

export interface ToastSpec {
  text: string
  actions?: { label: string; onClick(): void }[]
  /** How long it stays; default 6 s. Infinity keeps it until an action is clicked. */
  ms?: number
}

interface ToastApi {
  show(t: ToastSpec): void
  /** Remove whatever toast is showing. */
  dismiss(): void
}

const NONE: ToastApi = { show: () => {}, dismiss: () => {} }
const ToastCtx = createContext<ToastApi>(NONE)

const actionButton =
  'min-h-9 cursor-pointer rounded-[10px] border-0 bg-transparent px-3 font-sans text-[13px] font-extrabold text-on-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary'

/** Shows one toast at a time, bottom-centre above the player. */
export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toast, setToast] = useState<(ToastSpec & { key: number }) | null>(null)
  const counter = useRef(0)
  const show = useCallback((t: ToastSpec): void => {
    setToast((prev) => {
      // The same message is not announced twice; a sticky one is never pushed aside by a passing one.
      if (prev && prev.text === t.text) return prev
      if (prev && prev.ms === Infinity && t.ms !== Infinity) return prev
      counter.current = Math.max(counter.current, prev?.key ?? 0) + 1
      return { ...t, key: counter.current }
    })
  }, [])
  const dismiss = useCallback((): void => setToast(null), [])
  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  const key = toast?.key
  const ms = toast?.ms ?? 6000
  useEffect(() => {
    if (key === undefined || !Number.isFinite(ms)) return
    const id = setTimeout(() => setToast(null), ms)
    return () => clearTimeout(id)
  }, [key, ms])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
      >
        {toast ? (
          <div
            key={toast.key}
            className="toast-in pointer-events-auto flex items-center gap-3.5 rounded-[14px] bg-bubble py-2.5 pr-3 pl-4 text-[13.5px] font-bold text-bg shadow-[0_12px_30px_var(--shadow)]"
          >
            <span>{toast.text}</span>
            {toast.actions?.map((a) => (
              <button
                key={a.label}
                type="button"
                className={actionButton}
                onClick={() => {
                  setToast(null)
                  a.onClick()
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </ToastCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useToast(): ToastApi {
  return useContext(ToastCtx)
}
