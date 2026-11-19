// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ReadingView } from '../../src/shared/library/types'
import { anchorOf, resolveAnchor, type Anchor } from '../../src/shared/text/anchor'
import { extractPages } from '../../src/shared/text/extract'
import { buildSentences } from '../../src/shared/text/pipeline'
import { DEFAULT_FILTERS, READ_EVERYTHING } from '../../src/shared/text/types'
import type { PageText } from '../../src/shared/text/types'
import {
  bodyPages,
  fakeDeps,
  fakeDoc,
  FakeSink,
  fakePlayer,
  PAGE_W,
  renderApp,
  SILENCE
} from './reader-fakes'
import { fakeTide } from './setup'

const reading: ReadingView = {
  id: 'r1',
  title: 'Memory and Attention',
  courseId: null,
  pageCount: 10,
  position: null,
  addedAt: 5,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  fileName: 'r1.pdf',
  missing: false
}

/** CSS px per PDF point in jsdom: the column falls back to 820 px, at 100% text size. */
const SCALE = 820 / PAGE_W

let lastSink: FakeSink

async function openWith(
  pages: PageText[],
  over: Partial<ReadingView> = {}
): Promise<ReturnType<typeof fakeTide>> {
  const t = fakeTide({
    snapshot: {
      readings: [{ ...reading, pageCount: pages.length, ...over }],
      settings: { reading: DEFAULT_FILTERS, zoom: 1, voice: 'bf_emma', speed: 1 }
    }
  })
  setTide(t)
  t.tts.synthesize = () => Promise.resolve(SILENCE)
  const player = fakePlayer()
  lastSink = player.sink
  renderApp(fakeDeps({ kind: 'ok', doc: fakeDoc(pages) }), player.deps)
  await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
  return t
}

const highlights = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sentence-highlight"]'))
const highlightId = (): string | undefined => highlights()[0]?.dataset.sentenceId
const positions = (t: ReturnType<typeof fakeTide>): Anchor[] =>
  (t.calls['library.update'] ?? [])
    .map((c) => (c[1] as { position?: Anchor }).position)
    .filter((p): p is Anchor => !!p)
const sentencesOf = (
  pages: PageText[],
  filters = DEFAULT_FILTERS
): ReturnType<typeof buildSentences>['sentences'] => buildSentences(pages, filters).sentences
const fixturePages = (name: string): Promise<PageText[]> =>
  extractPages(readFileSync(join(__dirname, '../fixtures/pdfs', name)))

async function waitForId(id: string): Promise<void> {
  // Waits on the condition; the generous limit only matters under full-suite load.
  await waitFor(() => expect(highlightId()).toBe(id), { timeout: 10_000 })
}

const realScroll = Element.prototype.scrollIntoView

