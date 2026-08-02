// src/lib/comms/contact-tag-catalog.ts
// PURE helper — aggregate a distinct-tag catalog (tag → contact count) from raw contact tag
// arrays, for the "Group Consents" tag picker. Tags are trimmed + lower-cased so casing/whitespace
// drift from different importers collapses to one bucket (the same normalization importers stamp
// with). Blank tags are dropped. Sorted by count desc, then tag asc, for a stable, useful list.
// No DB — unit-testable offline (tests/consent-revoke.test.mjs).

export interface TagCount {
  tag: string
  contacts: number
}

/** Normalize a single tag the way importers store them (trim + lower-case). */
export function normalizeTag(tag: unknown): string {
  return String(tag ?? '').trim().toLowerCase()
}

/**
 * Aggregate { id, tags } contact rows into a distinct-tag catalog with per-tag contact counts.
 * A contact counts once per DISTINCT tag it carries (duplicate tags on one contact don't
 * double-count). Returns a stable order: most-used first, ties broken alphabetically.
 */
export function aggregateTagCounts(rows: Array<{ tags?: string[] | null }>): TagCount[] {
  const counts = new Map<string, number>()
  for (const r of rows || []) {
    const seen = new Set<string>()
    for (const raw of r?.tags || []) {
      const t = normalizeTag(raw)
      if (!t || seen.has(t)) continue
      seen.add(t)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, contacts]) => ({ tag, contacts }))
    .sort((a, b) => (b.contacts - a.contacts) || a.tag.localeCompare(b.tag))
}
