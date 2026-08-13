// src/lib/comms/suppression.ts
// Agent-level & Client-level BUSINESS communication suppression (master build instruction:
// "Agent-Level and Client-Level Communication Suppression").
//
// This is a SEPARATE policy layer from the regulatory controls (consent, DNC/STOP, email
// unsubscribe, bounce/complaint). It lets the FSA exclude an agent's ENTIRE BOOK, or
// individual/bulk clients, from applicable NON-transactional outreach. It NEVER reads or
// writes the regulatory stores, so unblocking here can never reactivate a regulatory
// prohibition — the regulatory layers are evaluated independently at the gate.
//
// Two design guarantees:
//   • No physical duplication. Agent-level suppression is a single policy row on the agency
//     (comm_agency_suppressions); the effective decision for a contact is COMPUTED here at
//     send time from the layers, so a client newly assigned to a blocked agent inherits the
//     restriction automatically and a reassigned client recalculates automatically.
//   • Fail closed. If effective suppression cannot be RELIABLY determined (a lookup error /
//     timeout), the decision is `suppressed` — unknown never becomes allowed. (A successful
//     lookup that finds no blocking row is a reliable "not suppressed" and IS allowed, even
//     when a contact/agency does not resolve — there is simply nothing to suppress against.)
//
// Layer ordering (spec): individual suppression → agent/book suppression. The decision
// logic here is pure and the DB reads are behind an injectable `reader` seam, so the
// ordering + fail-closed behavior is unit-testable offline (tests/comms-suppression.test.mjs).

import type { MessagePurpose } from './purpose'

/**
 * Whether BUSINESS suppression even applies to a send of this purpose. It targets
 * NON-transactional outreach only (marketing, campaigns, nurture, promotional, AI-initiated
 * outreach). Legitimate transactional/servicing messages — appointment confirmations,
 * requested servicing, application/document/deadline notices, transaction notifications —
 * are NEVER business-suppressed.
 *
 * FAIL CLOSED on unknown classification: an absent/unrecognized purpose is treated as
 * suppressible (the unclassified campaign path defaults to marketing, exactly as the
 * quiet-hours scope does), so an unclassified send can never bypass suppression by omitting
 * its purpose.
 */
const TRANSACTIONAL_PURPOSES: ReadonlySet<MessagePurpose> = new Set<MessagePurpose>([
  'TRANSACTIONAL',
  'SERVICING',
  'APPOINTMENT',
  'APPLICATION_STATUS',
  'DOCUMENT_REQUEST',
  'POLICY_DEADLINE',
])

export function businessSuppressionApplies(purpose?: MessagePurpose | string | null): boolean {
  if (!purpose) return true // unknown/unclassified → fail closed (treat as suppressible)
  return !TRANSACTIONAL_PURPOSES.has(purpose as MessagePurpose)
}

/** Signals that determine whether a specific send is subject to business suppression. */
export interface SuppressibilityInput {
  purpose?: MessagePurpose | string | null
  /** A deliberate human-typed 1:1 send — never automated outreach. */
  humanAuthored?: boolean
  /** A verified-self pipeline test — not client outreach. */
  isTest?: boolean
  /** Explicit opt-out for a known transactional/servicing caller with no marketing purpose. */
  suppressible?: boolean
}

/**
 * Whether a send is subject to BUSINESS suppression. Business suppression targets NON-
 * transactional AUTOMATED/AI outreach only, so it never applies to a human-authored 1:1, a
 * test send, an explicitly-declared transactional caller, or a transactional/servicing purpose.
 * Unknown/absent purpose on an automated send still fails CLOSED (suppressible). PURE +
 * unit-tested — the send path and any other caller share this single classification.
 */
export function isBusinessSuppressible(opts: SuppressibilityInput): boolean {
  if (opts.humanAuthored === true) return false
  if (opts.isTest === true) return false
  if (opts.suppressible === false) return false
  return businessSuppressionApplies(opts.purpose)
}

/** The identifiers available at send time to resolve the two policy layers. */
export interface SuppressionSubject {
  /** household_members.id (send path). */
  memberId?: string | null
  /** households.id. */
  householdId?: string | null
  /** agency_partnerships.id (the "agent"/book). */
  agencyId?: string | null
  /** contacts.id (the Contact Center identity). */
  contactId?: string | null
  /** Recipient phone (sms) — tolerant last-10 match fallback to a contact. */
  phone?: string | null
  /** Recipient email — lower-cased exact match fallback to a contact. */
  email?: string | null
}

export type SuppressionLayer = 'none' | 'individual' | 'agent_book'