describe('Reader highlight, stepping and resume', () => {
  afterEach(() => {
    Element.prototype.scrollIntoView = realScroll
  })

  it('opens at the first sentence when there is no saved place', async () => {
    const t = await openWith(bodyPages(10))
    await waitForId('0')
    // Nothing moved, so nothing is written.
    expect(positions(t)).toEqual([])
  })

  it('opens at the saved place and scrolls it into view', async () => {
    const pages = bodyPages(10)
    const s = sentencesOf(pages)
    const scrolls: Array<[Element, unknown]> = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolls.push([this, arg])
    }
    await openWith(pages, { position: anchorOf(s[2]) })
    await waitForId('2')
    expect(
      document.querySelector('[data-page="2"] [data-testid="sentence-highlight"]')
    ).toBeTruthy()
    // The scroll follows the highlight; wait for it rather than assume it has happened.
    await waitFor(
      () => {
        const last = scrolls.at(-1)
        expect((last?.[0] as HTMLElement | undefined)?.dataset.testid).toBe('sentence-highlight')
        expect(last?.[1]).toEqual({ block: 'center', behavior: 'auto' })
      },
      { timeout: 10_000 }
    )
  })

  it('→ skips 15 s ahead and saves the new place; ← skips back; both stop at the ends', async () => {
    // Four sentences of about 2.3 s each: 15 s ahead is the end of the reading, 15 s back is its start.
    const pages = bodyPages(2)
    const s = sentencesOf(pages)
    const t = await openWith(pages)
    await waitForId('0')
    await userEvent.keyboard('{ArrowLeft}')
    await waitForId('0')
    await userEvent.keyboard('{ArrowRight}')
    await waitForId('3')
    expect(positions(t).at(-1)).toEqual(anchorOf(s[3]))
    await userEvent.keyboard('{ArrowRight}')
    await waitForId('3')
    await userEvent.keyboard('{ArrowLeft}')
    await waitForId('0')
    expect(positions(t).at(-1)).toEqual(anchorOf(s[0]))
  })

  it('clicking on a sentence selects it', async () => {
    const pages = bodyPages(2)
    const s = sentencesOf(pages)
    const t = await openWith(pages)
    await waitForId('0')
    // Second line of page 1 (baseline 114 pt, 12 pt text).
    fireEvent.click(document.querySelector('[data-page="1"]')!, {
      clientX: 100 * SCALE,
      clientY: 110 * SCALE
    })
    await waitForId('1')
    expect(positions(t).at(-1)).toEqual(anchorOf(s[1]))
    // Far from any text: nothing changes.
    fireEvent.click(document.querySelector('[data-page="1"]')!, {
      clientX: 500 * SCALE,
      clientY: 700 * SCALE
    })
    await waitForId('1')
  })

  it('arrow keys do nothing while typing in a dialog field', async () => {
    await openWith(bodyPages(2))
    await waitForId('0')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    dialog.append(input)
    document.body.append(dialog)
    try {
      input.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(highlightId()).toBe('0')
      // A bare field (no dialog around it) is left alone too.
      dialog.removeAttribute('role')
      await userEvent.keyboard('{ArrowRight}')
      expect(highlightId()).toBe('0')
      // And an open dialog stops the keys wherever focus is.
      dialog.setAttribute('role', 'dialog')
      input.blur()
      await userEvent.keyboard('{ArrowRight}')
      expect(highlightId()).toBe('0')
      dialog.remove()
      await userEvent.keyboard('{ArrowRight}')
      await waitForId('3')
    } finally {
      dialog.remove()
    }
  })

  it('turning on Read everything keeps the place', async () => {
    const pages = await fixturePages('cover-refs.pdf')
    const before = sentencesOf(pages)
    const everything = sentencesOf(pages, READ_EVERYTHING)
    const at = before.findIndex((x) => x.spans[0].page === 4)
    expect(at).toBeGreaterThan(0)
    const t = await openWith(pages, { position: anchorOf(before[at]) })
    await waitForId(String(at))
    const where = (): string[] => highlights().map((h) => `${h.style.left},${h.style.top}`)
    const place = where()
    await userEvent.click(screen.getByRole('button', { name: /^More options/ }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Read everything/ }))
    const shifted = everything.findIndex(
      (x) => JSON.stringify(anchorOf(x)) === JSON.stringify(anchorOf(before[at]))
    )
    // The cover and contents are read now, so the same sentence has a later index.
    expect(shifted).toBeGreaterThan(at)
    await waitForId(String(shifted))
    expect(where()).toEqual(place)
    expect(positions(t).at(-1)).toEqual(anchorOf(before[at]))
  })

  it('turning Read everything off from past the end of the shorter list keeps the place', async () => {
    const pages = await fixturePages('cover-refs.pdf')
    const shorter = sentencesOf(pages)
    const everything = sentencesOf(pages, READ_EVERYTHING)
    expect(everything.length).toBeGreaterThan(shorter.length)
    const last = anchorOf(everything[everything.length - 1])
    const t = await openWith(pages, { position: last, readEverything: true })
    await waitForId(String(everything.length - 1))
    await userEvent.click(screen.getByRole('button', { name: /^More options/ }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Read everything/ }))
    const resolved = resolveAnchor(shorter, last)
    await waitForId(String(resolved))
    // Exactly one write, the re-resolved anchor: no stale index into the new list.
    expect(positions(t)).toEqual([anchorOf(shorter[resolved])])
  })

  it('a click after opening does not force a centred scroll', async () => {
    const scrolls: unknown[] = []
    Element.prototype.scrollIntoView = function (arg?: unknown) {
      scrolls.push(arg)
    }
    await openWith(bodyPages(2))
    await waitForId('0')
    scrolls.length = 0
    fireEvent.click(document.querySelector('[data-page="1"]')!, {
      clientX: 100 * SCALE,
      clientY: 110 * SCALE
    })
    await waitForId('1')
    expect(scrolls).toEqual([])
  })

  it('→ follows reading order down the left column, then the right, on two-column.pdf', async () => {
    const pages = await fixturePages('two-column.pdf')
    const total = sentencesOf(pages).length
    await openWith(pages)
    await waitForId('0')
    // Play steps one sentence at a time as each clip ends.
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    // First rect of each sentence in PDF points: [page, x]. Left column x < 288, right x >= 324.
    const firsts: Array<[number, number]> = []
    for (let i = 0; i < total; i++) {
      await waitForId(String(i))
      const h = highlights()[0]
      const page = Number((h.closest('[data-page]') as HTMLElement).dataset.page)
      firsts.push([page, parseFloat(h.style.left) / SCALE])
      if (i < total - 1) {
        await waitFor(() => expect(lastSink.playing).toBe(true))
        act(() => lastSink.end())
      }
    }
    for (let p = 1; p <= pages.length; p++) {
      const kind = firsts
        .filter(([pg]) => pg === p)
        .map(([, x]) => (x < 288 ? 'L' : x >= 324 ? 'R' : 'M'))
        .join('')
      // Never a right-column sentence before a left-column one.
      expect(kind, `page ${p}`).toMatch(/^[LM]*R*$/)
      expect(kind, `page ${p}`).toMatch(/L/)
      expect(kind, `page ${p}`).toMatch(/R/)
    }
    expect(firsts.map(([p]) => p)).toEqual(firsts.map(([p]) => p).sort((a, b) => a - b))
    // Real pdf.js extraction plus a step through every sentence: ~3.3 s alone, over 5 s under full-suite load.
  }, 20_000)
})
