import { useEffect, useRef, type MutableRefObject } from 'react'

/** A ref kept current with `value` after every render, for callbacks and effects that must not re-run on it. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
