// src/lib/import/resolution.ts
// The shared entity-resolution engine every importer uses so the matching,
// merging, and dedup rules are identical regardless of file source, format,
// contact category, policy/product type, agency, or agent.
//
// It is intentionally PURE (no I/O): a caller builds a ContactIndex from the
// existing Contact Center, then for each incoming row calls resolveContact() to
// get a confidence-scored decision and mergeFields() to compute a no-overwrite
// patch plus the values it rejected. This makes the rules unit-testable and
// keeps the DB layer (route + triggers) thin.
//
// Design guarantees the spec calls for:
//   • No field is mandatory — resolution uses whatever identifiers are present.
//   • A strong, reliable identifier is required to auto-merge; a name alone (or
//     conflicting strong matches) never merges — it is routed to manual review,
//     preventing false matches and the collapse of unrelated records.
//   • Merges never overwrite valid existing data; rejected values are recorded
//     for the audit trail.

// ── identifiers ──────────────────────────────────────────────────────────────
export interface Identifiers {
  /** Deterministic same-record keys (book_key, crosssell_key, …). Highest trust. */
  provenanceKeys?: string[]
  email?: string | null
  phone?: string | null
  fullName?: string | null
  dob?: string | null
  street?: string | null
  zip?: string | null
  /** Policy numbers this row is about — resolves to a contact via the book. */
  policyNumbers?: string[]
}

export interface CandidateContact {
  id: string
  full_name: string
  email_lc?: string | null
  phone_digits?: string | null
  dob?: string | null
  street?: string | null
  zip?: string | null
  provenanceKeys?: string[]
}

