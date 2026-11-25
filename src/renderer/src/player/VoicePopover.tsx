import * as Popover from '@radix-ui/react-popover'
import { SPEEDS, speedLabel, VOICES, voiceName, DEFAULT_VOICE } from '../../../shared/voices'
import { usePlayerActions, usePlayerState } from './PlayerContext'
import { useTheme } from '../theme/theme'
import { MochiHead, voiceCoat } from '../theme/mascots/Mochi'

const focus =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const trigger = `inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[11px] border-0 bg-soft px-[13px] py-[9px] font-sans text-[13px] font-extrabold text-soft-ink disabled:cursor-default disabled:opacity-60 ${focus}`
const listen = `inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-soft px-3.5 font-sans text-[12.5px] font-extrabold text-soft-ink transition-colors duration-150 motion-reduce:transition-none hover:bg-primary hover:text-on-primary ${focus}`

/** The voice & speed button and its popover: ten voices with a Listen each, then five speeds. */
export function VoicePopover({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { snapshot, chosenSpeed } = usePlayerState()
  const { setVoice, setSpeed, preview, stopPreview } = usePlayerActions()
  const kitty = useTheme().resolved === 'kitty'
  return (
    <Popover.Root onOpenChange={(open) => !open && stopPreview()}>
      <Popover.Trigger className={trigger} disabled={disabled}>
        {`${voiceName(snapshot.voice)} · ${speedLabel(snapshot.speed)}`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Choose a voice"
          className="z-50 max-h-[min(560px,var(--radix-popover-content-available-height))] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-[18px] border border-border bg-surface p-3.5 shadow-[0_12px_32px_var(--shadow)] outline-none"
        >
          <h2 className="m-0 mb-2 flex items-center gap-2 px-1 font-sans text-[13px] font-extrabold text-soft-ink">
            {kitty ? <MochiHead size={26} /> : null}
            Choose a voice
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {VOICES.map((v) => {
              const on = v.id === snapshot.voice
              return (
                <li key={v.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setVoice(v.id)}
                    className={`flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[12px] border-0 px-3 py-1.5 text-left font-sans transition-colors duration-150 motion-reduce:transition-none ${on ? 'bg-soft text-soft-ink' : 'bg-transparent text-soft-ink hover:bg-soft'} ${focus}`}
                  >
                    {kitty ? <MochiHead size={30} coat={voiceCoat(v.id)} avatar /> : null}
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="text-[13.5px] font-extrabold">{v.name}</span>
                      <span className="text-[12px] font-semibold text-muted">
                        {v.description}
                        {v.id === DEFAULT_VOICE ? ' · default' : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Listen to ${v.name}`}
                    onClick={() => preview(v.id)}
                    className={listen}
                  >
                    <span aria-hidden="true">Listen</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <h2 className="m-0 mb-2 mt-3.5 px-1 font-sans text-[13px] font-extrabold text-soft-ink">
            Speed
          </h2>
          <div
            role="radiogroup"
            aria-label="Speed"
            className="flex gap-1 rounded-[14px] bg-soft p-1"
          >
            {SPEEDS.map((s) => {
              const on = s === chosenSpeed
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSpeed(s)}
                  className={`min-h-9 flex-1 cursor-pointer rounded-[10px] border-0 px-1 font-sans text-[12.5px] font-extrabold transition-colors duration-150 motion-reduce:transition-none ${on ? 'bg-primary text-on-primary' : 'bg-transparent text-soft-ink hover:bg-surface'} ${focus}`}
                >
                  {speedLabel(s)}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
