import type { SpokenText } from './spoken'

/**
 * In-text citations removed from the spoken text (unless the reading's `readCitations` setting is
 * on), applied in this order:
 *
 * 1. a parenthetical with an author and a year anywhere inside it, with the space before it:
 *    "(Smith, 2019)", "(Smith & Jones, 2019, p. 4)", "(e.g., Lee et al., 2020; Kim, 2021)". A
 *    parenthetical without a capitalised name right before a year ("(born 1990 in Leeds)") stays;
 * 2. a narrative year right after a capitalised name: "Smith (2019) argues" -> "Smith argues",
 *    "Lee et al. (2020)", "Kim (2021, p. 12)";
 * 3. numeric brackets with the space before them: "[12]", "[3–5]", "[1, 4–6]".
 */
const CITATION_PATTERNS: RegExp[] = [
  /\s?\((?:[^()]*?(?:[A-Z][A-Za-z'’-]+(?:\s(?:&|and)\s[A-Z][A-Za-z'’-]+)?(?:\set al\.)?,?\s(?:19|20)\d{2}[a-z]?)[^()]*)\)/g,
  /(?<=[A-Z][a-z'’-]+(?: et al\.)?)\s\((?:19|20)\d{2}[a-z]?(?:,\s*pp?\.\s*\d+(?:[–-]\d+)?)?\)/g,
  /\s?\[\d+(?:[–-]\d+)?(?:,\s*\d+(?:[–-]\d+)?)*\]/g
]

/** Removes every `CITATION_PATTERNS` match from the spoken text, keeping its mapping to the page. */
export function removeCitations(s: SpokenText): void {
  for (const re of CITATION_PATTERNS) s.remove(re)
}
