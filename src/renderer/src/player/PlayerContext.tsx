import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { TtsStatus } from '../../../shared/ipc-types'
import type { LibrarySnapshot, ReadingId, ReadingView } from '../../../shared/library/types'
import { DEFAULT_VOICE } from '../../../shared/voices'
import { tide } from '../lib/tide'
import { useReaderState } from '../reader/ReaderState'
import { PlayerEngine, type AudioSink, type PlayerSnapshot, type TtsClient } from './engine'
import { HtmlAudioSink } from './sink'

/** How long her own scrolling keeps the highlight from pulling the page back. */
export const HANDS_OFF_MS = 5000
const SKIP_SEC = 15

/** Test seams: a sink and URL functions that need no media playback. */
export interface PlayerDeps {
  makeSink?(el: HTMLAudioElement): AudioSink
  makeUrl?(wav: ArrayBuffer): string
  revokeUrl?(url: string): void
  /** The preview-only audio element; tests give it one that needs no media playback. */
  makePreview?(url: string): PreviewAudio
}

/** The little a preview needs from an audio element. */
export interface PreviewAudio {
  play(): Promise<void> | void
  pause(): void
}
const DepsCtx = createContext<PlayerDeps>({})
export const PlayerDepsProvider = DepsCtx.Provider

export interface PlayerValue {
  snapshot: PlayerSnapshot
  play(): void
  pause(): void
  toggle(): void
  skip(deltaSec: number): void
  /** Seek to a sentence and play. */
  readFrom(index: number): void
  setVoice(id: string): void
  setSpeed(s: number): void
  /** Pause the reading (it stays paused) and play the bundled sample of a voice. */
  preview(id: string): void
  /** Estimated seconds to read sentences fromIndex..toIndex inclusive, at the current speed. */
  estimateSec(fromIndex: number, toIndex: number): number
}

const IDLE: PlayerSnapshot = {
  phase: 'idle',
  index: null,
  voice: DEFAULT_VOICE,
  speed: 1,
  secondsLeft: null
}

const NOOP: PlayerValue = {
  snapshot: IDLE,
  play: () => {},
  pause: () => {},
  toggle: () => {},
  skip: () => {},
  readFrom: () => {},
  setVoice: () => {},
  setSpeed: () => {},
  preview: () => {},
  estimateSec: () => 0
}

const PlayerCtx = createContext<PlayerValue>(NOOP)

/** The engine's view of the preload TTS API. The latest status is cached and read synchronously (R6). */
function createTtsClient(): { client: TtsClient; dispose(): void } {
  let cached: TtsStatus | null = null
  const listeners = new Set<(s: TtsStatus) => void>()
  const seed = tide()
    .tts.status()
    .then((s) => {
      cached ??= s
    })
    .catch(() => undefined)
  const unsub = tide().tts.onStatus((s) => {
    cached = s
    for (const cb of [...listeners]) cb(s)
  })
  const client: TtsClient = {
    synthesize: (text, o) => tide().tts.synthesize(text, o),
    cancel: (gen) => {
      void tide().tts.cancel(gen)
    },
    status: () =>
      cached !== null ? Promise.resolve(cached) : seed.then(() => cached ?? ('ready' as const)),
    onStatus: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
  return { client, dispose: unsub }
}

/** Keys that belong to a dialog, a field or a menu are never the player's. */
function leavesKeysAlone(e: KeyboardEvent, own: string): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true
  const t = e.target as HTMLElement | null
  return !!t?.closest(
    `input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]${own}`
  )
}

type Props = {
  reading: ReadingView | null
  courseName: string | null
  snapshot: LibrarySnapshot | null
  onPlayNext(id: ReadingId): void
  children: ReactNode
}

