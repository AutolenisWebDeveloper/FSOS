// src/lib/services/householdMaterialize.ts
// Slice 3 — Household materialization (the enrollment unlock). Connects orphan
// contacts (contacts.household_id IS NULL) into the household spine so the native
// campaign engine — which enrolls household_members.member_id — can reach them.
//
// One materialization code path, reused by the bulk importer, the manual create
// route, and the daily data-quality job (ADR-029). It is split into a PURE planner
// (planMaterialization — fully unit-testable, decides create/group/skip + the exact
// rows) and a thin DB executor (materializeContact) that runs the plan idempotently.
//
// Grouping is deterministic via households.origin_key: people who share a last name
// + street (+ zip) get the same key and group into one household; a contact with no
// usable address falls back to a single-member household. Idempotency has two
// anchors: the backfill only scans unlinked contacts, and household_members
// .source_contact_id makes re-materializing a contact a no-op. See migration 071.

import type { SupabaseClient } from '@supabase/supabase-js'
import { nameKey, streetKey, zipKey } from '@/lib/import/resolution'

// Client-side, campaign-targetable types. agency_owner + business are the B2B side
// (reconciled to agency_partnerships, not households) and are deliberately excluded
// so the aggregate-root boundary (ADR-001) stays intact.
export const MATERIALIZABLE_TYPES = ['client', 'prospect', 'cross_sell', 'term_conversion', 'unknown'] as const
export type MaterializableType = (typeof MATERIALIZABLE_TYPES)[number]

export interface MaterializableContact {
  id: string
  full_name: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  contact_type?: string | null
  agency_partnership_id?: string | null
  owner_scope?: string | null
}

export function isMaterializable(contact: Pick<MaterializableContact, 'contact_type'>): boolean {
  return (MATERIALIZABLE_TYPES as readonly string[]).includes(contact.contact_type ?? 'unknown')
}

