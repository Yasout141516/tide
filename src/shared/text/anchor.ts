/** Resume anchor: the first span of the current sentence (spec §6.4). Type only; logic arrives in a later task. */
export interface Anchor {
  page: number
  textItemIndex: number
  charOffset: number
}
