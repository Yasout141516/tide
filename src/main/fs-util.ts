import { access } from 'node:fs/promises'

/** Whether `p` exists (any failure to reach it counts as missing). */
export const pathExists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )
