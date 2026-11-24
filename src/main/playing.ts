export interface SaveBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

/** Keeps the machine awake while audio plays (the screen may still dim). Electron's powerSaveBlocker fits SaveBlocker. */
export class PlayingBlocker {
  private id: number | null = null

  constructor(private readonly blocker: SaveBlocker) {}

  set(on: boolean): void {
    if (on) {
      if (this.id === null || !this.blocker.isStarted(this.id)) {
        this.id = this.blocker.start('prevent-app-suspension')
      }
    } else this.dispose()
  }

  dispose(): void {
    if (this.id !== null) {
      if (this.blocker.isStarted(this.id)) this.blocker.stop(this.id)
      this.id = null
    }
  }
}

interface RendererEvents {
  on(event: 'render-process-gone', listener: () => void): unknown
  on(event: 'did-start-navigation', listener: (...args: unknown[]) => void): unknown
}

/**
 * A crashed or reloaded renderer can never report "stopped", so release the blocker ourselves or the
 * Mac would never idle-sleep. Sub-frame and same-document navigations leave the page playing.
 */
export function releaseWhenRendererLost(contents: RendererEvents, playing: PlayingBlocker): void {
  contents.on('render-process-gone', () => playing.set(false))
  contents.on('did-start-navigation', (...args) => {
    // Electron passes one details object; older builds pass (event, url, isInPlace, isMainFrame).
    const d = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined
    const isMainFrame = d?.isMainFrame ?? (args[3] as boolean | undefined) ?? true
    const sameDocument = d?.isSameDocument ?? (args[2] as boolean | undefined) ?? false
    if (isMainFrame && !sameDocument) playing.set(false)
  })
}
