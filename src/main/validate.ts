// Argument checks shared by the IPC handlers.

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A string, optionally no longer than `max` characters. */
export const isStr = (v: unknown, max = Infinity): v is string =>
  typeof v === 'string' && v.length <= max

/** An id argument (a job id or generation): a string up to `max` characters, else a usage error. */
export function boundedId(channel: string, label: string, v: unknown, max = 64): string {
  if (!isStr(v, max)) {
    throw new Error(`${channel} expects (${label}: string up to ${max} characters)`)
  }
  return v
}
