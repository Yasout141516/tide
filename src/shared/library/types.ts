// Shared library types (main, preload and renderer). Pure TypeScript.
import type { Anchor } from '../text/anchor'
import type { ReadingFilters } from '../text/types'

export type ReadingId = string
export type CourseId = string
/** Shelf group key for readings without a course. */
export const OTHER = 'other'

export interface Course {
  id: CourseId
  name: string
}

export interface Reading {
  id: ReadingId
  title: string
  courseId: CourseId | null
  path: string
  fingerprint: string
  pageCount: number | null
  position: Anchor | null
  addedAt: number
  lastOpenedAt: number | null
  finished: boolean
  readEverything: boolean
  /** Finish the reading within this many minutes (speed up only), or null for no limit. */
  finishIn: number | null
}

export const THEME_IDS = ['sky-sea', 'deep-sea', 'pixel-quest', 'kitty', 'system'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface Pronunciation {
  word: string
  sayAs: string
}
export const PRONUNCIATION_LIMITS = { words: 200, wordLen: 60, sayAsLen: 120 } as const

/** `zoom` is 0.8 to 2.0, default 1. `voice` is one of VOICE_IDS; `speed` one of SPEEDS. */
export interface LibrarySettings {
  reading: ReadingFilters
  zoom: number
  voice: string
  speed: number
  theme: ThemeId
  darkPages: boolean
  pronunciations: Pronunciation[]
}

/** What library.json stores: the snapshot's settings plus the export folder path (never sent to the renderer). */
export type StoredSettings = LibrarySettings & { exportFolder: string | null }

export interface SettingsPatch {
  theme?: ThemeId
  darkPages?: boolean
  reading?: Partial<ReadingFilters>
}

/** `collapsed`: CourseIds and/or OTHER. `tipsSeen`: keys of one-time tips already shown. */
export interface LibraryUi {
  collapsed: string[]
  tipsSeen: string[]
}

export interface LibraryFile {
  schemaVersion: 1
  courses: Course[]
  readings: Reading[]
  settings: StoredSettings
  ui: LibraryUi
}

export interface ReadingView extends Omit<Reading, 'path' | 'fingerprint'> {
  fileName: string
  missing: boolean
}

export interface LibrarySnapshot {
  courses: Course[]
  readings: ReadingView[]
  settings: LibrarySettings
  /** Basename only, "Tide" when the default is in use. */
  exportFolder: { name: string; custom: boolean }
  ui: LibraryUi
}

export type PickResult =
  | { kind: 'cancelled' }
  | { kind: 'existing'; readingId: ReadingId }
  | { kind: 'new'; pickId: string; fileName: string }

export type PdfRef = { readingId: ReadingId } | { pickId: string }

export type ReadPdfResult =
  { ok: true; data: Uint8Array } | { ok: false; reason: 'missing' | 'unreadable' }

export interface AddReadingInput {
  pickId: string
  title: string
  pageCount: number | null
  course: { id: CourseId } | { newName: string } | null
}

export interface ReadingPatch {
  title?: string
  position?: Anchor
  readEverything?: boolean
  finishIn?: number | null
  opened?: true
  pageCount?: number
  finished?: boolean
}

export type RelinkResult =
  | { kind: 'cancelled' }
  | { kind: 'relinked' }
  | { kind: 'different'; pickId: string; fileName: string }