export const nameKey = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z]/g, '')
export const emailKey = (s?: string | null) => (s || '').trim().toLowerCase() || null
export const phoneKey = (s?: string | null) => {
  const d = (s || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : d.length >= 7 ? d : null
}
export const zipKey = (s?: string | null) => (s || '').replace(/\D/g, '').slice(0, 5) || null
export const streetKey = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '') || null
// DOB comparisons use month/day when that's all we have (the lists carry no year),
// so a full DOB still matches a month/day DOB on the same person.
export const dobKey = (s?: string | null) => {
  const t = (s || '').trim()
  if (!t) return null
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}`
  const md = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/)
  if (md) return `${Number(md[1])}/${Number(md[2])}`
  return t.toLowerCase()
}

// ── index ────────────────────────────────────────────────────────────────────
export interface ContactIndex {
  byProvenance: Map<string, string>
  byEmail: Map<string, string>
  byPhone: Map<string, string>
  byNameDob: Map<string, Set<string>>
  byNameStreet: Map<string, Set<string>>
  byNameZip: Map<string, Set<string>>
  byName: Map<string, Set<string>>
  /** policy_number → contact id (built by the caller from the book). */
  byPolicy: Map<string, string>
}

const add = (m: Map<string, Set<string>>, k: string | null, id: string) => {
  if (!k) return
  const s = m.get(k)
  if (s) s.add(id)
  else m.set(k, new Set([id]))
}

export function buildContactIndex(contacts: CandidateContact[], policyToContact?: Map<string, string>): ContactIndex {
  const idx: ContactIndex = {
    byProvenance: new Map(), byEmail: new Map(), byPhone: new Map(),
    byNameDob: new Map(), byNameStreet: new Map(), byNameZip: new Map(),
    byName: new Map(), byPolicy: policyToContact ?? new Map(),
  }
  for (const c of contacts) {
    for (const k of c.provenanceKeys || []) if (k && !idx.byProvenance.has(k)) idx.byProvenance.set(k, c.id)
    const e = emailKey(c.email_lc)
    if (e && !idx.byEmail.has(e)) idx.byEmail.set(e, c.id)
    const p = phoneKey(c.phone_digits)
    if (p && !idx.byPhone.has(p)) idx.byPhone.set(p, c.id)
    const nk = nameKey(c.full_name)
    if (nk) {
      const d = dobKey(c.dob)
      if (d) add(idx.byNameDob, `${nk}|${d}`, c.id)
      const st = streetKey(c.street)
      if (st) add(idx.byNameStreet, `${nk}|${st}`, c.id)
      const z = zipKey(c.zip)
      if (z) add(idx.byNameZip, `${nk}|${z}`, c.id)
      add(idx.byName, nk, c.id)
    }
  }
  return idx
}

// ── resolution ───────────────────────────────────────────────────────────────
export type Confidence = 'exact' | 'high' | 'medium' | 'low' | 'none'
export type ResolveAction = 'merge' | 'review' | 'create'

export interface Resolution {
  targetId: string | null
  confidence: Confidence
  action: ResolveAction
  matchedBy: string[]
  /** Distinct candidate ids seen across all identifiers (for review context). */
  candidateIds: string[]
  /** Set when identifiers pointed at more than one existing contact. */
  conflict: boolean
}

const only = (s: Set<string>) => (s.size === 1 ? Array.from(s)[0] : null)

/**
 * Resolve an incoming row's identifiers to an existing contact with a confidence
 * level. Auto-merges only on a reliable identifier; a name-only signal, or two
 * identifiers pointing at different contacts, is routed to manual review so
 * unrelated records are never merged.
 */
export function resolveContact(idx: ContactIndex, ids: Identifiers): Resolution {
  const hits: Array<{ by: string; id: string; strong: boolean }> = []
  const push = (by: string, id: string | null | undefined, strong: boolean) => { if (id) hits.push({ by, id, strong }) }
  const pushAll = (by: string, set: Set<string> | undefined, strong: boolean) => { for (const id of Array.from(set || [])) hits.push({ by, id, strong }) }

  for (const k of ids.provenanceKeys || []) push('provenance', idx.byProvenance.get(k), true)
  push('email', idx.byEmail.get(emailKey(ids.email) || ''), true)
  push('phone', idx.byPhone.get(phoneKey(ids.phone) || ''), true)
  for (const pn of ids.policyNumbers || []) push('policy_number', idx.byPolicy.get(pn), true)

  const nk = nameKey(ids.fullName)
  if (nk) {
    const d = dobKey(ids.dob)
    if (d) pushAll('name+dob', idx.byNameDob.get(`${nk}|${d}`), true)
    const st = streetKey(ids.street)
    if (st) pushAll('name+address', idx.byNameStreet.get(`${nk}|${st}`), true)
    const z = zipKey(ids.zip)
    if (z) pushAll('name+zip', idx.byNameZip.get(`${nk}|${z}`), false)
    pushAll('name', idx.byName.get(nk), false)
  }

  const candidateIds = Array.from(new Set(hits.map((h) => h.id)))
  if (candidateIds.length === 0) {
    return { targetId: null, confidence: 'none', action: 'create', matchedBy: [], candidateIds, conflict: false }
  }

  const strongHits = hits.filter((h) => h.strong)
  const strongIds = new Set(strongHits.map((h) => h.id))

  // Conflict: strong identifiers disagree on which contact → never auto-merge.
  if (strongIds.size > 1) {
    return { targetId: null, confidence: 'low', action: 'review', matchedBy: Array.from(new Set(strongHits.map((h) => h.by))), candidateIds, conflict: true }
  }

  if (strongIds.size === 1) {
    const targetId = Array.from(strongIds)[0]
    const matchedBy = Array.from(new Set(hits.filter((h) => h.id === targetId).map((h) => h.by)))
    const hasProvenanceOrContactPoint = matchedBy.some((m) => m === 'provenance' || m === 'email' || m === 'phone')
    return { targetId, confidence: hasProvenanceOrContactPoint ? 'exact' : 'high', action: 'merge', matchedBy, candidateIds, conflict: false }
  }

  // Only weak (name-based) hits remain. A name+zip that resolves to exactly one
  // contact disambiguates it (medium confidence) even if the bare name also
  // matches others elsewhere — the zip distinguishes them.
  const z = zipKey(ids.zip)
  const nameZipId = nk && z ? only(idx.byNameZip.get(`${nk}|${z}`) || new Set()) : null
  if (nameZipId) {
    return { targetId: nameZipId, confidence: 'medium', action: 'merge', matchedBy: ['name+zip'], candidateIds, conflict: false }
  }
  // Name alone — never auto-merge. Single match carries a target for review
  // context; multiple matches are an explicit conflict.
  return { targetId: candidateIds.length === 1 ? candidateIds[0] : null, confidence: 'low', action: 'review', matchedBy: ['name'], candidateIds, conflict: candidateIds.length > 1 }
}

// ── merge ────────────────────────────────────────────────────────────────────
export interface FieldSpec { field: string; kind?: 'scalar' | 'set' }
export interface MergeResult {
  patch: Record<string, unknown>
  merged: string[]
  rejected: Array<{ field: string; existing: unknown; incoming: unknown }>
}

const isBlank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/**
 * Compute a no-overwrite merge patch. Scalar fields fill only when the existing
 * value is blank; set fields (tags, lines_of_business) union. A present incoming
 * value that would overwrite a differing existing value is REJECTED (never
 * written) and recorded for the audit trail — the most complete data wins and
 * valid data is preserved.
 */
export function mergeFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  specs: FieldSpec[],
): MergeResult {
  const patch: Record<string, unknown> = {}
  const merged: string[] = []
  const rejected: Array<{ field: string; existing: unknown; incoming: unknown }> = []
  for (const { field, kind } of specs) {
    const inc = incoming[field]
    if (isBlank(inc)) continue
    const cur = existing[field]
    if (kind === 'set') {
      const curArr = Array.isArray(cur) ? cur.map(String) : []
      const incArr = Array.isArray(inc) ? inc.map(String) : []
      const union = Array.from(new Set([...curArr, ...incArr]))
      if (union.length !== curArr.length) { patch[field] = union; merged.push(field) }
      continue
    }
    if (isBlank(cur)) { patch[field] = inc; merged.push(field) }
    else if (String(cur).trim().toLowerCase() !== String(inc).trim().toLowerCase()) {
      rejected.push({ field, existing: cur, incoming: inc })
    }
  }
  return { patch, merged, rejected }
}
