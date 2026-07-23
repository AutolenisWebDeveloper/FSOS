// src/lib/services/dataQualityReconcile.ts
// The Data Quality agent's contact-reconciliation pass. Runs on a schedule (and
// on demand) so that agency owners created by ANY path — the single-create form,
// older data, or a partial import — are automatically pulled into the unified
// Contact Center: matched to the right existing contact, merged non-destructively
// (missing address/phone/email filled), or created, with ambiguous matches left
// for manual review. It reuses the exact same engine the importers use
// (resolution.ts + applyOwnerContactResolution), so the rules never diverge.
//
// Scope is deliberately bounded and safe: it links UNLINKED owners
// (agency_owners.contact_id IS NULL) into the book, and it COUNTS (does not
// silently collapse) existing duplicate contact rows — collapsing two existing
// contacts requires re-pointing every foreign key and is out of scope for an
// automated pass. Nothing here overwrites a valid existing value.

import { getDb } from '@/lib/supabase/client'
import { buildContactIndex } from '@/lib/import/resolution'
import { loadContactCandidates } from '@/lib/import/auditWriter'
import { applyOwnerContactResolution, type AgencyOwnerContactInput } from '@/lib/services/agencyOwnerContact'

const SYSTEM = 'system'

export interface OwnerReconcileSummary {
  scanned: number
  merged: number
  created: number
  review: number
  linked: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface OwnerRow {
  id: string
  agency_id: string
  full_name: string
  email: string | null
  phone: string | null
  mobile_phone: string | null
  agency: {
    fnwl_serving_agent_no: string | null
    office_address: string | null
    office_city: string | null
    office_state: string | null
    office_zip: string | null
  } | null
}

/**
 * Reconcile agency owners that have no Contact Center link yet. Bounded per run
 * (`limit`) so a large backlog drains across scheduled runs without a long single
 * transaction. Idempotent: once an owner is linked it is skipped next time.
 */
export async function reconcileAgencyOwnerContacts(limit = 500): Promise<OwnerReconcileSummary> {
  const db = getDb()
  const summary: OwnerReconcileSummary = { scanned: 0, merged: 0, created: 0, review: 0, linked: 0 }

  const { data: owners } = await db
    .from('agency_owners')
    .select(
      'id, agency_id, full_name, email, phone, mobile_phone, agency:agency_partnerships!inner(fnwl_serving_agent_no, office_address, office_city, office_state, office_zip)',
    )
    .is('contact_id', null)
    .limit(limit)

  const rows = (owners ?? []) as unknown as OwnerRow[]
  if (rows.length === 0) return summary

  // Build the resolution index once from the existing book.
  const index = buildContactIndex(await loadContactCandidates(db))

  for (const o of rows) {
    summary.scanned++
    const ap = o.agency
    const input: AgencyOwnerContactInput = {
      agencyId: o.agency_id,
      agentCode: ap?.fnwl_serving_agent_no ?? null,
      ownerName: o.full_name,
      email: o.email,
      businessPhone: o.phone,
      mobilePhone: o.mobile_phone,
      address: ap?.office_address ?? null,
      city: ap?.office_city ?? null,
      state: ap?.office_state ?? null,
      zip: ap?.office_zip ?? null,
    }
    const applied = await applyOwnerContactResolution(db, index, input, SYSTEM)
    if (applied.status === 'merged') summary.merged++
    else if (applied.status === 'created') summary.created++
    else summary.review++
    if (applied.contactId) {
      await db.from('agency_owners').update({ contact_id: applied.contactId }).eq('id', o.id)
      summary.linked++
    }
  }

  return summary
}

/** Count existing duplicate contact groups (same email or phone) — flagged, not collapsed. */
export async function countContactDuplicates(): Promise<number> {
  const db = getDb()
  const { count } = await db.from('v_contact_duplicates').select('*', { count: 'exact', head: true })
  return count ?? 0
}
