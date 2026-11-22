// Kokoro silently truncates input past ~510 phoneme tokens, so over-long text must be split.
// Pure: the token counter is injected. Output chunks always rejoin to the exact input.
export type TokenCounter = (s: string) => Promise<number>

// Split after each delimiter, keeping the delimiter and trailing whitespace on the piece.
function pieces(text: string, delims: string): string[] {
  const re = new RegExp(String.raw`[^${delims}]*[${delims}]+\s*|[^${delims}]+$`, 'g')
  return text.match(re) ?? [text]
}

async function pack(
  parts: string[],
  count: TokenCounter,
  max: number,
  rest: string[]
): Promise<string[]> {
  const out: string[] = []
  let cur = ''
  for (const part of parts) {
    if (cur && (await count(cur + part)) <= max) {
      cur += part
      continue
    }
    if (cur) out.push(cur)
    cur = part
  }
  if (cur) out.push(cur)
  const final: string[] = []
  for (const c of out) {
    if ((await count(c)) <= max) final.push(c)
    else final.push(...(await splitLevel(c, count, max, rest)))
  }
  return final
}

async function splitLevel(
  text: string,
  count: TokenCounter,
  max: number,
  levels: string[]
): Promise<string[]> {
  if (levels.length === 0) {
    // Word-boundary fallback: whitespace stays at the end of the preceding word.
    const words = text.match(/\S+\s*/g) ?? [text]
    if (words.length <= 1) return [text] // a single unbreakable word; nothing more to do
    return pack(words, count, max, [])
  }
  const [delims, ...rest] = levels
  const parts = pieces(text, delims)
  if (parts.length <= 1) return splitLevel(text, count, max, rest)
  return pack(parts, count, max, rest)
}

/**
 * What can make short text phonemize long, so it is always counted: digits ("1984" -> "nineteen
 * eighty-four"), runs of 2+ capitals (acronyms spelled out letter by letter), symbols read as words
 * (% & $ # @ + = < > / \ ^ ~ | € £ § °), Greek letters (U+0370-U+03FF) and math operators
 * (U+2200-U+22FF). Curly quotes and dashes are fine.
 */
const NEEDS_COUNTING = /[\d%&$#@+=<>/\\^~|€£§°Ͱ-Ͽ∀-⋿]|[A-Z]{2}/

const PLAIN_TOKENS_PER_CHAR = 1.25

export async function splitForSpeech(
  text: string,
  countTokens: TokenCounter,
  maxTokens = 400
): Promise<string[]> {
  // Phonemizing costs tens of ms. Plain English phonemizes to about 1.0-1.1 tokens per character
  // (measured), so with a 25% margin text of at most `maxTokens / 1.25` characters is not counted
  // (see `NEEDS_COUNTING` for what is not plain).
  if (text.length <= maxTokens / PLAIN_TOKENS_PER_CHAR && !NEEDS_COUNTING.test(text)) return [text]
  if ((await countTokens(text)) <= maxTokens) return [text]
  return splitLevel(text, countTokens, maxTokens, [';:', ','])
}
