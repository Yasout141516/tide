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
