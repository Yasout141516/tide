import { describe, expect, it } from 'vitest'
import { defaultBaseName, durationLabel } from '../../src/renderer/src/save/names'

describe('save names', () => {
  it('defaultBaseName forms for selection, pages, whole and no course', () => {
    const base = { course: 'PSYC 201', title: 'Ch 2 Memory' }
    expect(defaultBaseName({ ...base, scope: { kind: 'selection', page: 31 } })).toBe(
      'PSYC 201 – Ch 2 Memory – p31'
    )
    expect(defaultBaseName({ ...base, scope: { kind: 'pages', from: 31, to: 40 } })).toBe(
      'PSYC 201 – Ch 2 Memory – p31–40'
    )
    expect(defaultBaseName({ ...base, scope: { kind: 'pages', from: 31, to: 31 } })).toBe(
      'PSYC 201 – Ch 2 Memory – p31'
    )
    expect(defaultBaseName({ ...base, scope: { kind: 'whole' } })).toBe('PSYC 201 – Ch 2 Memory')
    expect(defaultBaseName({ course: null, title: 'Ch 2 Memory', scope: { kind: 'whole' } })).toBe(
      'Ch 2 Memory'
    )
  })

  it('durationLabel wording', () => {
    expect(durationLabel(0)).toBe('under a minute')
    expect(durationLabel(59)).toBe('under a minute')
    expect(durationLabel(60)).toBe('about 1 min')
    expect(durationLabel(14 * 60 + 10)).toBe('about 14 min')
  })
})
