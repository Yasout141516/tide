import type { Pronunciation } from '../library/types'
import { escapeRe } from '../regex'

interface Compiled {
  re: RegExp
  say: Map<string, string>
}

/** Compiled once per rules array (the library hands out the same array until a rule changes). */
const cache = new WeakMap<readonly Pronunciation[], Compiled | null>()

function compile(rules: readonly Pronunciation[]): Compiled | null {
  const say = new Map<string, string>()
  for (const r of rules) if (r.word && r.sayAs) say.set(r.word.toLowerCase(), r.sayAs)
  if (say.size === 0) return null
  const words = [...say.keys()].sort((a, b) => b.length - a.length)
  const alt = words.map(escapeRe).join('|')
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alt})(?![\p{L}\p{N}])`, 'giu')
  return { re, say }
}

/**
 * Replaces each whole word of the rules with how it is to be said. One pass, longest word first,
 * so a replacement is never itself replaced and "New York" wins over "York".
 */
export function applyPronunciations(text: string, rules: readonly Pronunciation[]): string {
  let c = cache.get(rules)
  if (c === undefined) {
    c = compile(rules)
    cache.set(rules, c)
  }
  if (c === null) return text
  const { re, say } = c
  return text.replace(re, (m) => say.get(m.toLowerCase()) ?? m)
}
