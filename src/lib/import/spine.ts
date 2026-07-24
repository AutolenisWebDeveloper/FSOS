// src/lib/import/spine.ts
// Shared, idempotent write helpers for the aggregate-root importers (in-force book
// and life conversion). One copy of the select-existing-then-insert-only-new
// primitives so both importers dedupe on provenance keys the same way and never
// duplicate a household, policy, contact, or agency (§6 — one importer spine).

const CHUNK = 500

/** Set of keyCol values that already exist among `values` (optionally fnwl-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function existingKeys(db: any, table: string, keyCol: string, values: string[], fnwlOnly = false): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < values.length; i += CHUNK) {
    let q = db.from(table).select(keyCol).in(keyCol, values.slice(i, i + CHUNK))
    if (fnwlOnly) q = q.eq('source_system', 'fnwl')
    const { data } = await q
    for (const r of data || []) if (r[keyCol] != null) set.add(String(r[keyCol]))
  }
  return set
}

/** Set of "col1|lower(col2)" pairs that already exist among the given col1 values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function existingPairs(db: any, table: string, col1: string, col2: string, col1Values: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < col1Values.length; i += CHUNK) {
    const { data } = await db.from(table).select(`${col1}, ${col2}`).in(col1, col1Values.slice(i, i + CHUNK))
    for (const r of data || []) if (r[col1] != null && r[col2] != null) set.add(`${r[col1]}|${String(r[col2]).toLowerCase()}`)
  }
  return set
}

/** Insert rows in chunks; throws on the first error. No-op for an empty array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertChunked(db: any, table: string, rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK))
    if (error) throw new Error(`${table} insert failed: ${error.message}`)
  }
}

/** Map keyCol value → idCol value for the given keys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mapIds(db: any, table: string, keyCol: string, idCol: string, keys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data } = await db.from(table).select(`${idCol}, ${keyCol}`).in(keyCol, keys.slice(i, i + CHUNK))
    for (const r of data || []) if (r[keyCol] != null) map.set(String(r[keyCol]), String(r[idCol]))
  }
  return map
}

/** Map lower(nameCol) → idCol for the given names (fallback household match). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mapIdsByLowerName(db: any, table: string, nameCol: string, idCol: string, names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniq = Array.from(new Set(names.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data } = await db.from(table).select(`${idCol}, ${nameCol}`).in(nameCol, uniq.slice(i, i + CHUNK)).is('deleted_at', null)
    for (const r of data || []) if (r[nameCol] != null && !map.has(String(r[nameCol]).toLowerCase())) map.set(String(r[nameCol]).toLowerCase(), String(r[idCol]))
  }
  return map
}
