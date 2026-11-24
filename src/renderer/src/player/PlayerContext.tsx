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
import { DEFAULT_VOICE, voiceRate } from '../../../shared/voices'
import { nextReading } from '../../../shared/library/shelf'
import { leavesKeysAlone } from '../lib/keys'
import { useLatest } from '../lib/useLatest'
import { tide } from '../lib/tide'
import { useReaderState } from '../reader/ReaderState'
import { useToast } from '../shell/Toast'
import { bindMediaSession } from './media-session'
import {
  PlayerEngine,
  isListening,
  type AudioSink,
  type PlayerSnapshot,
  type TtsClient
} from './engine'
import { finishInLabel, finishInSpeed, readingSeconds } from './finish-in'
import { HtmlAudioSink } from './sink'
import { SleepTimer, type SleepOption, type SleepState } from './sleep'

const SKIP_SEC = 15
/** How often the sleep timer is told the time. */
const SLEEP_TICK_MS = 250

/** Test seams: a sink and URL functions that need no media playback. */
export interface PlayerDeps {
  makeSink?(el: HTMLAudioElement): AudioSink
  makeUrl?(wav: ArrayBuffer): string
  revokeUrl?(url: string): void
  /** The preview-only audio element; tests give it one that needs no media playback. */
  makePreview?(url: string): PreviewAudio
  /** Milliseconds on a monotonic clock; tests drive the sleep timer with their own. */
  now?(): number
}

/** The little a preview needs from an audio element. */
export interface PreviewAudio {
  play(): Promise<void> | void
  pause(): void
  /** Tell the owner the clip finished on its own. */
  onEnded?(cb: () => void): void
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
  /** Her own speed choice (one of SPEEDS); `snapshot.speed` is the effective one, raised by Finish in…. */
  chosenSpeed: number
  /** The Finish in… estimate, shown for a few seconds after the limit is set. */
  finishNote: string | null
  /** Pause the reading (it stays paused) and play the bundled sample of a voice. */
  preview(id: string): void
  /** Stop a running preview (the popover closing). */
  stopPreview(): void
  /** Estimated seconds to read sentences fromIndex..toIndex inclusive, at the current speed. */
  estimateSec(fromIndex: number, toIndex: number): number
  /** The sleep timer: its option and the seconds left (null for page, reading and off). */
  sleep: SleepState
  setSleep(o: SleepOption): void
  /** Set once the reading has ended: the reading to offer next, if any. Cleared by Dismiss or Play. */
  finished: { next: ReadingView | null } | null
  /** Open the offered next reading and play it once its sentences arrive. */
  playNext(): void
  dismissFinished(): void
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
  chosenSpeed: 1,
  finishNote: null,
  preview: () => {},
  stopPreview: () => {},
  estimateSec: () => 0,
  sleep: { option: 'off', remainingSec: null },
  setSleep: () => {},
  finished: null,
  playNext: () => {},
  dismissFinished: () => {}
}

const PlayerCtx = createContext<PlayerValue>(NOOP)

/** A preview on a plain audio element of its own. */
function htmlPreview(url: string): PreviewAudio {
  const el = new Audio(url)
  return {
    play: () => el.play(),
    pause: () => el.pause(),
    onEnded: (cb) => el.addEventListener('ended', cb)
  }
}

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

type Props = {
  reading: ReadingView | null
  courseName: string | null
  snapshot: LibrarySnapshot | null
  /** Opens the reading; false when it did not open (so no autoplay may stay armed for it). */
  onPlayNext(id: ReadingId): boolean | void
  children: ReactNode
}

