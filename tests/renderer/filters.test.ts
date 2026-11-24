import { describe, expect, it } from 'vitest'
import { filtersFor } from '../../src/renderer/src/reader/filters'
import { READ_EVERYTHING } from '../../src/shared/text/types'
import type { LibrarySettings } from '../../src/shared/library/types'

const settings: LibrarySettings = {
  reading: {
    skipHeadersFooters: true,
    skipFootnotes: false,
    stopAtReferences: true,
    skipCaptionsTables: true,
    skipCoverPages: false,
    readCitations: false
  },
  zoom: 1,
  voice: 'bf_emma',
  speed: 1,
  theme: 'sky-sea',
  darkPages: true,
  pronunciations: []
}

describe('filtersFor', () => {
  it('uses her settings when Read everything is off', () => {
    expect(filtersFor(settings, false)).toEqual(settings.reading)
  })
  it('Read everything wins over her settings', () => {
    expect(filtersFor(settings, true)).toEqual(READ_EVERYTHING)
  })
})
