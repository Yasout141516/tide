import { speedLabel, voiceName } from '../../../shared/voices'
import { useReaderState } from '../reader/ReaderState'
import { usePlayer } from './PlayerContext'
import { timeLeftLabel } from './timeline'

const focus =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const skipButton = `inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-0 bg-soft px-3.5 font-sans text-[12.5px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-60 ${focus}`
const playButton = `inline-flex min-h-[46px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-primary px-5 font-sans text-[14px] font-extrabold text-on-primary shadow-[0_4px_12px_var(--shadow)] disabled:cursor-default disabled:opacity-60 ${focus}`
const ctl = `inline-flex min-h-9 shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[11px] border-0 bg-soft px-[13px] py-[9px] font-sans text-[13px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-60 ${focus}`

const WAVE =
  'M0 10 Q 12.5 1 25 10 T 50 10 T 75 10 T 100 10 T 125 10 T 150 10 T 175 10 T 200 10 T 225 10 T 250 10 T 275 10 T 300 10 T 325 10 T 350 10 T 375 10 T 400 10'

function PauseIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="3" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
      <rect x="11" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 2.5 L15 9 L4 15.5 Z" fill="currentColor" />
    </svg>
  )
}

function Spinner(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary motion-reduce:animate-none"
    />
  )
}

/** The five controls: Back 15s, Play / Pause, Forward 15s, voice & speed, Sleep. */
export function PlayerBar(): React.JSX.Element {
  const { snapshot, toggle, skip } = usePlayer()
  const { sentences, page, numPages, current } = useReaderState()
  const { phase, secondsLeft } = snapshot
  const ready = sentences.length > 0
  const wantsPlay = phase === 'playing' || phase === 'buffering' || phase === 'loading-voice'

  let left = numPages ? `Page ${page} of ${numPages}` : ''
  if (phase === 'loading-voice') left = 'Getting the voice ready…'
  else if (phase === 'error') left = "The voice isn't working right now."
  const right = ready && secondsLeft !== null && phase !== 'error' ? timeLeftLabel(secondsLeft) : ''

  const progress = ready && current !== null ? (current + 1) / sentences.length : 0

  return (
    <footer
      aria-label="Player"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface px-[22px] py-3"
    >
      <button type="button" className={skipButton} disabled={!ready} onClick={() => skip(-15)}>
        Back 15s
      </button>
      <button
        type="button"
        className={`${playButton} ${phase === 'buffering' ? 'play-buffering' : ''}`}
        disabled={!ready}
        onClick={toggle}
      >
        {phase === 'loading-voice' ? <Spinner /> : wantsPlay ? <PauseIcon /> : <PlayIcon />}
        {wantsPlay ? 'Pause' : 'Play'}
      </button>
      <button type="button" className={skipButton} disabled={!ready} onClick={() => skip(15)}>
        Forward 15s
      </button>
      <div className="min-w-[120px] flex-1">
        <svg
          viewBox="0 0 400 20"
          width="100%"
          height="20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={WAVE}
            fill="none"
            strokeWidth="3.2"
            strokeLinecap="round"
            style={{ stroke: 'var(--wave-off)' }}
          />
          <path
            d={WAVE}
            fill="none"
            strokeWidth="3.2"
            strokeLinecap="round"
            className="transition-[clip-path] duration-200 motion-reduce:transition-none"
            style={{
              stroke: 'var(--wave-on)',
              clipPath: `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`
            }}
          />
        </svg>
        <div
          aria-live="polite"
          className="mt-0.5 flex min-h-[1em] justify-between gap-3 text-[11.5px] font-semibold text-muted"
        >
          <span>{left}</span>
          <span>{right}</span>
        </div>
      </div>
      <button type="button" className={ctl} disabled>
        {`${voiceName(snapshot.voice)} · ${speedLabel(snapshot.speed)}`}
      </button>
      <button type="button" className={ctl} disabled>
        Sleep
      </button>
    </footer>
  )
}
