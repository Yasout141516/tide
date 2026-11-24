import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  RenderingCancelledException
} from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pageTextFromContent, type RawTextItem } from '../../../shared/text/page-text'
import { classifyPdfError, type PdfOpenFailure } from '../../../shared/text/pdf-errors'
import type { PageText } from '../../../shared/text/types'

// pdf.js runs in its own Web Worker, loaded same-origin (the CSP's `script-src 'self'` covers it).
GlobalWorkerOptions.workerSrc = workerSrc

export interface PdfDoc {
  numPages: number
  metaTitle: string | undefined
  /** PDF points, rotation ignored. */
  pageSize(n: number): Promise<{ width: number; height: number }>
  /** The same PageText the Node-side `extractPages` builds (shared mapping, no normalization). */
  pageText(n: number): Promise<PageText>
  /** Draws page `n` into `canvas` at `scale` (CSS px per PDF point). Rejects with an AbortError on abort. */
  render(n: number, canvas: HTMLCanvasElement, scale: number, signal: AbortSignal): Promise<void>
  /**
   * Builds the selectable text layer of page `n` inside `container` (an empty element sized to the page).
   * Each text div carries `data-item-index`, its index in the page's text items (the same indexing as
   * `pageText`). Rejects with an AbortError on abort.
   */
  renderTextLayer(
    n: number,
    container: HTMLElement,
    scale: number,
    signal: AbortSignal
  ): Promise<void>
  destroy(): Promise<void>
}

export type OpenPdfResult = { kind: 'ok'; doc: PdfDoc } | { kind: PdfOpenFailure }

/** A bundled pdf.js asset directory (see electron.vite.config.ts), resolved next to index.html. */
const assetDir = (dir: string): string => new URL(`pdfjs/${dir}/`, document.baseURI).href

export async function openPdf(data: Uint8Array, password?: string): Promise<OpenPdfResult> {
  const task = getDocument({
    // pdf.js detaches the buffer it is given; a copy keeps the caller's bytes usable (password retry).
    data: new Uint8Array(data),
    password,
    // No `isEvalSupported: false`: pdfjs-dist 6.5.438 dropped that option (no eval or `new Function` is
    // left in its build, so the CSP without 'unsafe-eval' is enough).
    cMapUrl: assetDir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetDir('standard_fonts'),
    iccUrl: assetDir('iccs'),
    wasmUrl: assetDir('wasm')
  })
  let pdf
  try {
    pdf = await task.promise
  } catch (err) {
    await task.destroy()
    return { kind: classifyPdfError(err) }
  }

  let metaTitle: string | undefined
  try {
    const { info } = await pdf.getMetadata()
    const title = (info as { Title?: unknown }).Title
    if (typeof title === 'string' && title.trim() !== '') metaTitle = title.trim()
  } catch {
    // metadata is optional
  }

  const doc: PdfDoc = {
    numPages: pdf.numPages,
    metaTitle,
    async pageSize(n) {
      const [x0, y0, x1, y1] = (await pdf.getPage(n)).view
      return { width: x1 - x0, height: y1 - y0 }
    },
    async pageText(n) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent({ disableNormalization: true })
      return pageTextFromContent(n, page.view, content.items as RawTextItem[])
    },
    async render(n, canvas, scale, signal) {
      signal.throwIfAborted()
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) throw new Error('canvas 2d context unavailable')
      const renderTask = page.render({
        canvas,
        canvasContext,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
      })
      const cancel = (): void => renderTask.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await renderTask.promise
      } catch (err) {
        if (err instanceof RenderingCancelledException) throw signal.reason ?? err
        throw err
      } finally {
        signal.removeEventListener('abort', cancel)
        page.cleanup()
      }
    },
    async renderTextLayer(n, container, scale, signal) {
      signal.throwIfAborted()
      const page = await pdf.getPage(n)
      const content = await page.getTextContent({ disableNormalization: true })
      signal.throwIfAborted()
      const viewport = page.getViewport({ scale })
      // The text-layer CSS sizes everything from these two (see .textLayer in main.css).
      container.style.setProperty('--scale-factor', String(scale))
      container.style.setProperty('--total-scale-factor', String(scale))
      container.style.setProperty('--scale-round-x', '1px')
      container.style.setProperty('--scale-round-y', '1px')
      const layer = new TextLayer({ textContentSource: content, container, viewport })
      const cancel = (): void => layer.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await layer.render()
      } catch (err) {
        if (signal.aborted) throw signal.reason ?? err
        throw err
      } finally {
        signal.removeEventListener('abort', cancel)
      }
      // TextLayer makes one div per item that has a `str` and appends it when non-empty, in item order.
      const divs = layer.textDivs
      let k = 0
      content.items.forEach((item, i) => {
        if (!('str' in item) || item.str === undefined) return
        const div = divs[k++]
        if (div && div.isConnected) div.dataset.itemIndex = String(i)
      })
    },
    async destroy() {
      await task.destroy()
    }
  }
  return { kind: 'ok', doc }
}
