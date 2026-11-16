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

export async function splitForSpeech(
  text: string,
  countTokens: TokenCounter,
  maxTokens = 400
): Promise<string[]> {
  if ((await countTokens(text)) <= maxTokens) return [text]
  return splitLevel(text, countTokens, maxTokens, [';:', ','])
}
