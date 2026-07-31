// src/lib/comms/consent-population-run.ts
// §B — the DB runner for existing-client consent population. Reads the current
// members + existing consents + DNC + do_not_contact households, plans the grants with the
// PURE core (consent-population.ts), then:
//   • inserts each `granted` row IDEMPOTENTLY (upsert onConflict member_id,channel,
//     ignoreDuplicates — the DB never duplicates a row nor overwrites a later `revoked`),
//   • records ONLY the rows ACTUALLY created to audit_log + the CRM timeline (so a re-run
//     produces zero new audit/timeline noise), and
//   • writes ONE summary audit event for the run itself (the bulk population is an audited
//     event, §B).
//
// Thin service (business logic out of the route, CLAUDE.md §3.1). Uses the '@/' alias like
// the rest of src/lib (it is never part of the offline tsc test compile — the pure core is).

import { getDb } from '@/lib/supabase/client'
import { writeAudit, buildAuditRow } from '@/lib/audit/log'
import {
  planPopulation,
  buildConsentGrantRow,
  emptyReport,
  type MemberForPopulation,
  type ExistingConsentRow,
  type DncRow,
  type PopulationReport,
  type PopChannel,
} from './consent-population'
import { buildConsentAuditEntry, buildConsentActivityRow, type ConsentChange } from './consent-events'

export interface RunConsentPopulationOptions {
  /** Audit actor (the authenticated admin/super user, or 'system'). */
  actor: string
  /** Preview only — plan + report without writing anything. */
  dryRun?: boolean
  /** Consent source label recorded on every seeded row. */
  source?: string
}

export interface RunConsentPopulationResult extends PopulationReport {
  dryRun: boolean
  source: string
  populatedAt: string
}

const PAGE = 1000
const WRITE_CHUNK = 500

/** Page through a table fully (the service role bypasses RLS for this ops-scoped read). */
async function loadAll<T>(
  select: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await select(from, from + PAGE - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Populate channel-wide `granted` consent for every current client member. Idempotent and
 * re-runnable. Returns the report (members processed, sms/email created, and each skip
 * bucket). A dry run computes the same plan without writing.
 */
export async function runConsentPopulation(
  opts: RunConsentPopulationOptions,
): Promise<RunConsentPopulationResult> {
  const db = getDb()
  const source = opts.source ?? 'existing_client_optin'
  const populatedAt = new Date().toISOString()

  // ── Read the world (current members + existing consents + suppression) ──────
  const members = await loadAll<MemberForPopulation>(async (from, to) => {
    const { data, error } = await db
      .from('household_members')
      .select('id, household_id, email, phone')
      .order('id', { ascending: true })
      .range(from, to)
    return { data: data as MemberForPopulation[] | null, error }
  })
  const existing = await loadAll<ExistingConsentRow>(async (from, to) => {
    const { data, error } = await db
      .from('consents')
      .select('member_id, channel, status')
      .not('member_id', 'is', null)
      .order('member_id', { ascending: true })
      .range(from, to)
    return { data: data as ExistingConsentRow[] | null, error }
  })
  const dnc = await loadAll<DncRow>(async (from, to) => {
    const { data, error } = await db
      .from('dnc_entries')
      .select('contact, channel')
      .order('contact', { ascending: true })
      .range(from, to)
    return { data: data as DncRow[] | null, error }
  })
  const dncHouseholdsRows = await loadAll<{ id: string }>(async (from, to) => {
    const { data, error } = await db
      .from('households')
      .select('id')
      .eq('do_not_contact', true)
      .order('id', { ascending: true })
      .range(from, to)
    return { data: data as { id: string }[] | null, error }
  })
  const dncHouseholdIds = dncHouseholdsRows.map((h) => h.id)

  const { decisions, report } = planPopulation(members, existing, dnc, dncHouseholdIds)

  if (opts.dryRun) {
    return { ...report, dryRun: true, source, populatedAt }
  }

  // ── Insert grants idempotently; only ACTUALLY-created rows get audited/timelined ──
  const grants = decisions.filter((d) => d.grant)
  const created = emptyReport()
  created.membersProcessed = report.membersProcessed
  created.skippedAlreadyGranted = report.skippedAlreadyGranted
  created.skippedRevoked = report.skippedRevoked
  created.skippedDnc = report.skippedDnc
  created.skippedHouseholdDnc = report.skippedHouseholdDnc

  for (const group of chunk(grants, WRITE_CHUNK)) {
    const rows = group.map((d) => buildConsentGrantRow(d.memberId, d.householdId, d.channel, source, populatedAt))
    // ignoreDuplicates → INSERT ... ON CONFLICT (member_id,channel) DO NOTHING. The returned
    // rows are ONLY those actually inserted, so a re-run inserts (and logs) nothing.
    const { data: insertedRows, error } = await db
      .from('consents')
      .upsert(rows, { onConflict: 'member_id,channel', ignoreDuplicates: true })
      .select('member_id, household_id, channel')
    if (error) throw error
    const inserted = (insertedRows ?? []) as { member_id: string; household_id: string; channel: PopChannel }[]

    // Per-created-row consent change → audit_log + CRM timeline (batched inserts).
    const auditRows: ReturnType<typeof buildAuditRow>[] = []
    const activityRows: NonNullable<ReturnType<typeof buildConsentActivityRow>>[] = []
    for (const r of inserted) {
      if (r.channel === 'sms') created.smsCreated++
      else created.emailCreated++
      const change: ConsentChange = {
        actor: opts.actor,
        channel: r.channel,
        newStatus: 'granted',
        previousStatus: 'none',
        source,
        reason: 'existing client — communications opt-in on file',
        memberId: r.member_id,
        householdId: r.household_id,
      }
      auditRows.push(buildAuditRow(buildConsentAuditEntry(change)))
      const act = buildConsentActivityRow(change)
      if (act) activityRows.push(act)
    }
    if (auditRows.length) {
      // audit_log is INSERT-only for the app role (migration 010/077) — a direct batch
      // insert is the same durable append writeAudit performs, one round-trip per chunk.
      try {
        await db.from('audit_log').insert(auditRows)
      } catch {
        /* best-effort; the run-summary audit below still records the population */
      }
    }
    if (activityRows.length) {
      try {
        await db.from('activities').insert(activityRows)
      } catch {
        /* best-effort CRM timeline */
      }
    }
  }

  // The bulk population is itself an audited event (§B) — one summary row with the report.
  await writeAudit({
    actor: opts.actor,
    action: 'config.changed',
    entity: 'consent_population',
    entityId: null,
    diff: {
      source,
      populated_at: populatedAt,
      members_processed: created.membersProcessed,
      sms_created: created.smsCreated,
      email_created: created.emailCreated,
      skipped_already_granted: created.skippedAlreadyGranted,
      skipped_revoked: created.skippedRevoked,
      skipped_dnc: created.skippedDnc,
      skipped_household_dnc: created.skippedHouseholdDnc,
    },
  })

  return { ...created, dryRun: false, source, populatedAt }
}
