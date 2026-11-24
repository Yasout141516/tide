// One AbortError convention: cancellation is recognised by `name`, never by message text.

/** An Error whose `name` is 'AbortError'. */
export function makeAbortError(message = 'aborted'): Error {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}
