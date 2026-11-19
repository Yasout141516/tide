import type { Priority } from './protocol'

const ORDER: Priority[] = ['live', 'preview', 'export']

/** Pending synthesis jobs: live before preview before export, FIFO within a priority. */
export class JobQueue<T extends { priority: Priority; gen: string }> {
  private readonly lanes: Record<Priority, T[]> = { live: [], preview: [], export: [] }

  push(job: T): void {
    this.lanes[job.priority].push(job)
  }

  next(): T | undefined {
    for (const p of ORDER) {
      const job = this.lanes[p].shift()
      if (job) return job
    }
    return undefined
  }

  /** Remove every queued job of a generation and return them. */
  cancel(gen: string): T[] {
    const removed: T[] = []
    for (const p of ORDER) {
      this.lanes[p] = this.lanes[p].filter((j) => (j.gen === gen ? (removed.push(j), false) : true))
    }
    return removed
  }

  get size(): number {
    return ORDER.reduce((n, p) => n + this.lanes[p].length, 0)
  }
}
