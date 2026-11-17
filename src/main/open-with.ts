import { statSync } from 'fs'
import { resolve } from 'path'

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
        console.error('[tide] could not open a file passed to Tide:', err)
      }
    })
  }
}
