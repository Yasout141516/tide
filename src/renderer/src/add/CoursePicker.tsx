import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Course } from '../../../shared/library/types'

export type CourseChoice = { id: string } | { newName: string } | null

type Props = {
  fileName: string
  pageCount: number | null
  /** Already in the shelf's order. */
  courses: Course[]
  /** `null` means no course (Other). */
  onChoose(choice: CourseChoice): void
  onCancel(): void
}

const chip =
  'min-h-9 cursor-pointer rounded-full border-2 bg-transparent px-3.5 py-2 font-sans text-[13px] font-bold'

export function CoursePicker({
  fileName,
  pageCount,
  courses,
  onChoose,
  onCancel
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const choose = (id: string): void => {
    setSelected(id === selected ? null : id)
    setCreating(false)
  }
  const confirm = (): void => {
    const name = newName.trim()
    if (creating && name !== '') onChoose({ newName: name })
    else if (!creating && selected !== null) onChoose({ id: selected })
    else onChoose(null)
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[calc(100%-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-surface p-[22px] text-ink shadow-[0_24px_50px_var(--shadow)]">
          <Dialog.Title className="m-0 mb-1 font-display text-xl font-bold text-ink">
            Which course is this for?
          </Dialog.Title>
          <Dialog.Description className="mb-3.5 text-[13px] leading-[1.45] text-muted">
            Optional. It just keeps your shelf tidy.
          </Dialog.Description>
          <div className="flex items-center gap-2.5 rounded-[11px] border-[1.5px] border-border bg-bg px-3 py-2.5 text-[13px]">
            <span aria-hidden="true" className="text-lg">
              📄
            </span>
            <b className="min-w-0 break-words">{fileName}</b>
            {pageCount !== null ? (
              <span className="ml-auto shrink-0 text-muted">{pageCount} pages</span>
            ) : null}
          </div>
          <div className="mt-3.5 mb-1 flex flex-wrap gap-2" role="group" aria-label="Courses">
            {courses.map((c) => {
              const on = !creating && selected === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => choose(c.id)}
                  className={`${chip} ${on ? 'border-primary bg-soft text-soft-ink' : 'border-border text-ink'}`}
                >
                  {c.name}
                </button>
              )
            })}
            {creating ? (
              <input
                autoFocus
                type="text"
                aria-label="New course name"
                placeholder="Course name, e.g. PSYC 201"
                maxLength={40}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirm()
                }}
                className="min-h-9 min-w-0 flex-1 rounded-[11px] border-[1.5px] border-primary bg-bg px-3 py-2 font-sans text-[13px] text-ink"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setSelected(null)
                }}
                className={`${chip} border-dashed border-border text-ink`}
              >
                ＋ New course
              </button>
            )}
          </div>
          <div className="mt-[18px] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => onChoose(null)}
              className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-transparent px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-muted"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={confirm}
              className="min-h-9 cursor-pointer rounded-[11px] border-0 bg-primary px-[18px] py-[11px] font-sans text-[13.5px] font-extrabold text-on-primary"
            >
              Add to shelf
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
