import { describe, expect, it } from 'vitest'
import { applyPronunciations } from '../../../src/shared/text/pronounce'

const R = [
  { word: 'schema', sayAs: 'SKEE-muh' },
  { word: 'York', sayAs: 'YORK-x' },
  { word: 'New York', sayAs: 'noo-york' },
  { word: 'C++', sayAs: 'see plus plus' },
  { word: 'Šabić', sayAs: 'SHAH-bitch' }
]

describe('applyPronunciations', () => {
  it('replaces whole words only, case-insensitively', () => {
    expect(applyPronunciations('Schema and schemata; schematic.', R)).toBe(
      'SKEE-muh and schemata; schematic.'
    )
  })
  it('longest word first', () => {
    expect(applyPronunciations('New York, York.', R)).toBe('noo-york, YORK-x.')
  })
  it('escapes regex characters', () => {
    expect(applyPronunciations('I like C++ a lot', R)).toBe('I like see plus plus a lot')
  })
  it('handles non-ASCII letters and a trailing apostrophe', () => {
    expect(applyPronunciations('Šabić’s view', R)).toBe('SHAH-bitch’s view')
  })
  it('does not match inside a longer word or digits', () => {
    expect(applyPronunciations('xschema schema2', R)).toBe('xschema schema2')
  })
  it('is one pass', () => {
    expect(applyPronunciations('x', [{ word: 'x', sayAs: 'schema' }, ...R])).toBe('schema')
  })
  it('leaves text alone with no rules', () => {
    expect(applyPronunciations('unchanged', [])).toBe('unchanged')
  })
})
