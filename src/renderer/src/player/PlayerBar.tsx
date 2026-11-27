import { useReaderState } from '../reader/ReaderState'
import { usePlayerActions, usePlayerState } from './PlayerContext'
import { isListening } from './engine'
import { timeLeftLabel } from './timeline'
import { DialogueBox } from './DialogueBox'
import { PixelWaves } from '../theme/PixelWaves'
import { useTheme } from '../theme/theme'
import { themeCopy } from '../theme/copy'
import { MochiPeek, PawToes, YarnBall } from '../theme/mascots/Mochi'
import { SleepPopover } from './SleepPopover'
import { VoicePopover } from './VoicePopover'

const skipButton = `inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-0 bg-soft px-3.5 font-sans text-[12.5px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-60`
const playButton = `inline-flex min-h-[46px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-primary px-5 font-sans text-[14px] font-extrabold text-on-primary shadow-[0_4px_12px_var(--shadow)] disabled:cursor-default disabled:opacity-60`

const offerButton = `inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-0 px-3.5 font-sans text-[12.5px] font-extrabold`

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

/**
 * The progress picture shared by every theme: a faint "off" path under an "on" path clipped to the
 * progress. Each theme supplies its path, stroke and (optionally) a dashed off path.
 */
function ProgressTrack({
  d,
  height,
  strokeWidth,
  dashOff,
  progress
}: {
  d: string
  height: number
  strokeWidth: number
  dashOff?: string
  progress: number
}): React.JSX.Element {
  return (
    <svg
      viewBox={`0 0 400 ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={dashOff}
        strokeLinecap="round"
        style={{ stroke: 'var(--wave-off)' }}
      />
      <path
        d={d}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        className="transition-[clip-path] duration-200 motion-reduce:transition-none"
        style={{
          stroke: 'var(--wave-on)',
          clipPath: `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`
        }}
      />
    </svg>
  )
}

const THREAD = 'M2 16 C 60 6, 120 24, 180 14 S 300 8, 398 15'

/** Kitty's progress: the thread with a yarn ball at the current position. */
function YarnThread({ progress }: { progress: number }): React.JSX.Element {
  return (
    <div className="relative h-[26px]">
      <ProgressTrack d={THREAD} height={26} strokeWidth={3} dashOff="2 6" progress={progress} />
      <span
        className="absolute top-0.5 transition-[left] duration-200 motion-reduce:transition-none"
        style={{ left: `calc((100% - 22px) * ${progress.toFixed(4)})` }}
      >
        <YarnBall />
      </span>
    </div>
  )
}

/** The five controls: Back 15s, Play / Pause, Forward 15s, voice & speed, Sleep. */
export function PlayerBar(): React.JSX.Element {
  const { snapshot, finished, finishNote } = usePlayerState()
  const { toggle, skip, playNext, dismissFinished } = usePlayerActions()
  const { sentences, page, numPages, current } = useReaderState()
  const { resolved } = useTheme()
  const kitty = resolved === 'kitty'
  const { phase, secondsLeft } = snapshot
  const ready = sentences.length > 0
  const wantsPlay = isListening(phase)

  let left = numPages ? `Page ${page} of ${numPages}` : ''
  if (phase === 'loading-voice') left = 'Getting the voice ready…'
  else if (phase === 'error') left = "The voice isn't working right now."
  if (finishNote && phase !== 'loading-voice' && phase !== 'error') left = finishNote
  const right = ready && secondsLeft !== null && phase !== 'error' ? timeLeftLabel(secondsLeft) : ''

  const progress = ready && current !== null ? (current + 1) / sentences.length : 0

  return (
    <footer
      aria-label="Player"
      className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface px-[22px] py-3"
    >
      {resolved === 'pixel-quest' ? <PixelWaves /> : null}
      {kitty && wantsPlay ? (
        <span className="kt-peek pointer-events-none absolute right-24 -top-[30px]">
          <MochiPeek />
        </span>
      ) : null}
      <DialogueBox />
      <button type="button" className={skipButton} disabled={!ready} onClick={() => skip(-15)}>
        Back 15s
      </button>
      <button
        type="button"
        className={`pq-play kt-play relative ${playButton} ${phase === 'buffering' ? 'play-buffering' : ''}`}
        disabled={!ready}
        onClick={toggle}
      >
        {kitty ? <PawToes /> : null}
        {phase === 'loading-voice' ? <Spinner /> : wantsPlay ? <PauseIcon /> : <PlayIcon />}
        {wantsPlay ? 'Pause' : 'Play'}
      </button>
      <button type="button" className={skipButton} disabled={!ready} onClick={() => skip(15)}>
        Forward 15s
      </button>
      <div className="relative min-w-[120px] flex-1">
        {kitty ? (
          <YarnThread progress={progress} />
        ) : (
          <ProgressTrack d={WAVE} height={20} strokeWidth={3.2} progress={progress} />
        )}
        {finished ? (
          <div
            aria-live="polite"
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-bold text-ink"
          >
            <span>
              {finished.next ? `Finished ✓ · Next: ${finished.next.title}` : 'Finished ✓'}
            </span>
            {finished.next ? (
              <button
                type="button"
                className={`${offerButton} bg-primary text-on-primary`}
                onClick={playNext}
              >
                Play next
              </button>
            ) : null}
            <button
              type="button"
              className={`${offerButton} bg-soft text-soft-ink`}
              onClick={dismissFinished}
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div
            aria-live="polite"
            className="mt-0.5 flex min-h-[1em] justify-between gap-3 text-[11.5px] font-semibold text-muted"
          >
            <span>
              {kitty && phase === 'playing' ? (
                <span aria-hidden="true">{themeCopy(resolved, 'playing')} · </span>
              ) : null}
              {left}
            </span>
            <span>{right}</span>
          </div>
        )}
      </div>
      <VoicePopover disabled={!ready} />
      <SleepPopover disabled={!ready} />
    </footer>
  )
}
