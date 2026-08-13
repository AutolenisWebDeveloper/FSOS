// src/lib/comms/suppression-admin.ts
// Admin/service layer for BUSINESS communication suppression — the mutations behind the
// agent-profile control and the client-management bulk actions, plus the read helpers the
// server components use to render effective status.
//
// EVERY state change goes through the SECURITY DEFINER RPC comm_suppression_apply (migration
// 115), which performs the suppression write AND the audit_log insert in ONE transaction. So
// the audit record is ATOMIC with the mutation: if the audit fails, the mutation rolls back —
// there is deliberately no app-level "mutate then best-effort writeAudit" here (that could
// leave a committed suppression un-audited). Any RPC error is returned to the caller and
// surfaced by the route, never swallowed.

import { getDb } from '@/lib/supabase/client'

export type SuppressionStatus = 'active' | 'blocked'

export interface ApplySuppressionParams {
  /** Acting user id (audit actor). */
  actor: string
  status: SuppressionStatus
  reason?: string | null
  scope: 'agency' | 'client'
  /** Required for scope 'agency'. agency_partnerships.id. */
  agencyId?: string | null
  /** Required for scope 'client'. contacts.id[]. */
  contactIds?: string[] | null
}

export interface SuppressionApplyResult {
  scope: string
  new_status: string
  previous_status?: string
  affected_count: number
  agency_id?: string
  contact_ids?: string[]
}

/**
 * Apply an agent-level or client-level suppression change atomically (mutation + audit).
 * Returns the RPC's summary, or an error string the route maps to a 4xx/5xx — never throws
 * into the caller.
 */
export async function applySuppression(
  p: ApplySuppressionParams,
): Promise<{ ok: true; summary: SuppressionApplyResult } | { ok: false; error: string }> {
  const { data, error } = await getDb().rpc('comm_suppression_apply', {
    p_scope: p.scope,
    p_status: p.status,
    p_actor: p.actor,
    p_reason: p.reason ?? null,
    p_agency_id: p.agencyId ?? null,
    p_contact_ids: p.contactIds ?? null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, summary: (data ?? {}) as SuppressionApplyResult }
}

/** Book size for an agency = its assigned Contact Center clients (excludes the owner + soft-deleted). */
export async function countAgencyBook(agencyId: string): Promise<number> {
  const { count } = await getDb()
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('agency_partnership_id', agencyId)
    .is('deleted_at', null)
    .neq('contact_type', 'agency_owner')
  return count ?? 0
}

export interface AgencySuppressionStatus {
  status: SuppressionStatus
  reason: string | null
  blocked_at: string | null
  blocked_by: string | null
  unblocked_at: string | null
  affected_count: number | null
  /** Current live book size (recomputed, not the block-time snapshot). */
  book_count: number
}

/** Current agent-level suppression status + live book size (for the agency profile). */
export async function getAgencySuppressionStatus(agencyId: string): Promise<AgencySuppressionStatus> {
  const db = getDb()
  const [{ data: row }, book] = await Promise.all([
    db
      .from('comm_agency_suppressions')
      .select('status, reason, blocked_at, blocked_by, unblocked_at, affected_count')
      .eq('agency_id', agencyId)
      .maybeSingle(),
    countAgencyBook(agencyId),
  ])
  return {
    status: (row?.status as SuppressionStatus) ?? 'active',
    reason: row?.reason ?? null,
    blocked_at: row?.blocked_at ?? null,
    blocked_by: row?.blocked_by ?? null,
    unblocked_at: row?.unblocked_at ?? null,
    affected_count: row?.affected_count ?? null,
    book_count: book,
  }
}

/** Blocked individual (client-level) contact ids within a candidate set. */
export async function getBlockedContactIds(contactIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(contactIds.filter(Boolean))]
  if (ids.length === 0) return new Set()
  const { data } = await getDb()
    .from('comm_client_suppressions')
    .select('contact_id')
    .eq('status', 'blocked')
    .in('contact_id', ids)
  return new Set(((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id))
}

/** Blocked agent-level agency ids within a candidate set. */
export async function getBlockedAgencyIds(agencyIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(agencyIds.filter(Boolean))]
  if (ids.length === 0) return new Set()
  const { data } = await getDb()
    .from('comm_agency_suppressions')
    .select('agency_id')
    .eq('status', 'blocked')
    .in('agency_id', ids)
  return new Set(((data ?? []) as { agency_id: string }[]).map((r) => r.agency_id))
}

/**
 * REGULATORY do-not-contact ids within a candidate set (for the contacts list, so DNC is
 * shown DISTINCTLY from business suppression — never as the same thing). Best-effort, tolerant
 * match mirroring the send-time onDNC read: email by lower-cased address, phone by last-10
 * suffix. Display-only — the authoritative DNC enforcement is the send gate. Bounded fetch.
 */
export async function getDncContactIds(
  contacts: { id: string; email_lc: string | null; phone_digits: string | null }[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (contacts.length === 0) return out
  try {
    const db = getDb()
    const emails = [...new Set(contacts.map((c) => (c.email_lc || '').toLowerCase()).filter(Boolean))]
    const byEmail = new Map<string, string[]>()
    for (const c of contacts) {
      const e = (c.email_lc || '').toLowerCase()
      if (!e) continue
      const arr = byEmail.get(e) ?? []
      arr.push(c.id)
      byEmail.set(e, arr)
    }
    if (emails.length > 0) {
      const { data } = await db
        .from('dnc_entries')
        .select('contact')
        .in('channel', ['email', 'all'])
        .in('contact', emails)
      for (const r of (data ?? []) as { contact: string }[]) {
        for (const id of byEmail.get((r.contact || '').toLowerCase()) ?? []) out.add(id)
      }
    }
    // Phones — tolerant last-10 match. Build a tail→contact map, fetch sms/all DNC rows and
    // compare suffixes (bounded fetch; the single-FSA DNC list is small).
    const byTail = new Map<string, string[]>()
    for (const c of contacts) {
      const tail = (c.phone_digits || '').replace(/[^\d]/g, '').slice(-10)
      if (tail.length < 10) continue
      const arr = byTail.get(tail) ?? []
      arr.push(c.id)
      byTail.set(tail, arr)
    }
    if (byTail.size > 0) {
      const { data } = await db.from('dnc_entries').select('contact').in('channel', ['sms', 'all']).limit(10000)
      for (const r of (data ?? []) as { contact: string }[]) {
        const tail = (r.contact || '').replace(/[^\d]/g, '').slice(-10)
        if (tail.length < 10) continue
        for (const id of byTail.get(tail) ?? []) out.add(id)
      }
    }
  } catch {
    /* best-effort display signal; the send gate is the authoritative DNC enforcement */
  }
  return out
}