/** Sits inside ReaderStateProvider. One engine, bound both ways to the reader's current sentence. */
export function PlayerProvider({
  reading,
  courseName,
  snapshot,
  onPlayNext,
  children
}: Props): React.JSX.Element {
  const deps = useContext(DepsCtx)
  const { sentences, current, setCurrent } = useReaderState()
  const audio = useRef<HTMLAudioElement>(null)
  const [engine, setEngine] = useState<PlayerEngine | null>(null)
  const [snap, setSnap] = useState<PlayerSnapshot>(IDLE)
  const sentencesRef = useLatest(sentences)
  const [timer, setTimer] = useState<SleepTimer | null>(null)
  const [offer, setOffer] = useState<{ next: ReadingView | null; dismissed: boolean } | null>(null)
  /** What happens once, the moment the reading runs out. Kept current each render. */
  const onFinished = useRef<() => void>(() => {})
  const sinkRef = useRef<AudioSink | null>(null)
  const toast = useToast()
  const latestProps = useLatest({ snapshot, onPlayNext, toast })
  /** The reading to play once its sentences arrive (Play next only; opening never autoplays). */
  const autoplayFor = useRef<ReadingId | null>(null)
  /** The sentences on screen when the reading changed: they still belong to the old reading. */
  const staleSentences = useRef(sentences)
  const [sleep, setSleepState] = useState<SleepState>({ option: 'off', remainingSec: null })

  const voice = snapshot?.settings.voice ?? DEFAULT_VOICE
  const speed = snapshot?.settings.speed ?? 1
  const finishIn = reading?.finishIn ?? null
  // Finish in…: the speed that fits the whole reading, from this voice's rate. Speeds up only.
  const texts = useMemo(() => sentences.map((s) => s.text), [sentences])
  const fin = useMemo(
    () =>
      finishIn === null || texts.length === 0
        ? null
        : finishInSpeed(readingSeconds(texts, voiceRate(voice)), finishIn),
    [finishIn, voice, texts]
  )
  const effectiveSpeed = Math.max(speed, fin?.speed ?? 1)
  const finRef = useLatest({ fin, finishIn })
  // The estimate shows for 5 s after the limit is set (not when a reading merely opens with one).
  const [finishNote, setFinishNote] = useState<string | null>(null)
  const [seenFinish, setSeenFinish] = useState({ id: reading?.id ?? null, finishIn })
  if (seenFinish.id !== (reading?.id ?? null) || seenFinish.finishIn !== finishIn) {
    setSeenFinish({ id: reading?.id ?? null, finishIn })
    const set = seenFinish.id === (reading?.id ?? null) && finishIn !== null && fin !== null
    setFinishNote(set ? finishInLabel(fin, finishIn) : null)
  }
  useEffect(() => {
    if (finishNote === null) return
    const id = setTimeout(() => setFinishNote(null), 5000)
    return () => clearTimeout(id)
  }, [finishNote])

  // The engine is made once; later voice and speed come through the effect below.
  const initial = useRef({ voice, speed })

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const { client, dispose } = createTtsClient()
    const audioSink = deps.makeSink ? deps.makeSink(el) : new HtmlAudioSink(el)
    sinkRef.current = audioSink
    let tm: SleepTimer | null = null
    const e = new PlayerEngine(
      {
        sink: audioSink,
        tts: client,
        makeUrl:
          deps.makeUrl ?? ((wav) => URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))),
        revokeUrl: deps.revokeUrl ?? ((u) => URL.revokeObjectURL(u)),
        // The page option stops exactly at the sentence boundary, not on the next poll.
        holdAfter: (i) =>
          tm?.sentenceEnded(i, (k) => sentencesRef.current[k]?.spans[0]?.page ?? -1) ?? false
      },
      initial.current.voice,
      initial.current.speed
    )
    // A fade moves the engine's own sink (never the preview); a stop is a pause, which flushes.
    const sleepTimer = new SleepTimer(
      (v) => {
        audioSink.volume = v
      },
      () => {
        e.pause()
        audioSink.volume = 1
      }
    )
    tm = sleepTimer
    const offSleep = sleepTimer.subscribe(() => {
      const st = sleepTimer.state
      const remainingSec = st.remainingSec === null ? null : Math.ceil(st.remainingSec)
      setSleepState((prev) =>
        prev.option === st.option && prev.remainingSec === remainingSec
          ? prev
          : { option: st.option, remainingSec }
      )
    })
    setEngine(e)
    setTimer(sleepTimer)
    setSnap(e.snapshot())
    let lastPhase = e.snapshot().phase
    const off = e.subscribe((s) => {
      setSnap(s)
      if (s.phase === 'finished' && lastPhase !== 'finished') onFinished.current()
      lastPhase = s.phase
    })
    return () => {
      off()
      offSleep()
      setTimer(null)
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
    engine?.setSpeed(effectiveSpeed)
  }, [engine, voice, effectiveSpeed])

  // --- Reader -> engine ---------------------------------------------------------------------
  /** The index the engine last pushed to the reader: its echo must not seek the engine back. */
  const pushed = useRef<number | null>(null)
  const readingId = reading?.id ?? null

  // Another reading: stop, and save the old place.
  useEffect(() => {
    pushed.current = null
    staleSentences.current = sentencesRef.current
    if (autoplayFor.current !== readingId) autoplayFor.current = null
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
    resume.current = isListening(ph) && prevCount.current > 0 && sentences.length > 0
    prevCount.current = sentences.length
    // Play next: this is the first list the new reading has reported, so it plays from the start.
    if (
      autoplayFor.current !== null &&
      autoplayFor.current === readingId &&
      sentences !== staleSentences.current &&
      sentences.length > 0
    ) {
      autoplayFor.current = null
      resume.current = true
    }
    engine.setSentences(texts, null)
    // The reading id is read, not watched: a new reading changes `sentences` when its text arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const finished = phase === 'finished' && offer && !offer.dismissed ? offer : null
  useEffect(() => {
    onFinished.current = () => {
      // Whatever the timer was doing, the reading is over: it is off, and a fade never outlasts it.
      timer?.set('off', 0)
      if (sinkRef.current) sinkRef.current.volume = 1
      if (readingId === null) {
        setOffer(null)
        return
      }
      const lib = latestProps.current.snapshot
      setOffer({ next: lib ? nextReading(lib, readingId) : null, dismissed: false })
      void tide()
        .library.update(readingId, { finished: true })
        .catch(() => {})
    }
  })
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

  // --- Sleep timer: counts real time while playing, fades the engine's own sink, then pauses ----
  const sleepOn = sleep.option !== 'off'
  const nowFn = deps.now
  useEffect(() => {
    if (!sleepOn || !engine || !timer) return
    const now = nowFn ?? (() => performance.now())
    let last = now()
    const pageOf = (i: number): number => sentencesRef.current[i]?.spans[0]?.page ?? -1
    const id = setInterval(() => {
      const t = now()
      const elapsed = Math.max(0, (t - last) / 1000)
      last = t
      const s = engine.snapshot()
      const playing = s.phase === 'playing'
      timer.tick(elapsed, playing)
      if (playing && s.index !== null) {
        const left = engine.timeline.durationOf(s.index, s.speed) - engine.offsetSec()
        timer.sentenceEnding(s.index, pageOf, Math.max(0, left))
      }
    }, SLEEP_TICK_MS)
    return () => clearInterval(id)
  }, [sleepOn, engine, timer, nowFn])

  // Another reading starts with the timer off.
  useEffect(() => {
    timer?.set('off', 0)
  }, [readingId, timer])

  // --- Preview: a second element, so the reading's own audio is never touched -----------------
  const previewing = useRef<PreviewAudio | null>(null)
  const stopPreview = useCallback(() => {
    previewing.current?.pause()
    previewing.current = null
  }, [])
  useEffect(() => stopPreview, [stopPreview])

  // --- Crash toasts: the voice engine restarting, or given up on ------------------------------
  useEffect(
    () =>
      tide().tts.onStatus((st) => {
        const { toast: t } = latestProps.current
        if (st === 'restarting') t.show({ text: 'The voice stopped unexpectedly. Restarting…' })
        else if (st === 'failed')
          t.show({
            text: 'The voice stopped unexpectedly.',
            actions: [{ label: 'Restart Tide', onClick: () => tide().app.relaunch() }],
            ms: Infinity
          })
      }),
    []
  )

  // --- Actions ------------------------------------------------------------------------------
  const value = useMemo<PlayerValue>(
    () => ({
      snapshot: snap,
      play: () => {
        autoplayFor.current = null
        stopPreview()
        engine?.play()
      },
      pause: () => {
        autoplayFor.current = null
        engine?.pause()
      },
      toggle: () => {
        autoplayFor.current = null
        const ph = engine?.snapshot().phase
        if (!isListening(ph)) stopPreview()
        engine?.toggle()
      },
      skip: (d) => {
        stopPreview()
        engine?.skip(d)
      },
      readFrom: (i) => {
        if (!engine) return
        stopPreview()
        engine.setIndex(i)
        engine.play()
      },
      setVoice: (id) => {
        if (!engine) return
        engine.setVoice(id)
        void tide()
          .library.setVoice(id, latestProps.current.snapshot?.settings.speed ?? 1)
          .catch(() => {})
      },
      setSpeed: (s) => {
        if (!engine) return
        engine.setSpeed(Math.max(s, finRef.current.fin?.speed ?? 1))
        void tide()
          .library.setVoice(engine.snapshot().voice, s)
          .catch(() => {})
      },
      chosenSpeed: speed,
      finishNote,
      preview: (id) => {
        const ph = engine?.snapshot().phase
        if (isListening(ph)) engine?.pause()
        stopPreview()
        const url = `./voice-previews/${id}.mp3`
        const a = deps.makePreview ? deps.makePreview(url) : htmlPreview(url)
        previewing.current = a
        a.onEnded?.(() => {
          if (previewing.current === a) previewing.current = null
        })
        void Promise.resolve(a.play()).catch(() => {})
      },
      stopPreview,
      sleep,
      finished,
      playNext: () => {
        const next = finished?.next
        if (!next) return
        setOffer({ next, dismissed: true })
        autoplayFor.current = next.id
        if (latestProps.current.onPlayNext(next.id) === false) autoplayFor.current = null
      },
      dismissFinished: () => {
        autoplayFor.current = null
        setOffer((o) => (o ? { ...o, dismissed: true } : o))
      },
      setSleep: (o) => {
        const at = engine?.snapshot().index ?? current ?? 0
        timer?.set(o, sentencesRef.current[at]?.spans[0]?.page ?? 0)
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
    [engine, snap, stopPreview, sleep, timer, current, finished, speed, finishNote]
  )

  // --- Keys: ← / → skip 15 s, Space plays and pauses ------------------------------------------
  const latest = useLatest(value)
  // --- Media keys and Now Playing -------------------------------------------------------------
  const title = reading?.title ?? null
  const artist = courseName ?? 'Tide'
  useEffect(() => {
    if (title === null) return
    return bindMediaSession(
      typeof navigator === 'undefined' ? undefined : navigator.mediaSession,
      { title, artist },
      {
        play: () => latest.current.play(),
        pause: () => latest.current.pause(),
        back: () => latest.current.skip(-SKIP_SEC),
        forward: () => latest.current.skip(SKIP_SEC)
      }
    )
  }, [title, artist])
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return
    navigator.mediaSession.playbackState =
      title === null ? 'none' : isListening(phase) ? 'playing' : 'paused'
  }, [phase, title])

  const hasText = sentences.length > 0
  /** Space was ours on keydown, so its keyup must not click the focused button. */
  const spaceHandled = useRef(false)
  const onKey = useCallback(
    (e: KeyboardEvent): void => {
      const space = e.key === ' '
      if (!space && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!hasText) return
      // Space on a button, link or field does its own thing.
      if (
        leavesKeysAlone(
          e,
          space ? ', footer[aria-label="Player"] button, button[data-back-to-reading]' : ''
        )
      )
        return
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
      {/* data-phase is test-only (TIDE_E2E exposes window.tideTest): e2e waits on the player's phase. */}
      <audio ref={audio} hidden data-phase={window.tideTest ? phase : undefined} />
    </PlayerCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function usePlayer(): PlayerValue {
  return useContext(PlayerCtx)
}
