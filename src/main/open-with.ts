import { statSync } from 'fs'
import { logError } from './log'
import { resolve } from 'path'
import type { AppCommand } from '../shared/ipc-types'
import type { PickResult } from '../shared/library/types'

/** PDF files named on a command line: existing files ending in .pdf, never flags, the exe or the main script. */
export function filesFromArgv(argv: string[], cwd: string): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (arg.startsWith('-') || !/\.pdf$/i.test(arg)) continue
    const path = resolve(cwd, arg)
    try {
      if (statSync(path).isFile()) out.push(path)
    } catch {
      // Not there: skip it.
    }
  }
  return out
}

/** Paths that arrive before the library is ready are held, then handled one at a time, in order. */
export class OpenWithQueue {
  private waiting: string[] = []
  private handle: ((path: string) => Promise<void>) | null = null
  private chain: Promise<void> = Promise.resolve()

  push(path: string): void {
    if (this.handle) this.run(path)
    else this.waiting.push(path)
  }

  attach(handle: (path: string) => Promise<void>): void {
    this.handle = handle
    for (const p of this.waiting.splice(0)) this.run(p)
  }

  private run(path: string): void {
    this.chain = this.chain.then(async () => {
      try {
        await this.handle?.(path)
      } catch (err) {
        logError('could not open a file passed to Tide', err)
      }
    })
  }
}

/** Handles one file handed to Tide by the OS: pick it, then tell the renderer (a failure names no path). */
export function openWithHandler(o: {
  pick: (path: string) => Promise<Exclude<PickResult, { kind: 'cancelled' }>>
  send: (cmd: AppCommand) => void
  show: () => void
}): (path: string) => Promise<void> {
  return async (path) => {
    try {
      const pick = await o.pick(path)
      o.show()
      o.send({ type: 'open-pick', pick })
    } catch (err) {
      logError('could not open a file passed to Tide', err)
      o.show()
      o.send({ type: 'open-failed' })
    }
  }
}
