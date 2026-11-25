import { useToast } from '../shell/Toast'

/** Failed library calls are told plainly; nothing is left as an unhandled rejection. */
export function useAttempt(): (p: Promise<unknown>, text: string) => void {
  const toast = useToast()
  return (p, text) => void p.catch(() => toast.show({ text }))
}
