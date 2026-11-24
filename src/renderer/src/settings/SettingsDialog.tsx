import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { LookTab } from './LookTab'
import { ReadingTab } from './ReadingTab'

export type SettingsTab = 'look' | 'reading' | 'pronunciation'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'look', label: 'Look' },
  { id: 'reading', label: 'Reading' },
  { id: 'pronunciation', label: 'Pronunciation' }
]

type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  initialTab?: SettingsTab
  /** Text size in the reader (shared with the menu command). */
  zoom: number
  onZoomStep(d: 1 | -1): void
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = 'look',
  zoom,
  onZoomStep
}: Props): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 h-[min(520px,calc(100%-32px))] w-[calc(100%-32px)] max-w-[760px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] bg-surface text-ink shadow-[0_24px_50px_var(--shadow)]"
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <SettingsBody initialTab={initialTab} zoom={zoom} onZoomStep={onZoomStep} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Mounted only while the dialog is open, so every open starts on `initialTab`. */
function SettingsBody({
  initialTab,
  zoom,
  onZoomStep
}: Pick<Props, 'zoom' | 'onZoomStep'> & { initialTab: SettingsTab }): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  return (
    <div className="grid h-full grid-cols-[180px_minmax(0,1fr)]">
      <nav
        aria-label="Settings sections"
        className="flex flex-col gap-0.5 border-r border-border bg-linear-to-b from-shelf-a to-shelf-b px-2.5 py-4"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={`min-h-9 cursor-pointer rounded-[10px] border-0 px-3 py-[9px] text-left font-sans text-[13.5px] font-bold ${
              tab === t.id
                ? 'bg-surface text-ink shadow-[0_1px_3px_var(--shadow)]'
                : 'bg-transparent text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
        {/* Slot: Task 9 adds the "Copy diagnostic info" button at the foot of the nav. */}
      </nav>
      <main className="min-h-0 overflow-y-auto px-6 py-5">
        {tab === 'look' ? <LookTab zoom={zoom} onZoomStep={onZoomStep} /> : null}
        {tab === 'reading' ? <ReadingTab /> : null}
        {/* Slot: Task 7 renders <PronunciationTab /> here. */}
      </main>
    </div>
  )
}
