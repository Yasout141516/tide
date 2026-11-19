import type {
  AddReadingInput,
  LibrarySnapshot,
  PdfRef,
  PickResult,
  ReadPdfResult,
  ReadingId,
  ReadingPatch,
  RelinkResult
} from '../shared/library/types'
import type {
  AppCommand,
  ExportM4bResult,
  SynthesizeOptions,
  TtsAudio,
  TtsLoadResult
} from '../shared/ipc-types'

export interface TideApi {
  platform: string
  /** The renderer has mounted: main may now send queued commands. */
  ready(): void
  onCommand(cb: (c: AppCommand) => void): () => void
  tts: {
    synthesize(text: string, o: SynthesizeOptions): Promise<TtsAudio>
    cancel(gen: string): Promise<void>
  }
  library: {
    get(): Promise<LibrarySnapshot>
    onChanged(cb: (s: LibrarySnapshot) => void): () => void
    pickPdf(): Promise<PickResult>
    readPdf(ref: PdfRef): Promise<ReadPdfResult>
    add(i: AddReadingInput): Promise<ReadingId>
    update(id: ReadingId, p: ReadingPatch): Promise<void>
    remove(id: ReadingId): Promise<void>
    findFile(id: ReadingId): Promise<RelinkResult>
    useDifferentFile(id: ReadingId, pickId: string): Promise<void>
    setCollapsed(key: string, collapsed: boolean): Promise<void>
    setZoom(zoom: number): Promise<void>
  }
}

declare global {
  interface Window {
    tide: TideApi
    /** Present only when the app runs with TIDE_E2E=1. */
    tideTest?: {
      ttsLoad(): Promise<TtsLoadResult>
      /** Speaks two short pages and saves a 2-chapter .m4b to the absolute `outPath`. */
      exportM4b(outPath: string): Promise<ExportM4bResult>
    }
  }
}