export interface SuppressionDecision {
  /** True → do NOT send (blocked by business suppression, or fail-closed). */
  suppressed: boolean
  /** False → the state could not be reliably determined (a lookup error); fail-closed. */
  resolved: boolean
  /** Which layer produced the block (for audit + UI distinction). */
  layer: SuppressionLayer
  reason?: string
}

/** Raw layer signals for a subject. `load` THROWS on any lookup failure (→ fail closed). */
export interface SuppressionReader {
  load(subject: SuppressionSubject): Promise<{ clientBlocked: boolean; agencyBlocked: boolean }>
}

const REASON = {
  individual: 'Client is individually blocked from FSOS outreach.',
  agent_book: "Client's agent is blocked from FSOS outreach (agent-level book suppression).",
  failClosed: 'Effective suppression could not be determined — send withheld (fail closed).',
} as const

/**
 * Resolve the effective BUSINESS suppression for a subject. Individual layer wins over the
 * agent/book layer (spec ordering), and any lookup failure fails closed. PURE decision over
 * the injected reader — the default reader (below) performs the real DB reads.
 */
export async function resolveEffectiveSuppression(
  subject: SuppressionSubject,
  reader: SuppressionReader = defaultSuppressionReader,
): Promise<SuppressionDecision> {
  try {
    const { clientBlocked, agencyBlocked } = await reader.load(subject)
    if (clientBlocked) return { suppressed: true, resolved: true, layer: 'individual', reason: REASON.individual }
    if (agencyBlocked) return { suppressed: true, resolved: true, layer: 'agent_book', reason: REASON.agent_book }
    return { suppressed: false, resolved: true, layer: 'none' }
  } catch {
    // FAIL CLOSED: database error, timeout, orphaned/inconsistent state, unexpected null.
    return { suppressed: true, resolved: false, layer: 'none', reason: REASON.failClosed }
  }
}

/** Digits-only last-10 suffix of a phone (tolerant match, like the DNC read). */
function smsTail(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '').slice(-10)
}

/**
 * BATCH pre-filter for campaign audience resolution (the "campaign eligibility" layer). Given
 * candidate agencies + members, returns the blocked agency ids and the member ids whose
 * individual client suppression is active — so the broadcast audience can proactively exclude
 * recipients the send gate would only block anyway.
 *
 * This is an OPTIMIZATION, not the enforcement boundary: the send gate + provider-boundary
 * re-check remain authoritative and fail CLOSED per recipient. So this helper is best-effort —
 * on any lookup error it returns EMPTY sets (fail open here) rather than silently dropping an
 * entire campaign; every candidate then still faces the fail-closed gate at send time. It never
 * weakens enforcement; it only removes known-blocked recipients earlier.
 */
export async function loadBlockedSets(params: {
  agencyIds: string[]
  memberIds: string[]
}): Promise<{ blockedAgencyIds: Set<string>; blockedMemberIds: Set<string> }> {
  const blockedAgencyIds = new Set<string>()
  const blockedMemberIds = new Set<string>()
  try {
    const { getDb } = await import('../supabase/client')
    const db = getDb()
    const agencyIds = [...new Set(params.agencyIds.filter(Boolean))]
    const memberIds = [...new Set(params.memberIds.filter(Boolean))]

    if (agencyIds.length > 0) {
      const { data, error } = await db
        .from('comm_agency_suppressions')
        .select('agency_id')
        .eq('status', 'blocked')
        .in('agency_id', agencyIds)
      if (error) throw error
      for (const r of (data ?? []) as { agency_id: string }[]) blockedAgencyIds.add(r.agency_id)
    }

    if (memberIds.length > 0) {
      // member → contact (source_contact_id) → individual suppression.
      const { data: members, error: mErr } = await db
        .from('household_members')
        .select('id, source_contact_id')
        .in('id', memberIds)
      if (mErr) throw mErr
      const byContact = new Map<string, string[]>() // contact_id → member ids
      for (const m of (members ?? []) as { id: string; source_contact_id: string | null }[]) {
        if (!m.source_contact_id) continue
        const arr = byContact.get(m.source_contact_id) ?? []
        arr.push(m.id)
        byContact.set(m.source_contact_id, arr)
      }
      const contactIds = [...byContact.keys()]
      if (contactIds.length > 0) {
        const { data: blocked, error: cErr } = await db
          .from('comm_client_suppressions')
          .select('contact_id')
          .eq('status', 'blocked')
          .in('contact_id', contactIds)
        if (cErr) throw cErr
        for (const r of (blocked ?? []) as { contact_id: string }[]) {
          for (const mid of byContact.get(r.contact_id) ?? []) blockedMemberIds.add(mid)
        }
      }
    }
  } catch {
    // Fail OPEN here (return whatever we gathered; empty on early error). The send gate is the
    // fail-closed authority, so an error here never lets a suppressed recipient actually receive
    // a message — it just defers the exclusion to the per-send gate.
    return { blockedAgencyIds, blockedMemberIds }
  }
  return { blockedAgencyIds, blockedMemberIds }
}

