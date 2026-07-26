// src/lib/services/contactConsolidation.ts
// Slice 1 — Contact Center consolidation report. Reads the read-only reporting
// views (migration 070) plus the existing duplicate-detection view and shapes them
// into one typed report the Contact Center surfaces. It does NOT introduce a new
// staging area or a second dedup path — staging remains import_batches/import_records
// and dedup remains src/lib/import/resolution.ts (ADR-028); this only observes the
// canonical book so its consolidation state — above all the enrollment-blocking
// orphan count — is visible in-product.

import type { SupabaseClient } from '@supabase/supabase-js'

// The single-row shape v_contact_consolidation returns.
export interface ConsolidationSummaryRow {
  total: number
  orphaned: number
  /** household_id IS NULL AND a client-eligible type — the number that blocks enrollment. */
  orphaned_eligible: number
  /** household_id IS NULL AND agency_owner/business — orphaned by design (B2B). */
  orphaned_ineligible: number
  linked: number
  with_email: number
  with_phone: number
  unreachable: number
  typed: number
  untyped: number
  active: number
  archived: number
}

export interface SourceBreakdownRow {
  source: string
  total: number
  orphaned: number
}

export interface ContactConsolidationReport {
  total: number
  /** household_id IS NULL (any type). */
  orphaned: number
  /** household_id IS NULL AND client-eligible — the enrollment-blocking count Slice 3 drives to zero. */
  orphanedEligible: number
  /** household_id IS NULL AND B2B (agency_owner/business) — orphaned by design. */
  orphanedIneligible: number
  linked: number
  withEmail: number
  withPhone: number
  /** Neither email nor phone — cannot be reached on any channel. */
  unreachable: number
  typed: number
  untyped: number
  active: number
  archived: number
  /** Distinct groups of contacts sharing a normalized email or phone (detected, not merged). */
  duplicateGroups: number
  /** Per-source counts, largest first, orphan count per source. */
  bySource: SourceBreakdownRow[]
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Pure shaping — turns the raw view rows into the typed report. Extracted so the
 * report contract is unit-testable without a database. `summary` may be null when
 * the book is empty or the view read failed; that yields an all-zero report rather
 * than throwing, so the dashboard tile always renders.
 */
export function shapeConsolidationReport(
  summary: Partial<ConsolidationSummaryRow> | null | undefined,
  duplicateGroups: number,
  bySource: SourceBreakdownRow[] | null | undefined,
): ContactConsolidationReport {
  const s = summary ?? {}
  const sources = (bySource ?? [])
    .map((r) => ({ source: r.source || '(unspecified)', total: num(r.total), orphaned: num(r.orphaned) }))
    .sort((a, b) => b.total - a.total)
  return {
    total: num(s.total),
    orphaned: num(s.orphaned),
    orphanedEligible: num(s.orphaned_eligible),
    orphanedIneligible: num(s.orphaned_ineligible),
    linked: num(s.linked),
    withEmail: num(s.with_email),
    withPhone: num(s.with_phone),
    unreachable: num(s.unreachable),
    typed: num(s.typed),
    untyped: num(s.untyped),
    active: num(s.active),
    archived: num(s.archived),
    duplicateGroups: num(duplicateGroups),
    bySource: sources,
  }
}

/**
 * Load the consolidation report. Read-only; degrades to an all-zero report on any
 * failure so the surface never crashes. Views encapsulate the aggregation, so the
 * PostgREST select strings carry no SQL expressions (per the data-guardrail rule).
 */
export async function loadContactConsolidationReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
): Promise<ContactConsolidationReport> {
  const [summaryRes, dupRes, sourceRes] = await Promise.all([
    db.from('v_contact_consolidation').select('total, orphaned, orphaned_eligible, orphaned_ineligible, linked, with_email, with_phone, unreachable, typed, untyped, active, archived').maybeSingle(),
    db.from('v_contact_duplicates').select('*', { count: 'exact', head: true }),
    db.from('v_contact_by_source').select('source, total, orphaned'),
  ])
  return shapeConsolidationReport(
    (summaryRes.data as ConsolidationSummaryRow | null) ?? null,
    dupRes.count ?? 0,
    (sourceRes.data as SourceBreakdownRow[] | null) ?? [],
  )
}
