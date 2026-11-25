// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import { Shelf } from '../../src/renderer/src/shelf/Shelf'
import { EmptyState } from '../../src/renderer/src/shelf/EmptyState'
import { badgeColour, BADGE_COLOURS } from '../../src/renderer/src/theme/badges'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import type { LibrarySnapshot, ThemeId } from '../../src/shared/library/types'
import { themeCopy } from '../../src/renderer/src/theme/copy'
import { ToastProvider, useToast } from '../../src/renderer/src/shell/Toast'
import { VOICES } from '../../src/shared/voices'
import { bodyPages, fakeDeps, fakeDoc, fakePlayer, renderApp, SILENCE } from './reader-fakes'
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
    // Two-line clamp keeps the box one height for every sentence.
    expect(box.querySelector('.pq-dialogue-text')!.classList.contains('line-clamp-2')).toBe(true)
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
    expect(badges[0].style.color).toBe('var(--badge-ink)')
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

// ---------- Kitty ----------

async function openKitty(
  theme: Exclude<ThemeId, 'system'> = 'kitty',
  over: Partial<typeof reading> = {}
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide({
    snapshot: {
      readings: [{ ...reading, ...over }],
      settings: {
        reading: DEFAULT_FILTERS,
        zoom: 1,
        voice: 'bf_emma',
        speed: 1,
        theme,
        darkPages: true,
        pronunciations: []
      }
    },
    initialTheme: theme
  })
  t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
  t.tts.status = () => Promise.resolve('ready' as const)
  setTide(t)
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(bodyPages(2)) }), fakePlayer().deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  if (!over.missing)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="sentence-highlight"]')).toBeTruthy()
    )
  return t
}

const playerBar = (): HTMLElement => screen.getByLabelText('Player')
const peek = (): Element | null => document.querySelector('[data-mascot="mochi"][data-pose="peek"]')

describe('themeCopy', () => {
  it('has the Kitty lines and null elsewhere', () => {
    expect(themeCopy('kitty', 'playing')).toBe('Purring along')
    expect(themeCopy('kitty', 'moved')).toBe('File wandered off · Find it')
    expect(themeCopy('kitty', 'sleep')).toBe('Nap timer')
    expect(themeCopy('kitty', 'emptyShelf')).toBe('Mochi is waiting for a story')
    for (const th of ['sky-sea', 'deep-sea', 'pixel-quest'] as const)
      for (const k of ['playing', 'moved', 'sleep', 'emptyShelf'] as const)
        expect(themeCopy(th, k)).toBeNull()
  })
})

describe('Kitty Nap timer', () => {
  it('shows "Nap timer" with a kitten while the accessible name stays "Sleep"', async () => {
    await openKitty()
    const btn = within(playerBar()).getByRole('button', { name: 'Sleep' })
    expect(btn.textContent).toContain('Nap timer')
    expect(btn.querySelector('[data-mascot="sleepy"]')).toBeTruthy()
  })
  it('is plain "Sleep" under sky-sea', async () => {
    await openKitty('sky-sea')
    const btn = within(playerBar()).getByRole('button', { name: 'Sleep' })
    expect(btn.textContent).toBe('Sleep')
    expect(btn.querySelector('[data-mascot]')).toBeNull()
  })
})

describe('Kitty Mochi peeking', () => {
  it('peeks only while playing', async () => {
    await openKitty()
    expect(peek()).toBeNull()
    await userEvent.click(within(playerBar()).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(peek()).toBeTruthy())
    expect(peek()!.getAttribute('aria-hidden')).toBe('true')
    expect(playerBar().textContent).toContain('Purring along')
    await userEvent.click(within(playerBar()).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(peek()).toBeNull())
    expect(playerBar().textContent).not.toContain('Purring along')
  })
  it('never appears under sky-sea', async () => {
    await openKitty('sky-sea')
    await userEvent.click(within(playerBar()).getByRole('button', { name: 'Play' }))
    await waitFor(() =>
      expect(within(playerBar()).getByRole('button', { name: 'Pause' })).toBeTruthy()
    )
    expect(document.querySelector('[data-mascot="mochi"]')).toBeNull()
  })
  it('the Play button keeps its plain name and gets a paw pad under kitty', async () => {
    await openKitty()
    const play = within(playerBar()).getByRole('button', { name: 'Play' })
    expect(play.querySelector('[data-paw-pad]')).toBeTruthy()
  })
  it('the progress thread has a yarn ball under kitty only', async () => {
    await openKitty()
    expect(playerBar().querySelector('[data-yarn-ball]')).toBeTruthy()
  })
})

