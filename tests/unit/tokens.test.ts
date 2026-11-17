import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../../src/renderer/src/assets/tokens.css'), 'utf8')

// Lowercase, no spaces, and no leading or trailing zeros in decimals (formatters add or drop them).
const norm = (v: string): string =>
  v
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/(^|[^\d])0\./g, '$1.')
    .replace(/(\.\d*?)0+(?=\D|$)/g, '$1')

/** Parses the `:root[data-theme='<theme>'] { … }` rule into { name: value }, lowercased, spaces stripped. */
function block(theme: string): Record<string, string> {
  const m = css.match(new RegExp(`:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`no ${theme} block in tokens.css`)
  const out: Record<string, string> = {}
  for (const decl of m[1].split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const name = decl.slice(0, i).trim()
    if (name.startsWith('--')) out[name.slice(2)] = norm(decl.slice(i + 1))
  }
  return out
}

const lower = (o: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, norm(v)]))

const SKY = {
  bg: '#F2F9FF',
  'shelf-a': '#DDEFFC',
  'shelf-b': '#EAF5FE',
  surface: '#FFFFFF',
  ink: '#12324A',
  muted: '#4F6A82',
  primary: '#0F6FA8',
  'on-primary': '#FFFFFF',
  soft: '#E3F2FD',
  'soft-ink': '#0B5884',
  border: '#C9E6FA',
  'stage-a': '#CFE8FA',
  'stage-b': '#E6F3FD',
  'stage-c': '#F2F9FF',
  page: '#FFFFFF',
  'page-ink': '#1D2B36',
  hl: '#CDEBFF',
  'hl-line': '#1E88C7',
  sel: 'rgba(91,182,236,.28)',
  'wave-off': '#C9E6FA',
  'wave-on': '#1E88C7',
  warn: '#B4532A',
  'warn-soft': '#FDEEE6',
  ok: '#1B7F5B',
  bubble: '#0A2E45',
  'primary-deep': '#0B5884',
  'page-meta': '#0F6FA8',
  scrim: 'rgba(10,46,69,.32)',
  shadow: 'rgba(11,88,132,.16)',
  'logo-sun': '#9DD2F5',
  'logo-wave-a': '#1E88C7',
  'logo-wave-b': '#4FB0E8'
}
const DEEP = {
  bg: '#0B1D2C',
  'shelf-a': '#0A1826',
  'shelf-b': '#0D2134',
  surface: '#11293D',
  ink: '#E4F1FA',
  muted: '#8EA9BF',
  primary: '#4FB0E8',
  'on-primary': '#06192A',
  soft: '#163650',
  'soft-ink': '#A9DAF7',
  border: '#1C3A54',
  'stage-a': '#0E2A40',
  'stage-b': '#0C2236',
  'stage-c': '#0B1D2C',
  page: '#132B3E',
  'page-ink': '#D7E4EE',
  hl: 'rgba(79,176,232,.30)',
  'hl-line': '#6CC3F2',
  sel: 'rgba(108,195,242,.22)',
  'wave-off': '#1C3A54',
  'wave-on': '#6CC3F2',
  warn: '#F0A07A',
  'warn-soft': '#3A2620',
  ok: '#5FD3A3',
  bubble: '#E4F1FA',
  'primary-deep': '#2E8FC8',
  'page-meta': '#6CC3F2',
  scrim: 'rgba(2,10,18,.55)',
  shadow: 'rgba(0,0,0,.45)',
  'logo-sun': '#A9DAF7',
  'logo-wave-a': '#6CC3F2',
  'logo-wave-b': '#4FB0E8'
}

describe('design tokens', () => {
  it('Sky & Sea tokens match spec 5.2', () => expect(block('sky-sea')).toEqual(lower(SKY)))
  it('Deep Sea tokens match spec 5.2', () => expect(block('deep-sea')).toEqual(lower(DEEP)))
})
