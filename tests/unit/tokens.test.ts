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
  'logo-wave-b': '#4FB0E8',
  'dialogue-bg': '#FFFFFF',
  'dialogue-ink': '#1D2B36',
  'dialogue-label': '#0F6FA8',
  'badge-ink': '#FFFFFF',
  'wave-sea': '#C9E6FA'
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
  'logo-wave-b': '#4FB0E8',
  'dialogue-bg': '#11293D',
  'dialogue-ink': '#E4F1FA',
  'dialogue-label': '#6CC3F2',
  'badge-ink': '#06192A',
  'wave-sea': '#1C3A54'
}

const PQ = {
  bg: '#12304A',
  'shelf-a': '#0C2236',
  'shelf-b': '#0C2236',
  surface: '#0C2236',
  ink: '#FDF3DC',
  muted: '#9FC3D9',
  primary: '#C8432B',
  'on-primary': '#FFFFFF',
  soft: '#16405F',
  'soft-ink': '#FFD66B',
  border: '#071624',
  'stage-a': '#12304A',
  'stage-b': '#12304A',
  'stage-c': '#12304A',
  page: '#FFFDF6',
  'page-ink': '#22223A',
  'page-meta': '#4FC3D1',
  hl: '#FFE27A',
  'hl-line': '#C8432B',
  'wave-off': '#071624',
  'wave-on': '#4FC3D1',
  warn: '#FF9A85',
  'warn-soft': '#3A1F1A',
  ok: '#7FD06E',
  bubble: '#FDF3DC',
  'primary-deep': '#FFD66B',
  'dialogue-bg': '#FDF3DC',
  'dialogue-ink': '#22223A',
  'dialogue-label': '#2A6F92',
  'badge-ink': '#FFFFFF',
  'wave-sea': '#2A7BA0'
}

const KITTY = {
  bg: '#FFF7F2',
  'shelf-a': '#FCE9EC',
  'shelf-b': '#FFF3EE',
  surface: '#FFFFFF',
  ink: '#4A3236',
  muted: '#7A5A60',
  primary: '#B8456A',
  'on-primary': '#FFFFFF',
  soft: '#FBE1E8',
  'soft-ink': '#8E2F52',
  border: '#F3D3DA',
  'stage-a': '#FDE3E9',
  'stage-b': '#FFF1EC',
  'stage-c': '#FFF7F2',
  page: '#FFFFFF',
  'page-ink': '#3B2A2D',
  'page-meta': '#A93D61',
  hl: '#FFD6E0',
  'hl-line': '#B8456A',
  'wave-off': '#F3D3DA',
  'wave-on': '#B8456A',
  // Deliberate deviation from the spec's #B4532A: that is 4.27:1 on the shelf gradient (fails AA 4.5:1).
  warn: '#A34620',
  'warn-soft': '#FDEEE6',
  ok: '#1B7F5B',
  bubble: '#4A3236',
  'primary-deep': '#A93D61',
  'dialogue-bg': '#FFFFFF',
  'dialogue-ink': '#4A3236',
  'dialogue-label': '#8E2F52',
  'badge-ink': '#FFFFFF',
  'wave-sea': '#FBE1E8'
}

// WCAG 2.x relative luminance and contrast ratio for #rrggbb.
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('Pixel Quest tokens', () => {
  const pq = block('pixel-quest')
  it('defines every token the Sky & Sea block defines', () => {
    expect(Object.keys(pq).sort()).toEqual(Object.keys(block('sky-sea')).sort())
  })
  it('uses the spec 5.2 values', () => {
    for (const [k, v] of Object.entries(PQ)) expect(pq[k], k).toBe(norm(v))
  })
  const pairs: Array<[string, string, string]> = [
    ['ink', 'bg', 'text on the map'],
    ['ink', 'surface', 'text on the player bar'],
    ['ink', 'shelf-a', 'text on the shelf'],
    ['muted', 'surface', 'secondary text on the player'],
    ['muted', 'bg', 'secondary text on the map'],
    ['muted', 'shelf-a', 'secondary text on the shelf'],
    ['on-primary', 'primary', 'play / Add reading'],
    ['soft-ink', 'soft', 'secondary buttons'],
    ['page-ink', 'page', 'the page'],
    ['page-meta', 'bg', 'reading header meta'],
    ['primary-deep', 'shelf-a', 'wordmark'],
    ['warn', 'shelf-a', 'File moved on the shelf'],
    ['warn', 'warn-soft', 'errors'],
    ['ok', 'bg', 'Saved'],
    ['bg', 'bubble', 'bubble text'],
    ['dialogue-ink', 'dialogue-bg', 'dialogue text'],
    ['dialogue-label', 'dialogue-bg', 'dialogue label']
  ]
  it.each(pairs)('%s on %s is at least 4.5:1 (%s)', (fg, bgk) => {
    expect(contrast(pq[fg], pq[bgk])).toBeGreaterThanOrEqual(4.5)
  })
  it('the dialogue box text and white badge text are at least 4.5:1', () => {
    expect(contrast('#22223a', '#fdf3dc')).toBeGreaterThanOrEqual(4.5)
    for (const b of ['#b83d73', '#2b6fa8', '#8c6420', '#3a7d30', '#c8432b'])
      expect(contrast('#ffffff', b), b).toBeGreaterThanOrEqual(4.5)
  })
})

describe('Kitty tokens', () => {
  const kt = block('kitty')
  it('defines every token the Sky & Sea block defines', () => {
    expect(Object.keys(kt).sort()).toEqual(Object.keys(block('sky-sea')).sort())
  })
  it('uses the spec 5.2 values', () => {
    for (const [k, v] of Object.entries(KITTY)) expect(kt[k], k).toBe(norm(v))
  })
  const pairs: Array<[string, string, string]> = [
    ['ink', 'bg', 'text on the page background'],
    ['ink', 'surface', 'text on the player bar'],
    ['ink', 'shelf-a', 'text on the shelf'],
    ['ink', 'shelf-b', 'text on the shelf'],
    ['muted', 'surface', 'secondary text on the player'],
    ['muted', 'bg', 'secondary text'],
    ['muted', 'shelf-a', 'secondary text on the shelf'],
    ['muted', 'shelf-b', 'secondary text on the shelf'],
    ['on-primary', 'primary', 'play / Add reading'],
    ['soft-ink', 'soft', 'secondary buttons'],
    ['page-ink', 'page', 'the page'],
    ['page-meta', 'bg', 'reading header meta'],
    ['page-meta', 'stage-a', 'reading header meta'],
    ['primary-deep', 'shelf-a', 'wordmark'],
    ['primary', 'surface', 'selected row label'],
    ['warn', 'shelf-a', 'File moved on the shelf'],
    ['warn', 'shelf-b', 'File moved on the shelf'],
    ['warn', 'warn-soft', 'errors'],
    ['ok', 'bg', 'Saved'],
    ['bg', 'bubble', 'bubble and toast text'],
    ['dialogue-ink', 'dialogue-bg', 'dialogue text'],
    ['dialogue-label', 'dialogue-bg', 'dialogue label']
  ]
  it.each(pairs)('%s on %s is at least 4.5:1 (%s)', (fg, bgk) => {
    expect(contrast(kt[fg], kt[bgk])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('design tokens', () => {
  it('Sky & Sea tokens match spec 5.2', () => expect(block('sky-sea')).toEqual(lower(SKY)))
  it('Deep Sea tokens match spec 5.2', () => expect(block('deep-sea')).toEqual(lower(DEEP)))
})
