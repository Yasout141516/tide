// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import { useLibrary } from '../../src/renderer/src/state/useLibrary'
import { setTide } from '../../src/renderer/src/lib/tide'
import type { ReadingView } from '../../src/shared/library/types'
import { fakeTide } from './setup'

const r1: ReadingView = {
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

describe('App library wiring', () => {
  it('tells main it is ready once, shows the empty stage with no readings, and opens nothing', async () => {
    const t = fakeTide()
    setTide(t)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your shelf is empty' })).toBeTruthy()
    expect(t.calls['ready']).toHaveLength(1)
    expect(t.calls['library.update']).toBeUndefined()
  })

  it('with readings but nothing open the stage invites a pick; picking stamps opened once', async () => {
    const t = fakeTide({ snapshot: { readings: [r1] } })
    setTide(t)
    render(<App />)
    expect(await screen.findByText('Pick a reading from your shelf to carry on.')).toBeTruthy()
    expect(t.calls['library.update']).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: /^Memory and Attention/ }))
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
    expect(screen.getByRole('heading', { level: 2, name: 'Memory and Attention' })).toBeTruthy()
  })

  it('asks main for the library once across re-renders, and re-picking the open reading does not re-stamp', async () => {
    const t = fakeTide({ snapshot: { readings: [r1, { ...r1, id: 'r2', title: 'Other one' }] } })
    setTide(t)
    render(<App />)
    await screen.findByText('Pick a reading from your shelf to carry on.')
    await userEvent.click(screen.getByRole('button', { name: /^Memory and Attention/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Memory and Attention/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Other one/ }))
    expect(t.calls['library.get']).toHaveLength(1)
    expect(t.calls['library.update']).toEqual([
      ['r1', { opened: true }],
      ['r2', { opened: true }]
    ])
  })

  it('does not stamp opened for a reading whose file is missing', async () => {
    const t = fakeTide({ snapshot: { readings: [{ ...r1, missing: true }] } })
    setTide(t)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    expect(t.calls['library.update']).toBeUndefined()
  })

  it('a selected reading that stops being missing is stamped on its next click', async () => {
    const t = fakeTide({ snapshot: { readings: [{ ...r1, missing: true }] } })
    setTide(t)
    render(<App />)
    const pick = async (): Promise<void> =>
      userEvent.click(await screen.findByRole('button', { name: /^Memory and Attention/ }))
    await pick()
    // A missing reading asks "Where did this one go?" and is not stamped; dismiss it.
    expect(await screen.findByRole('dialog', { name: 'Where did this one go?' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(t.calls['library.update']).toBeUndefined()
    // Relinked (Task 9's flow): the fake's update merges raw fields, so it can clear `missing`.
    await act(async () => {
      await t.library.update('r1', { missing: false } as never)
    })
    const before = t.calls['library.update'].length
    await pick()
    expect(t.calls['library.update'].slice(before)).toEqual([['r1', { opened: true }]])
  })
})

describe('useLibrary store', () => {
  it('applies a fresh get after a full unsubscribe and resubscribe', async () => {
    const t = fakeTide({ snapshot: { readings: [r1] } })
    setTide(t)
    const first = renderHook(() => useLibrary())
    await act(async () => {})
    expect(first.result.current?.readings.map((r) => r.id)).toEqual(['r1'])
    first.unmount()
    // Changes while nobody is subscribed are not pushed to the store.
    await t.library.add({ pickId: 'p', title: 'Added later', pageCount: 3, course: null })
    const second = renderHook(() => useLibrary())
    await act(async () => {})
    expect(second.result.current?.readings.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(t.calls['library.get']).toHaveLength(2)
  })
})