/**
 * Default DB-backed reader. Resolves the contact id (individual layer) and agency id
 * (agent/book layer) from whatever the subject carries, then checks the two suppression
 * tables. Every query checks its `error` and THROWS so a lookup failure propagates to the
 * fail-closed catch in resolveEffectiveSuppression — a read error must never read as "not
 * blocked". A query that simply finds no row is a reliable "not blocked".
 */
export const defaultSuppressionReader: SuppressionReader = {
  async load(subject: SuppressionSubject): Promise<{ clientBlocked: boolean; agencyBlocked: boolean }> {
    // Relative import (like dispatcher.ts) so this module compiles standalone for the
    // offline unit test, which injects a fake reader and never reaches this default.
    const { getDb } = await import('../supabase/client')
    const db = getDb()

    // ── Resolve the contact id for the individual layer ──────────────────────
    let contactId: string | null = subject.contactId ?? null
    if (!contactId && subject.memberId) {
      const { data, error } = await db
        .from('household_members')
        .select('source_contact_id')
        .eq('id', subject.memberId)
        .maybeSingle()
      if (error) throw error
      contactId = (data?.source_contact_id as string | null) ?? null
    }
    if (!contactId && (subject.email || subject.phone)) {
      if (subject.email) {
        const { data, error } = await db
          .from('contacts')
          .select('id')
          .eq('email_lc', subject.email.toLowerCase())
          .is('deleted_at', null)
          .limit(1)
        if (error) throw error
        contactId = (Array.isArray(data) && data.length > 0 ? data[0].id : null) as string | null
      }
      if (!contactId && subject.phone) {
        const tail = smsTail(subject.phone)
        if (tail.length >= 10) {
          const { data, error } = await db
            .from('contacts')
            .select('id')
            .eq('phone_digits', tail)
            .is('deleted_at', null)
            .limit(1)
          if (error) throw error
          contactId = (Array.isArray(data) && data.length > 0 ? data[0].id : null) as string | null
        }
      }
    }

    // ── Resolve the agency id for the agent/book layer ───────────────────────
    let agencyId: string | null = subject.agencyId ?? null
    if (!agencyId && subject.householdId) {
      const { data, error } = await db
        .from('households')
        .select('referring_agency_id')
        .eq('id', subject.householdId)
        .maybeSingle()
      if (error) throw error
      agencyId = (data?.referring_agency_id as string | null) ?? null
    }
    if (!agencyId && contactId) {
      const { data, error } = await db
        .from('contacts')
        .select('agency_partnership_id')
        .eq('id', contactId)
        .maybeSingle()
      if (error) throw error
      agencyId = (data?.agency_partnership_id as string | null) ?? null
    }
    if (!agencyId && subject.memberId) {
      // member → household → referring agency (when neither agency nor household was given).
      const { data, error } = await db
        .from('household_members')
        .select('household_id')
        .eq('id', subject.memberId)
        .maybeSingle()
      if (error) throw error
      const hhId = (data?.household_id as string | null) ?? null
      if (hhId) {
        const { data: hh, error: hhErr } = await db
          .from('households')
          .select('referring_agency_id')
          .eq('id', hhId)
          .maybeSingle()
        if (hhErr) throw hhErr
        agencyId = (hh?.referring_agency_id as string | null) ?? null
      }
    }

    // ── Check the two policy layers ──────────────────────────────────────────
    let clientBlocked = false
    if (contactId) {
      const { data, error } = await db
        .from('comm_client_suppressions')
        .select('status')
        .eq('contact_id', contactId)
        .eq('status', 'blocked')
        .limit(1)
      if (error) throw error
      clientBlocked = Array.isArray(data) && data.length > 0
    }

    let agencyBlocked = false
    if (agencyId) {
      const { data, error } = await db
        .from('comm_agency_suppressions')
        .select('status')
        .eq('agency_id', agencyId)
        .eq('status', 'blocked')
        .limit(1)
      if (error) throw error
      agencyBlocked = Array.isArray(data) && data.length > 0
    }

    return { clientBlocked, agencyBlocked }
  },
}
