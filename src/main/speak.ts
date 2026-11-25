import type { Pronunciation } from '../shared/library/types'
import { applyPronunciations } from '../shared/text/pronounce'
import type { TtsHost } from './tts-host'

/**
 * The host's synthesize with her pronunciation fixes applied to the text first, so playback and
 * exports say the same thing. Previews (the Listen button) already carry the exact respelling.
 */
export function makeSpeak(
  host: Pick<TtsHost, 'synthesize'>,
  rules: () => readonly Pronunciation[],
  /** e2e builds only: sees the exact text handed to the host. */
  onText?: (text: string) => void
): TtsHost['synthesize'] {
  return (text, o) => {
    const spoken = o.priority === 'preview' ? text : applyPronunciations(text, rules())
    onText?.(spoken)
    return host.synthesize(spoken, o)
  }
}
