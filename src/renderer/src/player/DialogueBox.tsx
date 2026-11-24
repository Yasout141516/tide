import { useReaderState } from '../reader/ReaderState'
import { useTheme } from '../theme/theme'

/**
 * Pixel Quest only: an RPG dialogue box above the player that mirrors the sentence being read.
 * It duplicates the page, so it is hidden from assistive tech. The cursor blink is CSS and is
 * switched off under reduced motion.
 */
export function DialogueBox(): React.JSX.Element | null {
  const { resolved } = useTheme()
  const { sentences, current } = useReaderState()
  if (resolved !== 'pixel-quest' || current === null) return null
  const text = sentences[current]?.text
  if (!text) return null
  return (
    <div data-testid="dialogue-box" aria-hidden="true" className="pq-dialogue">
      <span className="pq-dialogue-who">NOW READING</span>
      {text}
      <span className="pq-dialogue-cursor">▼</span>
    </div>
  )
}