// Last name for grouping: prefer the explicit column, else the last whitespace token
// of the full name (ignoring a trailing suffix like Jr/Sr/III is out of scope here).
export function lastNameOf(contact: Pick<MaterializableContact, 'last_name' | 'full_name'>): string {
  const explicit = (contact.last_name || '').trim()
  if (explicit) return explicit
  const parts = (contact.full_name || '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * Deterministic household grouping key. Two contacts sharing a normalized last name
 * AND street (with zip as a further qualifier) resolve to the SAME key and group
 * into one household. A contact with no usable last name+street falls back to a
 * per-contact solo key, so it gets its own single-member household — never merged
 * into an unrelated family.
 */
export function householdOriginKey(contact: MaterializableContact): string {
  const last = nameKey(lastNameOf(contact))
  const street = streetKey(contact.address)
  if (last && street) {
    const z = zipKey(contact.zip)
    return `hh:${last}|${street}${z ? `|${z}` : ''}`
  }
  return `hh:solo:${contact.id}`
}

function properCaseLast(name: string): string {
  const t = (name || '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

export function deriveHouseholdName(contact: MaterializableContact, grouped: boolean): string {
  if (grouped) {
    const last = properCaseLast(lastNameOf(contact))
    if (last) return `${last} Household`
  }
  return (contact.full_name || '').trim() || 'Household'
}

// ── plan ─────────────────────────────────────────────────────────────────────
export interface HouseholdFields {
  primary_name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  owner_scope: string | null
  referring_agency_id: string | null
  origin_key: string
}
export interface MemberFields {
  full_name: string
  email: string | null
  phone: string | null
  relationship: string
  source_contact_id: string
  /** Known for the 'grouped' case; filled by the executor after insert for 'created'. */
  household_id: string | null
}
export interface MaterializePlan {
  action: 'ineligible' | 'exists' | 'grouped' | 'created'
  originKey: string | null
  createHousehold: boolean
  householdFields: HouseholdFields | null
  createMember: boolean
  memberFields: MemberFields | null
  /** Set contacts.household_id to this. Null for the 'created' case (id not known until insert). */
  linkHouseholdId: string | null
}

export interface ExistingLinks {
  /** Household id of an existing member already materialized for this contact, if any. */
  memberHouseholdId?: string | null
  /** Household id already registered under this contact's origin_key, if any. */
  householdIdForKey?: string | null
}

/**
 * Pure decision: given the contact and what already exists (a member for this
 * contact, and/or a household for its origin_key), decide whether to create a
 * household, add a member to an existing household, or do nothing. Never mutates.
 */
export function planMaterialization(contact: MaterializableContact, existing: ExistingLinks): MaterializePlan {
  if (!isMaterializable(contact)) {
    return { action: 'ineligible', originKey: null, createHousehold: false, householdFields: null, createMember: false, memberFields: null, linkHouseholdId: null }
  }
  const originKey = householdOriginKey(contact)

  // Already materialized for this contact → just ensure the contact points at the
  // member's household (repairs a half-linked state); no new rows.
  if (existing.memberHouseholdId) {
    return { action: 'exists', originKey, createHousehold: false, householdFields: null, createMember: false, memberFields: null, linkHouseholdId: existing.memberHouseholdId }
  }

  const baseMember = (household_id: string | null, relationship: string): MemberFields => ({
    full_name: (contact.full_name || '').trim() || 'Unnamed contact',
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    relationship,
    source_contact_id: contact.id,
    household_id,
  })

  // A household already exists for this key → add this contact as a member of it.
  if (existing.householdIdForKey) {
    return {
      action: 'grouped',
      originKey,
      createHousehold: false,
      householdFields: null,
      createMember: true,
      memberFields: baseMember(existing.householdIdForKey, 'member'),
      linkHouseholdId: existing.householdIdForKey,
    }
  }

  // New household + its first (primary) member.
  const householdFields: HouseholdFields = {
    primary_name: deriveHouseholdName(contact, originKey.startsWith('hh:solo:') ? false : true),
    address: contact.address ?? null,
    city: contact.city ?? null,
    state: contact.state ?? 'TX',
    zip: contact.zip ?? null,
    owner_scope: contact.owner_scope ?? null,
    referring_agency_id: contact.agency_partnership_id ?? null,
    origin_key: originKey,
  }
  return {
    action: 'created',
    originKey,
    createHousehold: true,
    householdFields,
    createMember: true,
    memberFields: baseMember(null, 'primary'),
    linkHouseholdId: null,
  }
}

// ── execute ──────────────────────────────────────────────────────────────────
export interface MaterializeResult {
  action: 'ineligible' | 'exists' | 'grouped' | 'created' | 'error'
  householdId: string | null
  memberId: string | null
  createdHousehold: boolean
  createdMember: boolean
  error?: string
}

const UNIQUE_VIOLATION = '23505'

/**
 * Idempotently materialize one contact into the household spine and link it. Safe to
 * call repeatedly and concurrently: unique constraints on origin_key and
 * source_contact_id turn a race into a re-select, never a duplicate. Best-effort per
 * contact — returns an 'error' result rather than throwing, so a batch never aborts.
 */
export async function materializeContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  contact: MaterializableContact,
): Promise<MaterializeResult> {
  try {
    if (!isMaterializable(contact)) {
      return { action: 'ineligible', householdId: null, memberId: null, createdHousehold: false, createdMember: false }
    }
    const originKey = householdOriginKey(contact)

    // Look up the two idempotency anchors.
    const { data: existingMember } = await db
      .from('household_members')
      .select('id, household_id')
      .eq('source_contact_id', contact.id)
      .maybeSingle()
    const { data: existingHousehold } = existingMember
      ? { data: null }
      : await db.from('households').select('id').eq('origin_key', originKey).maybeSingle()

    const plan = planMaterialization(contact, {
      memberHouseholdId: existingMember?.household_id ?? null,
      householdIdForKey: (existingHousehold as { id: string } | null)?.id ?? null,
    })

    if (plan.action === 'exists') {
      if (plan.linkHouseholdId) {
        await db.from('contacts').update({ household_id: plan.linkHouseholdId }).eq('id', contact.id).is('household_id', null)
      }
      return { action: 'exists', householdId: plan.linkHouseholdId, memberId: existingMember?.id ?? null, createdHousehold: false, createdMember: false }
    }

    // Resolve the target household id (create it if the plan says so).
    let householdId = plan.linkHouseholdId
    let createdHousehold = false
    if (plan.createHousehold && plan.householdFields) {
      const { data: inserted, error } = await db.from('households').insert(plan.householdFields).select('id').single()
      if (error) {
        // A concurrent run created it first — re-select by the unique origin_key.
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          const { data: found } = await db.from('households').select('id').eq('origin_key', originKey).maybeSingle()
          householdId = (found as { id: string } | null)?.id ?? null
        } else {
          return { action: 'error', householdId: null, memberId: null, createdHousehold: false, createdMember: false, error: error.message }
        }
      } else {
        householdId = inserted.id as string
        createdHousehold = true
      }
    }
    if (!householdId) {
      return { action: 'error', householdId: null, memberId: null, createdHousehold, createdMember: false, error: 'no household resolved' }
    }

    // Insert the member (idempotent on source_contact_id).
    let memberId: string | null = null
    let createdMember = false
    if (plan.createMember && plan.memberFields) {
      const row = { ...plan.memberFields, household_id: householdId }
      const { data: m, error: mErr } = await db.from('household_members').insert(row).select('id').single()
      if (mErr) {
        if ((mErr as { code?: string }).code === UNIQUE_VIOLATION) {
          const { data: found } = await db.from('household_members').select('id, household_id').eq('source_contact_id', contact.id).maybeSingle()
          memberId = (found as { id: string; household_id: string } | null)?.id ?? null
          householdId = (found as { id: string; household_id: string } | null)?.household_id ?? householdId
        } else {
          return { action: 'error', householdId, memberId: null, createdHousehold, createdMember: false, error: mErr.message }
        }
      } else {
        memberId = m.id as string
        createdMember = true
      }
    }

    // Link the contact to its household (only if still unlinked).
    await db.from('contacts').update({ household_id: householdId }).eq('id', contact.id).is('household_id', null)

    return { action: createdHousehold ? 'created' : 'grouped', householdId, memberId, createdHousehold, createdMember }
  } catch (e) {
    return { action: 'error', householdId: null, memberId: null, createdHousehold: false, createdMember: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface BackfillSummary {
  scanned: number
  householdsCreated: number
  membersCreated: number
  linked: number
  errors: number
}

const ORPHAN_COLS =
  'id, full_name, first_name, last_name, email, phone, address, city, state, zip, contact_type, agency_partnership_id, owner_scope'

/**
 * Backfill unlinked, client-eligible contacts into the household spine. Bounded per
 * run (`limit`) so a large book drains across scheduled runs like the reconcile pass,
 * without a long single transaction. Idempotent: only scans household_id IS NULL, so
 * a linked contact is never reprocessed.
 */
export async function backfillOrphanHouseholds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  limit = 500,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { scanned: 0, householdsCreated: 0, membersCreated: 0, linked: 0, errors: 0 }

  const { data } = await db
    .from('contacts')
    .select(ORPHAN_COLS)
    .is('household_id', null)
    .is('deleted_at', null)
    .in('contact_type', MATERIALIZABLE_TYPES as unknown as string[])
    .order('created_at', { ascending: true })
    .limit(limit)

  const orphans = (data ?? []) as MaterializableContact[]
  for (const c of orphans) {
    summary.scanned++
    const r = await materializeContact(db, c)
    if (r.action === 'error') summary.errors++
    if (r.createdHousehold) summary.householdsCreated++
    if (r.createdMember) summary.membersCreated++
    if (r.householdId && r.action !== 'error') summary.linked++
  }
  return summary
}
