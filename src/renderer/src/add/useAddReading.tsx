import { useEffect, useRef, useState, type ReactNode } from 'react'
import { libraryErrorCode } from '../../../shared/ipc-types'
import { sortCourses } from '../../../shared/library/shelf'
import type { PickResult, ReadingId } from '../../../shared/library/types'
import { readingTitle } from '../../../shared/library/title'
import { tide } from '../lib/tide'
import { useLibrary } from '../state/useLibrary'
import { useReaderDeps } from '../reader/deps'
import { CoursePicker, type CourseChoice } from './CoursePicker'
import { MessageDialog } from './MessageDialog'

interface Pending {
  pickId: string
  fileName: string
  title: string
  pageCount: number | null
}
interface Message {
  title: string
  body?: string
}

const DAMAGED: Message = { title: "Tide can't open this PDF. It may be damaged." }
const UNREADABLE: Message = {
  title: "Tide can't read that file.",
  body: 'Check that it is still where you left it, then try adding it again.'
}
const FAILED: Message = { title: "Tide couldn't add that reading.", body: 'Please try again.' }

const messageFor = (err: unknown): Message =>
  libraryErrorCode(err) === 'file-unreadable' ? UNREADABLE : FAILED

/** The Add reading flow: pick a PDF, check it opens, ask for a course (optional), put it on the shelf. */
export function useAddReading(onAdded: (id: ReadingId) => void): {
  start(): void
  handlePick(p: PickResult): void
  ui: ReactNode
} {
  const { openPdf } = useReaderDeps()
  const library = useLibrary()
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  // One flow at a time: a second ⌘O while a dialog or a read is under way is ignored.
  const busy = useRef(false)
  const onAddedRef = useRef(onAdded)
  useEffect(() => {
    onAddedRef.current = onAdded
  })

  // The latest pick that arrived (Open With) while a flow was under way; it runs when that flow ends.
  const waiting = useRef<PickResult | null>(null)

  const finish = (): void => {
    busy.current = false
    const next = waiting.current
    waiting.current = null
    if (next) handlePick(next)
  }

  /** Runs a pick; the caller has taken the `busy` lock. */
  const process = (p: PickResult): void => {
    if (p.kind === 'cancelled') return finish()
    if (p.kind === 'existing') {
      finish()
      return onAddedRef.current(p.readingId)
    }
    void (async () => {
      try {
        const read = await tide().library.readPdf({ pickId: p.pickId })
        if (!read.ok) {
          setMessage(read.reason === 'unreadable' ? UNREADABLE : DAMAGED)
          return finish()
        }
        const opened = await openPdf(read.data)
        if (opened.kind === 'ok') {
          const { doc } = opened
          const next = {
            pickId: p.pickId,
            fileName: p.fileName,
            title: readingTitle(doc.metaTitle, p.fileName),
            pageCount: doc.numPages
          }
          void doc.destroy().catch(() => {})
          setPending(next)
        } else if (opened.kind === 'needs-password') {
          // The password is asked when the reading opens.
          setPending({
            pickId: p.pickId,
            fileName: p.fileName,
            title: readingTitle(undefined, p.fileName),
            pageCount: null
          })
        } else {
          setMessage(DAMAGED)
          finish()
        }
      } catch (err) {
        setMessage(messageFor(err))
        finish()
      }
    })()
  }

  // Open With (and anything else) may call this at any time: while another add is under way, keep only the latest.
  const handlePick = (p: PickResult): void => {
    if (busy.current) {
      waiting.current = p
      return
    }
    busy.current = true
    process(p)
  }

  const start = (): void => {
    if (busy.current) return
    busy.current = true
    tide()
      .library.pickPdf()
      .then(process, (err) => {
        setMessage(messageFor(err))
        finish()
      })
  }

  const choose = (choice: CourseChoice): void => {
    const cur = pending
    if (!cur) return
    setPending(null)
    tide()
      .library.add({
        pickId: cur.pickId,
        title: cur.title,
        pageCount: cur.pageCount,
        course: choice
      })
      .then(
        (id) => {
          finish()
          onAddedRef.current(id)
        },
        (err) => {
          setMessage(
            libraryErrorCode(err) === 'already-on-shelf'
              ? { title: 'That reading is already on your shelf.' }
              : messageFor(err)
          )
          finish()
        }
      )
  }

  const cancel = (): void => {
    setPending(null)
    finish()
  }

  const ui = (
    <>
      {pending ? (
        <CoursePicker
          fileName={pending.fileName}
          pageCount={pending.pageCount}
          courses={sortCourses(library?.courses ?? [])}
          onChoose={choose}
          onCancel={cancel}
        />
      ) : null}
      {message ? (
        <MessageDialog title={message.title} body={message.body} onClose={() => setMessage(null)} />
      ) : null}
    </>
  )

  return { start, handlePick, ui }
}
