import { READ_EVERYTHING, type ReadingFilters } from '../../../shared/text/types'
import type { LibrarySettings } from '../../../shared/library/types'

/** Read everything (per reading) wins over her global reading settings. */
export function filtersFor(settings: LibrarySettings, readEverything: boolean): ReadingFilters {
  return readEverything ? READ_EVERYTHING : settings.reading
}
