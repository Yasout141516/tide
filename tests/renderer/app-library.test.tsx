// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
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
    await userEvent.click(screen.getByRole('button', { name: /Memory and Attention/ }))
    expect(t.calls['library.update']).toEqual([['r1', { opened: true }]])
    expect(screen.getByRole('heading', { level: 2, name: 'Memory and Attention' })).toBeTruthy()
  })
})
