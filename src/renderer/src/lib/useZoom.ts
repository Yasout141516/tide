import { useCallback, useEffect, useRef } from 'react'
import type { LibrarySnapshot } from '../../../shared/library/types'
import { tide } from './tide'
import { ZOOM_MAX, ZOOM_MIN } from '../../../shared/zoom'

/**
 * Text size in the reader (80-200% in 10% steps). The menu command and the A-/A+ buttons both call `step`.
 * A held key sends steps faster than snapshots arrive: a snapshot that echoes a value we sent only retires
 * it (our newer steps stay ahead); any other change is adopted.
 */
export function useZoom(snapshot: LibrarySnapshot | null): {
  zoom: number
  step(d: 1 | -1): void
} {
  const zoomRef = useRef(1)
  const libZoomRef = useRef(1)
  /** Zoom values sent to main whose snapshot has not come back yet, oldest first. */
  const sentZooms = useRef<number[]>([])
  const libZoom = snapshot?.settings.zoom ?? 1
  useEffect(() => {
    if (libZoom !== libZoomRef.current) {
      libZoomRef.current = libZoom
      const sent = sentZooms.current
      const at = sent.indexOf(libZoom)
      if (at >= 0) {
        sent.splice(0, at + 1)
        if (sent.length === 0) zoomRef.current = libZoom
      } else {
        sent.length = 0
        zoomRef.current = libZoom
      }
    }
  })
  const step = useCallback((d: 1 | -1): void => {
    // One decimal so repeated steps never drift.
    const next = Math.round((zoomRef.current + d * 0.1) * 10) / 10
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    if (zoom !== zoomRef.current) {
      zoomRef.current = zoom
      sentZooms.current.push(zoom)
      tide()
        .library.setZoom(zoom)
        .catch(() => {
          // Not saved: fall back to what the library says.
          sentZooms.current.length = 0
          zoomRef.current = libZoomRef.current
        })
    }
  }, [])
  return { zoom: libZoom, step }
}
