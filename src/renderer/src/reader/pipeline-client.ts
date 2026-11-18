import type { BuildResult } from '../../../shared/text/pipeline'
import type { PageText, ReadingFilters } from '../../../shared/text/types'
import type { WorkerRequest } from './pipeline.worker'

let nextId = 1

/**
 * Runs the text pipeline in a Web Worker so a long reading never freezes the page. One worker per call,
 * terminated afterwards; a reply that does not carry this call's request id is ignored.
 */
export function buildSentencesInWorker(
  pages: PageText[],
  filters: ReadingFilters
): Promise<BuildResult> {
  const worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  return new Promise<BuildResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent): void => {
      if (e.data?.id !== id) return
      worker.terminate()
      if (e.data.ok) resolve(e.data.result as BuildResult)
      else reject(new Error(String(e.data.error)))
    }
    worker.onerror = (e): void => {
      worker.terminate()
      reject(new Error(e.message || 'the text worker failed'))
    }
    const req: WorkerRequest = { id, pages, filters }
    worker.postMessage(req)
  })
}
