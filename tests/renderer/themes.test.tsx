// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { Shelf } from '../../src/renderer/src/shelf/Shelf'
import { EmptyState } from '../../src/renderer/src/shelf/EmptyState'
import { badgeColour, BADGE_COLOURS } from '../../src/renderer/src/theme/badges'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import type { LibrarySnapshot, ThemeId } from '../../src/shared/library/types'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp } from './reader-fakes'
import { fakeTide } from './setup'

const reading = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 2,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null,
  fileName: 'r1.pdf',
  missing: false
}

async function openWith(theme: Exclude<ThemeId, 'system'>): Promise<void> {
  setTide(
    fakeTide({
      snapshot: {
        readings: [reading],
        settings: {
          reading: DEFAULT_FILTERS,
          zoom: 1,
          voice: 'bf_emma',
          speed: 1,
          theme,
          darkPages: true,
          pronunciations: []
        }
      }
    })
  )
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(2)) }), fakePlayer().deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  await waitFor(() =>
    expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
  )
}

describe('Pixel Quest dialogue box', () => {
  it('mirrors the current sentence, hidden from assistive tech', async () => {
    await openWith('pixel-quest')
    const box = await screen.findByTestId('dialogue-box')
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.textContent).toContain('Memory is shaped by attention.')
    expect(within(screen.getByLabelText('Player')).getByTestId('dialogue-box')).toBe(box)
  })

  it('is absent under sky-sea', async () => {
    await openWith('sky-sea')
    expect(screen.queryByTestId('dialogue-box')).toBeNull()
  })
})

async function themed(
  theme: Exclude<ThemeId, 'system'>,
  over: Partial<LibrarySnapshot> = {}
): Promise<LibrarySnapshot> {
  const base = (await fakeTide().library.get()) as LibrarySnapshot
  const snap = { ...base, ...over, settings: { ...base.settings, theme } }
  setTide(fakeTide({ snapshot: snap, initialTheme: theme }))
  return snap
}

describe('Pixel Quest course badges', () => {
  const NAMES = ['PSYC 201', 'SOC 110', 'ART 1', 'BIO 2', 'ECON 3', 'MATH 4']
  const extra = (): Partial<LibrarySnapshot> => ({
    courses: NAMES.map((n, i) => ({ id: `c${i}`, name: n })),
    readings: NAMES.map((_, i) => ({ ...reading, id: `r${i}`, title: `T${i}`, courseId: `c${i}` }))
  })
  const mountShelf = (snap: LibrarySnapshot): ReturnType<typeof render> =>
    render(<Shelf snapshot={snap} selectedId={null} onOpen={() => {}} onAdd={() => {}} />)

  it('cycles the five colours in course order', () => {
    expect(BADGE_COLOURS['pixel-quest']).toEqual([
      '#B83D73',
      '#2B6FA8',
      '#8C6420',
      '#3A7D30',
      '#C8432B'
    ])
    expect(badgeColour('pixel-quest', 0)).toBe('#B83D73')
    expect(badgeColour('pixel-quest', 5)).toBe('#B83D73')
    expect(badgeColour('pixel-quest', 7)).toBe('#8C6420')
    expect(badgeColour('sky-sea', 0)).toBeNull()
  })

  it('shows a coloured, white-text badge per course on the shelf under pixel-quest', async () => {
    const r = mountShelf(await themed('pixel-quest', extra()))
    await waitFor(() => expect(r.container.querySelectorAll('[data-course-badge]').length).toBe(6))
    const badges = [...r.container.querySelectorAll<HTMLElement>('[data-course-badge]')]
    expect(badges.map((b) => b.style.backgroundColor)).toEqual(
      NAMES.map((_, i) => hexToRgb(BADGE_COLOURS['pixel-quest']![i % 5]))
    )
    expect(badges[0].style.color).toBe('rgb(255, 255, 255)')
    expect(badges[0].getAttribute('aria-hidden')).toBe('true')
    expect(badges.map((b) => b.textContent).sort()).toEqual([
      'ART',
      'BIO',
      'ECO',
      'MAT',
      'PSY',
      'SOC'
    ])
  })

  it('shows no badges under sky-sea', async () => {
    const r = mountShelf(await themed('sky-sea', extra()))
    expect(r.container.querySelectorAll('[data-course-badge]').length).toBe(0)
  })
})

function hexToRgb(h: string): string {
  const n = parseInt(h.slice(1), 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('Pixel Quest sprout mascot', () => {
  it('shows on the empty shelf under pixel-quest and not under sky-sea', async () => {
    await themed('pixel-quest')
    const a = render(<EmptyState onAdd={() => {}} platform="win32" />)
    await waitFor(() => expect(a.container.querySelector('[data-mascot="sprout"]')).toBeTruthy())
    a.unmount()
    await themed('sky-sea')
    const b = render(<EmptyState onAdd={() => {}} platform="win32" />)
    expect(b.container.querySelector('[data-mascot="sprout"]')).toBeNull()
  })
})
