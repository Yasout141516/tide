import { buildSentences } from '../../../shared/text/pipeline'
import type { PageText, ReadingFilters } from '../../../shared/text/types'

export interface WorkerRequest {
  id: number
  pages: PageText[]
  filters: ReadingFilters
}

self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const { id, pages, filters } = e.data
  try {
    self.postMessage({ id, ok: true, result: buildSentences(pages, filters) })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) })
  }
}
