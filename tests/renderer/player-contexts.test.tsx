// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTide } from '../../src/renderer/src/lib/tide'
import {
  PlayerDepsProvider,
  PlayerProvider,
  usePlayerActions,
  useSleep
} from '../../src/renderer/src/player/PlayerContext'
import { ReaderStateProvider, useReportReader } from '../../src/renderer/src/reader/ReaderState'
import { ToastProvider } from '../../src/renderer/src/shell/Toast'
import { buildSentences } from '../../src/shared/text/pipeline'
import { DEFAULT_FILTERS } from '../../src/shared/text/types'
import { bodyPages, fakePlayer, SILENCE } from './reader-fakes'
import { fakeTide } from './setup'

interface Probe {
  renders: number
  actions: ReturnType<typeof usePlayerActions> | null
  sleep: ReturnType<typeof useSleep> | null
}
const probe: Probe = { renders: 0, actions: null, sleep: null }

/** Reports sentences to the reader state so the engine has something to play. */
function Feeder(): null {
  const report = useReportReader()
  useEffect(() => {
    report({
      sentences: buildSentences(bodyPages(2), DEFAULT_FILTERS).sentences,
      topPage: 1,
      numPages: 2
    })
  }, [report])
  return null
}

function ActionsOnly({ seen }: { seen: (a: ReturnType<typeof usePlayerActions>) => void }): null {
  const actions = usePlayerActions()
  useEffect(() => {
    seen(actions)
  })
  return null
}

function SleepReader({ seen }: { seen: (s: ReturnType<typeof useSleep>) => void }): null {
  const sleep = useSleep()
  useEffect(() => {
    seen(sleep)
  })
  return null
}

async function mount(): Promise<void> {
  const t = fakeTide()
  t.tts.synthesize = vi.fn(() => Promise.resolve(SILENCE))
  t.tts.status = () => Promise.resolve('ready' as const)
  setTide(t)
  const p = fakePlayer()
  render(
    <PlayerDepsProvider value={{ ...p.deps, now: () => Date.now() }}>
      <ReaderStateProvider>
        <ToastProvider>
          <PlayerProvider reading={null} courseName={null} snapshot={null} onPlayNext={() => {}}>
            <Feeder />
            <ActionsOnly
              seen={(a) => {
                probe.renders += 1
                probe.actions = a
              }}
            />
            <SleepReader
              seen={(v) => {
                probe.sleep = v
              }}
            />
          </PlayerProvider>
        </ToastProvider>
      </ReaderStateProvider>
    </PlayerDepsProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe('player contexts', () => {
  afterEach(() => {
    vi.useRealTimers()
    probe.renders = 0
    probe.actions = null
    probe.sleep = null
  })

  it('an actions-only consumer does not re-render while the sleep timer counts down', async () => {
    vi.useFakeTimers()
    await mount()
    await act(async () => {
      probe.actions?.readFrom(0)
      await vi.advanceTimersByTimeAsync(50)
    })
    act(() => probe.actions?.setSleep(10))
    const rendersBefore = probe.renders
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(probe.renders - rendersBefore).toBe(0)
  })

  it('a useSleep consumer sees secondsLeft fall', async () => {
    vi.useFakeTimers()
    await mount()
    await act(async () => {
      probe.actions?.readFrom(0)
      await vi.advanceTimersByTimeAsync(50)
    })
    act(() => probe.actions?.setSleep(10))
    const secondsLeftBefore = probe.sleep?.remainingSec ?? 0
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    const secondsLeftAfter = probe.sleep?.remainingSec ?? 0
    expect(secondsLeftBefore).toBeGreaterThan(0)
    expect(secondsLeftAfter).toBeLessThan(secondsLeftBefore)
  })
})