describe('Kitty voice avatars', () => {
  it('gives each voice a distinct tint, under kitty only', async () => {
    await openKitty()
    await userEvent.click(within(playerBar()).getByRole('button', { name: /^Emma · 1×$/ }))
    const pop = await screen.findByRole('dialog', { name: 'Choose a voice' })
    const av = [...pop.querySelectorAll<HTMLElement>('[data-voice-avatar]')]
    expect(av).toHaveLength(VOICES.length)
    expect(new Set(av.map((a) => a.getAttribute('data-tint'))).size).toBe(VOICES.length)
    // Plain names are unchanged.
    expect(within(pop).getByRole('button', { name: /^Kore/ })).toBeTruthy()
  })
  it('has no avatars under sky-sea', async () => {
    await openKitty('sky-sea')
    await userEvent.click(within(playerBar()).getByRole('button', { name: /^Emma · 1×$/ }))
    const pop = await screen.findByRole('dialog', { name: 'Choose a voice' })
    expect(pop.querySelector('[data-voice-avatar]')).toBeNull()
  })
})

describe('Kitty shelf', () => {
  it('keeps "File moved · Find it" in the accessible name and shows the playful line', async () => {
    await openKitty('kitty', { missing: true })
    const row = screen.getByRole('button', { name: /File moved · Find it/, hidden: true })
    expect(row.querySelector('.sr-only')!.textContent).toBe('File moved · Find it')
    const shown = [...row.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent)
    expect(shown).toContain('File wandered off · Find it')
  })
  it('puts a paw print on each course label and cat ears on Add reading', async () => {
    const snap = await themed('kitty', {
      courses: [{ id: 'c0', name: 'PSYC 201' }],
      readings: [{ ...reading, id: 'r0', courseId: 'c0' }]
    })
    const r = render(<Shelf snapshot={snap} selectedId={null} onOpen={() => {}} onAdd={() => {}} />)
    await waitFor(() => expect(r.container.querySelectorAll('[data-course-paw]').length).toBe(1))
    expect(r.container.querySelector('[data-course-badge]')).toBeNull()
    // The class that drives the ear-tip styling in main.css.
    expect(screen.getByRole('button', { name: 'Add reading' }).classList.contains('kt-add')).toBe(
      true
    )
  })
  it('sits Mochi in a box on the empty shelf with a playful line, the plain heading intact', async () => {
    await themed('kitty')
    const r = render(<EmptyState onAdd={() => {}} platform="win32" />)
    await waitFor(() =>
      expect(r.container.querySelector('[data-mascot="mochi"][data-pose="box"]')).toBeTruthy()
    )
    expect(screen.getByRole('heading', { name: 'Your shelf is empty' })).toBeTruthy()
    expect(r.container.textContent).toContain('Mochi is waiting for a story')
  })
})

describe('Kitty toast', () => {
  it('puts a paw print on the saved note (visual only)', async () => {
    await themed('kitty')
    function Show(): null {
      const toast = useToast()
      useEffect(() => {
        toast.show({ text: '✓ Saved “a.mp3”' })
      }, [toast])
      return null
    }
    render(
      <ToastProvider>
        <Show />
      </ToastProvider>
    )
    await waitFor(() => expect(document.querySelector('[data-toast-paw]')).toBeTruthy())
    expect(document.querySelector('[data-toast-paw]')!.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('Saved')
  })
})

describe('Kitty primary buttons', () => {
  it('a dialog primary carries btn-primary (the ear-tip hook)', async () => {
    await openKitty('kitty', { missing: true })
    const dlg = await screen.findByRole('dialog', { name: 'Where did this one go?' })
    expect(dlg.querySelector('button.btn-primary')).toBeTruthy()
  })
  it('a speed radio does not carry btn-primary', async () => {
    await openKitty()
    await userEvent.click(within(playerBar()).getByRole('button', { name: /^Emma · 1×$/ }))
    const pop = await screen.findByRole('dialog', { name: 'Choose a voice' })
    for (const r of within(pop).getAllByRole('radio'))
      expect(r.classList.contains('btn-primary')).toBe(false)
  })
})
