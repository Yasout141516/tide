import type {
  AddReadingInput,
  LibrarySnapshot,
  PdfRef,
  PickResult,
  Pronunciation,
  ReadPdfResult,
  ReadingId,
  ReadingPatch,
  RelinkResult,
  SettingsPatch
} from '../shared/library/types'
import type {
  AppCommand,
  ExportEvent,
  ExportM4bResult,
  ExportSpec,
  ExportStartResult,
  SynthesizeOptions,
  TtsAudio,
  TtsLoadResult,
  TtsStatus
} from '../shared/ipc-types'

export interface TideApi {
  platform: string
  /** The renderer has mounted: main may now send queued commands. */
  ready(): void
  onCommand(cb: (c: AppCommand) => void): () => void
  tts: {
    synthesize(text: string, o: SynthesizeOptions): Promise<TtsAudio>
    cancel(gen: string): Promise<void>
    status(): Promise<TtsStatus>
    onStatus(cb: (s: TtsStatus) => void): () => void
  }
  export: {
    /** Save a reading as audio. `chooseFolder` asks main to show its folder dialog for this save. */
    start(spec: ExportSpec, o?: { chooseFolder?: boolean }): Promise<ExportStartResult>
    cancel(jobId: string): Promise<void>
    /** Show the saved file in the system file manager. */
    reveal(jobId: string): Promise<void>
    onEvent(cb: (e: ExportEvent) => void): () => void
  }
  app: {
    /** Tell main whether audio is playing, so the machine is not suspended mid-read. */
    setPlaying(on: boolean): void
    /** Quit (flushing the library) and start Tide again. */
    relaunch(): void
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
    setVoice(voice: string, speed: number): Promise<void>
    setSettings(p: SettingsPatch): Promise<void>
    setPronunciations(list: Pronunciation[]): Promise<void>
    /** Main shows the folder dialog and stores the path; the renderer never sees it. */
    chooseExportFolder(): Promise<'chosen' | 'cancelled'>
    resetExportFolder(): Promise<void>
    /** Resolves once the library file has been written. */
    flush(): Promise<void>
    tipSeen(key: string): Promise<void>
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
