/**
 * A whole number of minutes in her words: "7 min". With `hours`, 60 or more reads "1 h" or "1 h 5 min".
 * Callers add their own lead-in and rounding.
 */
export function formatMinutes(min: number, hours = false): string {
  if (!hours) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
