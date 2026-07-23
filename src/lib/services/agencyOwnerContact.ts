// src/lib/services/agencyOwnerContact.ts
// ─────────────────────────────────────────────────────────────────────────
// Reconcile a Farmers agency owner into the unified Contact Center.
//
// An imported agent must land on the RIGHT existing contact — merging in the
// missing address / phone / email and linking to the agency partnership — rather
// than creating a parallel record. This module supplies the agency-owner-shaped
// identifiers, insert row, and merge spec so the shared, non-destructive
// resolution engine (src/lib/import/resolution.ts) does the matching. The engine
// fills only blank fields, never overwrites a conflicting value (those are
// rejected for the audit trail), and routes ambiguous matches to manual review.
//
// Convergence key: book_key = `agent:<agent_code>` — the SAME key the in-force
// book importer uses for agency-owner contacts (book/import route), so the two
// importers land on one contact per agent instead of duplicating.
//
// Pure (no I/O): the caller resolves against a ContactIndex, then applies the
// insert or the mergeFields() patch. Reused by the agency importer and the
// Data Quality reconciler.
// ─────────────────────────────────────────────────────────────────────────

import { mergeFields, resolveContact, type ContactIndex, type FieldSpec, type Identifiers, type Resolution } from '@/lib/import/resolution'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export interface AgencyOwnerContactInput {
  /** The agency_partnerships id this owner belongs to. */
  agencyId: string
  /** Farmers agent number (fnwl_serving_agent_no) — provenance key when present. */
  agentCode: string | null
  ownerName: string
  email: string | null
  businessPhone: string | null
  mobilePhone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

/** book_key for an agency-owner contact — shared with the in-force book importer. */
export function agencyOwnerBookKey(agentCode: string | null | undefined): string | null {
  const c = (agentCode || '').trim()
  return c ? `agent:${c}` : null
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/** The contact's single phone line: business preferred, mobile as fallback. */
export function primaryPhone(input: AgencyOwnerContactInput): string | null {
  return input.businessPhone || input.mobilePhone || null
}

/** Identifiers the resolution engine matches an agent on (provenance → email → phone → name+zip). */
export function agencyOwnerIdentifiers(input: AgencyOwnerContactInput): Identifiers {
  const bk = agencyOwnerBookKey(input.agentCode)
  return {
    provenanceKeys: bk ? [bk] : [],
    email: input.email,
    phone: primaryPhone(input),
    fullName: input.ownerName,
    zip: input.zip,
  }
}

// Non-destructive merge spec: fill only blanks; union tags. contact_type is
// handled by the applier (upgrade only from 'unknown' → 'agency_owner'), and
// email_lc / phone_digits stay derived from email / phone.
export const AGENCY_OWNER_MERGE_SPEC: FieldSpec[] = [
  { field: 'first_name' },
  { field: 'last_name' },
  { field: 'email' },
  { field: 'email_lc' },
  { field: 'phone' },
  { field: 'phone_digits' },
  { field: 'address' },
  { field: 'city' },
  { field: 'state' },
  { field: 'zip' },
  { field: 'agency_partnership_id' },
  { field: 'book_key' },
  { field: 'tags', kind: 'set' },
]

/** The incoming field values used both to build an insert and to compute a merge patch. */
export function agencyOwnerIncoming(input: AgencyOwnerContactInput): Record<string, unknown> {
  const { first, last } = splitName(input.ownerName)
  const phone = primaryPhone(input)
  return {
    first_name: first,
    last_name: last,
    email: input.email,
    email_lc: emailLc(input.email),
    phone,
    phone_digits: phoneDigits(phone),
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    agency_partnership_id: input.agencyId,
    book_key: agencyOwnerBookKey(input.agentCode),
    tags: ['agency-directory'],
  }
}

/** A full contacts insert row for an agent with no existing match. */
export function agencyOwnerContactInsert(input: AgencyOwnerContactInput, actor: string): Record<string, unknown> {
  return {
    ...agencyOwnerIncoming(input),
    full_name: input.ownerName,
    contact_type: 'agency_owner',
    status: 'active',
    source: 'agency_directory',
    created_by: actor,
    owner_scope: actor,
  }
}

// Columns needed to compute a no-overwrite merge patch for an owner contact.
export const CONTACT_MERGE_COLS =
  'id, first_name, last_name, email, email_lc, phone, phone_digits, address, city, state, zip, agency_partnership_id, book_key, tags, contact_type'

export type OwnerContactStatus = 'created' | 'merged' | 'review'

export interface OwnerContactApplyResult {
  status: OwnerContactStatus
  contactId: string | null
  mergedFields: string[]
  rejectedValues: Array<{ field: string; existing: unknown; incoming: unknown }>
  resolution: Resolution
}

/**
 * Reconcile one agency owner into the Contact Center against a prebuilt index,
 * using the shared, non-destructive engine. Merges into the single strong match
 * (filling blanks, upgrading an 'unknown' type to 'agency_owner'), creates a new
 * agency-owner contact when there's no match, or leaves an ambiguous match for
 * manual review (never a blind merge). The one DB-writing seam both the importer
 * and the Data Quality reconciler call, so the rules stay identical.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyOwnerContactResolution(
  db: any,
  index: ContactIndex,
  input: AgencyOwnerContactInput,
  actor: string,
): Promise<OwnerContactApplyResult> {
  const res = resolveContact(index, agencyOwnerIdentifiers(input))

  if (res.action === 'merge' && res.targetId) {
    const { data: existing } = await db.from('contacts').select(CONTACT_MERGE_COLS).eq('id', res.targetId).maybeSingle()
    let mergedFields: string[] = []
    let rejectedValues: Array<{ field: string; existing: unknown; incoming: unknown }> = []
    if (existing) {
      const { patch, merged, rejected } = mergeFields(existing, agencyOwnerIncoming(input), AGENCY_OWNER_MERGE_SPEC)
      if (existing.contact_type === 'unknown') patch.contact_type = 'agency_owner'
      if (Object.keys(patch).length > 0) await db.from('contacts').update(patch).eq('id', res.targetId)
      mergedFields = merged
      rejectedValues = rejected
    }
    return { status: 'merged', contactId: res.targetId, mergedFields, rejectedValues, resolution: res }
  }

  if (res.action === 'create') {
    const { data: inserted } = await db.from('contacts').insert(agencyOwnerContactInsert(input, actor)).select('id').single()
    return { status: inserted?.id ? 'created' : 'review', contactId: inserted?.id ?? null, mergedFields: [], rejectedValues: [], resolution: res }
  }

  return { status: 'review', contactId: null, mergedFields: [], rejectedValues: [], resolution: res }
}
