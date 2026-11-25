import type { ThemeId } from '../../../shared/library/types'
import { useLibrary } from '../state/useLibrary'
import { useTheme } from '../theme/theme'
import { tide } from '../lib/tide'
import { softButton, SettingRow } from './controls'
import { useAttempt } from './useAttempt'

/** Preview art for the tiles. They depict other themes, so they cannot be current-theme tokens. */
const SWATCH: Record<Exclude<ThemeId, 'system'>, { bg: string; page: string; extra?: string }> = {
  'sky-sea': { bg: 'linear-gradient(180deg,#CFE8FA,#F2F9FF)', page: '#fff' },
  'deep-sea': { bg: 'linear-gradient(180deg,#0E2A40,#0B1D2C)', page: '#132B3E' },
  'pixel-quest': { bg: '#12304A', page: '#FFFDF6', extra: '#2A7BA0' },
  kitty: { bg: 'linear-gradient(180deg,#FCE9EC,#FFF3EE)', page: '#FFFFFF', extra: '#F6B9C8' }
}
const MATCH_BG = 'linear-gradient(90deg,#E6F3FD 50%,#0B1D2C 50%)'

type Props = { zoom: number; onZoomStep(d: 1 | -1): void }

export function LookTab({ zoom, onZoomStep }: Props): React.JSX.Element {
  const library = useLibrary()
  const attempt = useAttempt()
  const { id: current } = useTheme()
  const darkPages = library?.settings.darkPages ?? true
  const matchLabel = tide().platform === 'darwin' ? 'Match my Mac' : 'Match my PC'
  const tiles: { id: ThemeId; label: string }[] = [
    { id: 'sky-sea', label: 'Sky & Sea' },
    { id: 'deep-sea', label: 'Deep Sea' },
    { id: 'pixel-quest', label: 'Pixel Quest' },
    { id: 'kitty', label: 'Kitty' },
    { id: 'system', label: matchLabel }
  ]
  const pick = (theme: ThemeId): void => attempt(tide().library.setSettings({ theme }))

  const move = (i: number, d: number): void => {
    const next = tiles[(i + d + tiles.length) % tiles.length]
    pick(next.id)
    // The newly selected tile holds the tab stop; move focus with it.
    queueMicrotask(() => document.getElementById(`theme-tile-${next.id}`)?.focus())
  }

  return (
    <section aria-labelledby="look-heading">
      <h4 id="look-heading" className="m-0 mb-3 font-display text-[19px] font-bold">
        Look
      </h4>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2.5"
      >
        {tiles.map((t, i) => {
          const on = t.id === current
          const sw = t.id === 'system' ? null : SWATCH[t.id]
          return (
            <button
              key={t.id}
              id={`theme-tile-${t.id}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  move(i, 1)
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  move(i, -1)
                }
              }}
              className={`cursor-pointer rounded-xl border-2 bg-transparent p-1.5 text-center font-sans text-xs font-extrabold text-ink ${
                on ? 'border-primary' : 'border-border'
              }`}
            >
              <span
                aria-hidden="true"
                className="relative mb-1.5 block h-[54px] overflow-hidden rounded-lg"
                style={{ background: sw ? sw.bg : MATCH_BG }}
              >
                {sw ? (
                  <>
                    <span
                      className="absolute top-2.5 right-[18%] left-[18%] rounded-t-[3px]"
                      style={{ background: sw.page, bottom: sw.extra ? 12 : 0 }}
                    />
                    {sw.extra ? (
                      <span
                        className="absolute right-0 bottom-0 left-0 h-2"
                        style={{ background: sw.extra }}
                      />
                    ) : null}
                  </>
                ) : null}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="mt-2.5">
        <SettingRow
          id="dark-pages-label"
          label="Dark pages in dark themes"
          hint="Turn off for readings with lots of charts or photos."
          checked={darkPages}
          onChange={(next) => attempt(tide().library.setSettings({ darkPages: next }))}
        />
      </div>

      <div className="flex items-center justify-between gap-3.5 border-b border-border px-0.5 py-[11px] text-[13.5px] font-bold">
        <span id="text-size-label">Text size in the reader</span>
        <span role="group" aria-labelledby="text-size-label" className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Smaller text"
            onClick={() => onZoomStep(-1)}
            className={softButton}
          >
            A−
          </button>
          <b className="min-w-[3.2em] text-center text-[13px]">{Math.round(zoom * 100)}%</b>
          <button
            type="button"
            aria-label="Larger text"
            onClick={() => onZoomStep(1)}
            className={softButton}
          >
            A+
          </button>
        </span>
      </div>
    </section>
  )
}
