/*
 * Global Search input sanitization (redesign spec §11). The LIKE-injection escape
 * boundary for the FSA global search: LIKE metacharacters (% _ \) are escaped so
 * a user's literal text matches literally, and PostgREST `or()` metacharacters
 * (, ( ) *) are stripped so a search term can never alter the filter grammar.
 * Also extracts the digit run used for phone/number matching.
 *
 * Pure and self-contained so the thin route stays free of logic and this security
 * boundary can be unit-tested directly.
 */
export function sanitize(q: string): { like: string; digits: string } | null {
  const safe = q
    .replace(/[,()*]/g, ' ')
    .trim()
    .replace(/[%_\\]/g, (m) => `\\${m}`)
  if (!safe) return null
  return { like: `%${safe}%`, digits: q.replace(/\D/g, '') }
}
