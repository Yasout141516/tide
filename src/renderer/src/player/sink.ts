import type { AudioSink } from './engine'

/** The only file in the player that touches an HTMLAudioElement. */
export class HtmlAudioSink implements AudioSink {
  private readonly el: HTMLAudioElement

  constructor(el: HTMLAudioElement) {
    this.el = el
  }

  setSource(url: string): void {
    this.el.src = url
  }

  play(): Promise<void> {
    return this.el.play()
  }

  pause(): void {
    this.el.pause()
  }

  get currentTime(): number {
    return this.el.currentTime
  }

  get volume(): number {
    return this.el.volume
  }

  set volume(v: number) {
    this.el.volume = v
  }

  onEnded(cb: () => void): void {
    this.el.addEventListener('ended', cb)
  }

  onError(cb: () => void): void {
    this.el.addEventListener('error', cb)
  }
}
