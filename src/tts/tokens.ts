// Kokoro tokens are per phoneme character, so the count is the length of the phonemized
// string. Loaded lazily: phonemizer is ESM and must not load before the worker's offline guard.
export async function countTokens(s: string): Promise<number> {
  const { phonemize } = await import('phonemizer')
  return (await phonemize(s, 'en-us')).join(' ').length
}
