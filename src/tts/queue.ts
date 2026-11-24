import type { Priority } from './protocol'

const ORDER: Priority[] = ['live', 'preview', 'export']

/** Pending synthesis jobs: live before preview before export, FIFO within a priority. */
export class JobQueue<T extends { priority: Priority; gen: string }> {
  private readonly lanes: Record<Priority, T[]> = { live: [], preview: [], export: [] }

  push(job: T): void {
    this.lanes[job.priority].push(job)
  }

  /**
   * Queue ahead of the jobs already waiting at this priority, but behind earlier jobs of the same
   * generation waiting at the head: the clips of one sentence run in the order they were sent,
   * while a later generation still goes ahead of an earlier one's leftovers.
   */
  pushFront(job: T): void {
    const lane = this.lanes[job.priority]
    let at = 0
    while (at < lane.length && lane[at].gen === job.gen) at += 1
    lane.splice(at, 0, job)
  }

  next(): T | undefined {
    for (const p of ORDER) {
      const job = this.lanes[p].shift()
      if (job) return job
    }
    return undefined
  }

  /** The next job of a priority strictly above `priority`, if one is waiting (live > preview > export). */
  nextAbove(priority: Priority): T | undefined {
    for (const p of ORDER) {
      if (p === priority) return undefined
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
