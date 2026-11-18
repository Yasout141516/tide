/** The 1-based pages that keep a canvas: the visible ones plus `margin` either side, clamped to the document. */
export function renderWindow(
  firstVisible: number,
  lastVisible: number,
  total: number,
  margin = 1
): number[] {
  const from = Math.max(1, firstVisible - margin)
  const to = Math.min(total, lastVisible + margin)
  const out: number[] = []
  for (let n = from; n <= to; n++) out.push(n)
  return out
}
