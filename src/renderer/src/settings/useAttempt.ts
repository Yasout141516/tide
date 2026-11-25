import { useToast } from '../shell/Toast'

const FAILED = "Couldn't change that setting. Please try again."

/** Failed library calls are told plainly; nothing is left as an unhandled rejection. */
export function useAttempt(): (p: Promise<unknown>, text?: string) => void {
  const toast = useToast()
  return (p, text = FAILED) => void p.catch(() => toast.show({ text }))
}
