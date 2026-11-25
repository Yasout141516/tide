import { DEFAULT_VOICE, SPEEDS, VOICE_IDS, isFinishInChoice } from '../../shared/voices'
import { DEFAULT_FILTERS, type ReadingFilters } from '../../shared/text/types'
import { isThemeId } from '../../shared/theme'
import { ZOOM_MAX, ZOOM_MIN } from '../../shared/zoom'
import type { Anchor } from '../../shared/text/anchor'
import type {
  Course,
  LibraryFile,
  LibraryUi,
  Pronunciation,
  Reading,
  StoredSettings
} from '../../shared/library/types'

export const SCHEMA_VERSION = 1

type Obj = Record<string, unknown>

/** MIGRATIONS[v] upgrades a version-v file to v+1. Empty today. */
const MIGRATIONS: Record<number, (raw: Obj) => Obj> = {}

export function emptyLibrary(): LibraryFile {
  return {
    schemaVersion: 1,
    courses: [],
    readings: [],
    settings: {
      reading: { ...DEFAULT_FILTERS },
      zoom: 1,
      voice: DEFAULT_VOICE,
      speed: 1,
      theme: 'sky-sea',
      darkPages: true,
      pronunciations: [],
      exportFolder: null
    },
    ui: { collapsed: [], tipsSeen: [] }
  }
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseAnchor(v: unknown): Anchor | null | undefined {
  if (v === null) return null
  if (!isObj(v) || !isNum(v.page) || !isNum(v.textItemIndex) || !isNum(v.charOffset)) {
    return undefined
  }
  return { page: v.page, textItemIndex: v.textItemIndex, charOffset: v.charOffset }
}

function parseReading(v: unknown): Reading | null {
  if (!isObj(v)) return null
  if (!isStr(v.id) || !isStr(v.title) || !isStr(v.path) || !isStr(v.fingerprint)) return null
  if (!(v.courseId === null || isStr(v.courseId))) return null
  if (!(v.pageCount === null || isNum(v.pageCount))) return null
  if (!isNum(v.addedAt) || !(v.lastOpenedAt === null || isNum(v.lastOpenedAt))) return null
  const position = parseAnchor(v.position ?? null)
  if (position === undefined) return null
  const finished = v.finished ?? false
  const readEverything = v.readEverything ?? false
  if (typeof finished !== 'boolean' || typeof readEverything !== 'boolean') return null
  // Lenient like voice and speed: an unknown choice (a hand edit, or a downgrade after a build added
  // one) clears this reading's setting instead of failing the whole library.
  const finishIn = isNum(v.finishIn) && isFinishInChoice(v.finishIn) ? v.finishIn : null
  return {
    id: v.id,
    title: v.title,
    courseId: v.courseId,
    path: v.path,
    fingerprint: v.fingerprint,
    pageCount: v.pageCount,
    position,
    addedAt: v.addedAt,
    lastOpenedAt: v.lastOpenedAt,
    finished,
    readEverything,
    finishIn
  }
}

function parseFilters(v: unknown): ReadingFilters | null {
  if (v === undefined) return { ...DEFAULT_FILTERS }
  if (!isObj(v)) return null
  const out: Record<string, boolean> = {}
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof ReadingFilters)[]) {
    const val = v[key] ?? DEFAULT_FILTERS[key]
    if (typeof val !== 'boolean') return null
    out[key] = val
  }
  return out as unknown as ReadingFilters
}

function parsePronunciations(v: unknown): Pronunciation[] {
  if (!Array.isArray(v)) return []
  const out: Pronunciation[] = []
  for (const e of v) {
    if (isObj(e) && isStr(e.word) && isStr(e.sayAs)) out.push({ word: e.word, sayAs: e.sayAs })
  }
  return out
}

function parseSettings(v: unknown): StoredSettings | null {
  if (v === undefined) return emptyLibrary().settings
  if (!isObj(v)) return null
  const reading = parseFilters(v.reading)
  const zoom = v.zoom ?? 1
  if (!reading || !isNum(zoom)) return null
  const voice = isStr(v.voice) && VOICE_IDS.has(v.voice) ? v.voice : DEFAULT_VOICE
  const speed = (SPEEDS as readonly unknown[]).includes(v.speed) ? (v.speed as number) : 1
  const theme = isThemeId(v.theme) ? v.theme : 'sky-sea'
  const darkPages = typeof v.darkPages === 'boolean' ? v.darkPages : true
  return {
    reading,
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)),
    voice,
    speed,
    theme,
    darkPages,
    pronunciations: parsePronunciations(v.pronunciations),
    exportFolder: isStr(v.exportFolder) && v.exportFolder !== '' ? v.exportFolder : null
  }
}

function parseUi(v: unknown): LibraryUi | null {
  if (v === undefined) return { collapsed: [], tipsSeen: [] }
  if (!isObj(v)) return null
  const collapsed = v.collapsed ?? []
  const tipsSeen = v.tipsSeen ?? []
  if (!Array.isArray(collapsed) || !collapsed.every(isStr)) return null
  if (!Array.isArray(tipsSeen) || !tipsSeen.every(isStr)) return null
  return { collapsed: [...collapsed], tipsSeen: [...tipsSeen] }
}

/** Validates and normalizes a parsed library.json. Null for invalid input or a newer schemaVersion. */
export function parseLibrary(raw: unknown): LibraryFile | null {
  if (!isObj(raw)) return null
  let obj: Obj = raw
  let version = obj.schemaVersion
  if (!isNum(version) || !Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    return null
  }
  while (version < SCHEMA_VERSION) {
    const migrate: ((o: Obj) => Obj) | undefined = MIGRATIONS[version]
    if (!migrate) return null
    obj = migrate(obj)
    version += 1
  }
  if (!Array.isArray(obj.courses) || !Array.isArray(obj.readings)) return null
  const courses: Course[] = []
  for (const c of obj.courses) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.name)) return null
    courses.push({ id: c.id, name: c.name })
  }
  const readings: Reading[] = []
  for (const r of obj.readings) {
    const reading = parseReading(r)
    if (!reading) return null
    readings.push(reading)
  }
  const settings = parseSettings(obj.settings)
  const ui = parseUi(obj.ui)
  if (!settings || !ui) return null
  return { schemaVersion: 1, courses, readings, settings, ui }
}
