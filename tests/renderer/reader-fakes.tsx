import { render } from '@testing-library/react'
import { vi } from 'vitest'
import App from '../../src/renderer/src/App'
import type { AudioSink } from '../../src/renderer/src/player/engine'
import { PlayerDepsProvider, type PlayerDeps } from '../../src/renderer/src/player/PlayerContext'
import { ReaderDepsProvider, type ReaderDepsValue } from '../../src/renderer/src/reader/deps'
import type { OpenPdfResult, PdfDoc } from '../../src/renderer/src/reader/pdf'
import { buildSentences } from '../../src/shared/text/pipeline'
import type { PageText, TextItem } from '../../src/shared/text/types'

export const PAGE_W = 612
export const PAGE_H = 792

/** One page of synthetic body text: each string is a line of 12 pt text, 14 pt apart. */
export function textPage(page: number, lines: string[]): PageText {
  const items: TextItem[] = lines.map((str, i) => ({
    page,
    index: i,
    str,
    x: 72,
    y: 100 + 14 * i,
    width: 6 * str.length,
    fontSize: 12
  }))
  return { page, width: PAGE_W, height: PAGE_H, items }
}

export const emptyPage = (page: number): PageText => textPage(page, [])

export type FakeDoc = PdfDoc & {
  log: string[]
  render: ReturnType<typeof vi.fn>
  pageText: ReturnType<typeof vi.fn>
}

/** A PdfDoc over synthetic pages. `log` records "render:n" / "text:n" in call order. */
export function fakeDoc(pages: PageText[]): FakeDoc {
  const log: string[] = []
  return {
    log,
    numPages: pages.length,
    metaTitle: undefined,
    pageSize: () => Promise.resolve({ width: PAGE_W, height: PAGE_H }),
    pageText: vi.fn((n: number) => {
      log.push(`text:${n}`)
      return Promise.resolve(pages[n - 1])
    }),
    render: vi.fn((n: number) => {
      log.push(`render:${n}`)
      return Promise.resolve()
    }),
    renderTextLayer: vi.fn((n: number, container: HTMLElement) => {
      pages[n - 1].items.forEach((item, i) => {
        const div = document.createElement('span')
        div.dataset.itemIndex = String(i)
        div.textContent = item.str
        container.append(div)
      })
      return Promise.resolve()
    }),
    destroy: () => Promise.resolve()
  }
}

const SENTENCES = ['Memory is shaped by attention.', 'Attention is limited and selective.']
export const bodyPages = (count: number): PageText[] =>
  Array.from({ length: count }, (_, i) => textPage(i + 1, SENTENCES))

/** Deps that open a fake document and run the real text pipeline inline. */
export function fakeDeps(
  open: OpenPdfResult | ((data: Uint8Array, password?: string) => OpenPdfResult) = {
    kind: 'ok',
    doc: fakeDoc(bodyPages(10))
  }
): ReaderDepsValue {
  return {
    openPdf: vi.fn((data: Uint8Array, password?: string) =>
      Promise.resolve(typeof open === 'function' ? open(data, password) : open)
    ),
    buildSentences: vi.fn((pages, filters) => Promise.resolve(buildSentences(pages, filters)))
  }
}

/** An AudioSink with no media: tests call end() when a clip should finish. */
export class FakeSink implements AudioSink {
  src = ''
  playing = false
  currentTime = 0
  volume = 1
  plays = 0
  private endedCb: (() => void) | undefined
  setSource(url: string): void {
    this.src = url
  }
  play(): Promise<void> {
    this.playing = true
    this.plays += 1
    return Promise.resolve()
  }
  pause(): void {
    this.playing = false
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb
  }
  onError(): void {
    // not needed
  }
  /** The playing clip finished. */
  end(): void {
    this.endedCb?.()
  }
}

/** A fake sink plus the PlayerDeps that inject it; no media or object URLs are touched. */
export function fakePlayer(): { sink: FakeSink; deps: PlayerDeps } {
  const sink = new FakeSink()
  let n = 0
  return {
    sink,
    deps: { makeSink: () => sink, makeUrl: () => `blob:clip-${n++}`, revokeUrl: () => {} }
  }
}

/** One second of silence: what the fake voice returns for any text. */
export const SILENCE = {
  pcm: new Float32Array(24000),
  sampleRate: 24000 as const,
  synthMs: 1,
  chunks: 1
}

/** Renders the whole App with fake reader deps (and, optionally, a fake sink for the player). */
export function renderApp(
  deps: Partial<ReaderDepsValue> = fakeDeps(),
  player: PlayerDeps = fakePlayer().deps
): ReturnType<typeof render> {
  return render(
    <PlayerDepsProvider value={player}>
      <ReaderDepsProvider value={deps}>
        <App />
      </ReaderDepsProvider>
    </PlayerDepsProvider>
  )
}