/** Sits inside ReaderStateProvider. One engine, bound both ways to the reader's current sentence. */
export function PlayerProvider({ reading, snapshot, children }: Props): React.JSX.Element {
  const deps = useContext(DepsCtx)
  const { sentences, current, setCurrent } = useReaderState()
  const audio = useRef<HTMLAudioElement>(null)
  const [engine, setEngine] = useState<PlayerEngine | null>(null)
  const [snap, setSnap] = useState<PlayerSnapshot>(IDLE)

  const voice = snapshot?.settings.voice ?? DEFAULT_VOICE
  const speed = snapshot?.settings.speed ?? 1
  // The engine is made once; later voice and speed come through the effect below.
  const initial = useRef({ voice, speed })

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const { client, dispose } = createTtsClient()
    const e = new PlayerEngine(
      {
        sink: deps.makeSink ? deps.makeSink(el) : new HtmlAudioSink(el),
        tts: client,
        makeUrl:
          deps.makeUrl ?? ((wav) => URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))),
        revokeUrl: deps.revokeUrl ?? ((u) => URL.revokeObjectURL(u))
      },
      initial.current.voice,
      initial.current.speed
    )
    setEngine(e)
    setSnap(e.snapshot())
    const off = e.subscribe(setSnap)
    return () => {
      off()
      e.dispose()
      dispose()
      setEngine(null)
    }
    // The test seams are fixed for the life of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A change made elsewhere (or confirmed by main) reaches the engine; the engine ignores no-ops.
  useEffect(() => {
    engine?.setVoice(voice)
    engine?.setSpeed(speed)
  }, [engine, voice, speed])

  // --- Reader -> engine ---------------------------------------------------------------------
  /** The index the engine last pushed to the reader: its echo must not seek the engine back. */
  const pushed = useRef<number | null>(null)
  const readingId = reading?.id ?? null

  // Another reading: stop, and save the old place.
  useEffect(() => {
    engine?.setSentences([], null)
    pushed.current = null
    void tide()
      .library.flush()
      .catch(() => {})
  }, [engine, readingId])

  /** The list was rebuilt (not opened or switched) while she was listening: carry on afterwards. */
  const resume = useRef(false)
  const prevCount = useRef(0)
  useEffect(() => {
    if (!engine) return
    pushed.current = null
    const ph = engine.snapshot().phase
    const wasListening = ph === 'playing' || ph === 'buffering' || ph === 'loading-voice'
    resume.current = wasListening && prevCount.current > 0 && sentences.length > 0
    prevCount.current = sentences.length
    engine.setSentences(
      sentences.map((s) => s.text),
      null
    )
  }, [engine, sentences])

  // A click (or any other reader-side change) of the current sentence moves the engine.
  useEffect(() => {
    if (!engine || current === null || sentences.length === 0) return
    // The echo of the engine's own move is consumed here; a later click on that sentence is a seek.
    const echo = pushed.current
    pushed.current = null
    if (current !== echo && current !== engine.snapshot().index) engine.setIndex(current)
    if (resume.current) {
      resume.current = false
      engine.play()
    }
  }, [engine, sentences, current])

  // --- Engine -> reader ---------------------------------------------------------------------
  useEffect(() => {
    if (snap.index === null || snap.index === current) return
    pushed.current = snap.index
    setCurrent(snap.index)
    // Only the engine's own moves are pushed; `current` is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.index, setCurrent])

  const phase = snap.phase
  const prevPhase = useRef(phase)
  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = phase
    if ((phase === 'playing') !== (was === 'playing')) tide().app.setPlaying(phase === 'playing')
    if (phase === 'paused' || (was === 'playing' && phase !== 'playing'))
      void tide()
        .library.flush()
        .catch(() => {})
  }, [phase])
  useEffect(
    () => () => {
      tide().app.setPlaying(false)
    },
    []
  )

  // --- Preview: a second element, so the reading's own audio is never touched -----------------
  const previewing = useRef<PreviewAudio | null>(null)
  const stopPreview = useCallback(() => {
    previewing.current?.pause()
    previewing.current = null
  }, [])
  useEffect(() => stopPreview, [stopPreview])

  // --- Actions ------------------------------------------------------------------------------
  const value = useMemo<PlayerValue>(
    () => ({
      snapshot: snap,
      play: () => engine?.play(),
      pause: () => engine?.pause(),
      toggle: () => engine?.toggle(),
      skip: (d) => engine?.skip(d),
      readFrom: (i) => {
        if (!engine) return
        engine.setIndex(i)
        engine.play()
      },
      setVoice: (id) => {
        if (!engine) return
        engine.setVoice(id)
        void tide()
          .library.setVoice(id, engine.snapshot().speed)
          .catch(() => {})
      },
      setSpeed: (s) => {
        if (!engine) return
        engine.setSpeed(s)
        void tide()
          .library.setVoice(engine.snapshot().voice, s)
          .catch(() => {})
      },
      preview: (id) => {
        const ph = engine?.snapshot().phase
        if (ph === 'playing' || ph === 'buffering' || ph === 'loading-voice') engine?.pause()
        stopPreview()
        const url = `./voice-previews/${id}.mp3`
        const a = deps.makePreview ? deps.makePreview(url) : new Audio(url)
        previewing.current = a
        void Promise.resolve(a.play()).catch(() => {})
      },
      estimateSec: (from, to) => {
        if (!engine) return 0
        let sum = 0
        for (let i = Math.max(0, from); i <= to; i++)
          sum += engine.timeline.durationOf(i, snap.speed)
        return sum
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is a fixed test seam
    [engine, snap, stopPreview]
  )

  // --- Keys: ← / → skip 15 s, Space plays and pauses ------------------------------------------
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })
  const hasText = sentences.length > 0
  /** Space was ours on keydown, so its keyup must not click the focused button. */
  const spaceHandled = useRef(false)
  const onKey = useCallback(
    (e: KeyboardEvent): void => {
      const space = e.key === ' '
      if (!space && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!hasText) return
      // Space on a button, link or field does its own thing.
      if (leavesKeysAlone(e, space ? ', footer[aria-label="Player"] button' : '')) return
      e.preventDefault()
      if (space) {
        spaceHandled.current = true
        if (!e.repeat) latest.current.toggle()
      } else latest.current.skip(e.key === 'ArrowRight' ? SKIP_SEC : -SKIP_SEC)
    },
    [hasText]
  )
  useEffect(() => {
    const onUp = (e: KeyboardEvent): void => {
      if (e.key !== ' ' || !spaceHandled.current) return
      spaceHandled.current = false
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onUp)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onUp)
    }
  }, [onKey])

  return (
    <PlayerCtx.Provider value={value}>
      {children}
      <audio ref={audio} hidden />
    </PlayerCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function usePlayer(): PlayerValue {
  return useContext(PlayerCtx)
}
