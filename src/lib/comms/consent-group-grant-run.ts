// src/lib/comms/consent-group-grant-run.ts
// The DB runner for CONSENT-GROUP grants at bulk import. Given the household-member ids just
// created/touched by an import and a consent group, it:
//   • reads the world for exactly those members (their existing consents + the suppression
//     signals: dnc_entries and do_not_contact households),
//   • plans the grants with the PURE core (consent-group-grant.ts → reuses the shared
//     suppression logic, so a later opt-out always wins),
//   • inserts each `granted` row IDEMPOTENTLY (upsert onConflict member_id,channel,
//     ignoreDuplicates — never a duplicate, never overwrites a later revoke), writing the
//     group's documented disclosure verbatim onto every row, and
//   • records ONLY the rows ACTUALLY created to audit_log + the CRM timeline, plus one
//     summary audit event for the group grant (a bulk consent write is an audited event, §B).
//
// Thin service (business logic out of the route, CLAUDE.md §3.1). It never fabricates
// consent: the operator's attestation is enforced at the route, and suppression is enforced
// here — this runner only turns an attested, un-suppressed member into a `granted` row.

import { getDb } from '@/lib/supabase/client'
import { writeAudit, buildAuditRow } from '@/lib/audit/log'
import {
  buildConsentGrantRow,
  emptyReport,
  type MemberForPopulation,
  type ExistingConsentRow,
  type DncRow,
  type PopChannel,
  type PopulationReport,
} from './consent-population'
import { planGroupGrants } from './consent-group-grant'
import { buildConsentAuditEntry, buildConsentActivityRow, type ConsentChange } from './consent-events'
import type { ConsentGroup } from './consent-groups'

export interface GrantConsentForGroupOptions {
  /** Household-member ids to seed consent for (the just-imported contacts' members). */
  memberIds: string[]
  /** The resolved consent group (source of the provenance + disclosure). */
  group: ConsentGroup
  /** Channels to seed (already intersected with the group's permitted channels). */
  channels: PopChannel[]
  /** Audit actor (the authenticated licensed operator). */
  actor: string
  /**
   * Preview only: read the world + plan the grants, but write NOTHING (no consents, no audit,
   * no timeline). Returns the PLANNED report (intended grants + per-reason skips) so a caller
   * can show the operator exactly what a commit would do before they attest. Suppression is
   * still fully applied, so the preview never overstates what would be granted.
   */
  dryRun?: boolean
}

export interface GrantConsentForGroupResult extends PopulationReport {
  groupKey: string
  source: string
  channels: PopChannel[]
  capturedAt: string
}

const READ_CHUNK = 300
const WRITE_CHUNK = 500

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)))

/**
 * Seed group consent for a specific set of members. Idempotent and suppression-aware.
 * Returns the report (members processed, sms/email created, each skip bucket). A member with
 * no selected channel to grant, or one fully suppressed, simply contributes zero grants.
 */
export async function grantConsentForGroup(
  opts: GrantConsentForGroupOptions,
): Promise<GrantConsentForGroupResult> {
  const { group, actor } = opts
  const channels = (['sms', 'email'] as PopChannel[]).filter((c) => opts.channels.includes(c))
  const memberIds = uniq(opts.memberIds)
  const capturedAt = new Date().toISOString()

  const empty: GrantConsentForGroupResult = {
    ...emptyReport(),
    groupKey: group.key,
    source: group.source,
    channels,
    capturedAt,
  }
  if (memberIds.length === 0 || channels.length === 0) return empty

  const db = getDb()

  // ── Read the world for exactly these members ────────────────────────────────
  const members: MemberForPopulation[] = []
  const existing: ExistingConsentRow[] = []
  for (const ids of chunk(memberIds, READ_CHUNK)) {
    const { data: m, error: mErr } = await db
      .from('household_members')
      .select('id, household_id, email, phone')
      .in('id', ids)
    if (mErr) throw mErr
    members.push(...((m ?? []) as MemberForPopulation[]))

    const { data: c, error: cErr } = await db
      .from('consents')
      .select('member_id, channel, status')
      .in('member_id', ids)
    if (cErr) throw cErr
    existing.push(...((c ?? []) as ExistingConsentRow[]))
  }
  if (members.length === 0) return empty

  // Suppression signals: all DNC entries (bounded ops table) + the do_not_contact households
  // AMONG this member set. Both make a later opt-out win over the bulk grant.
  const { data: dncRows, error: dncErr } = await db.from('dnc_entries').select('contact, channel')
  if (dncErr) throw dncErr
  const dnc = (dncRows ?? []) as DncRow[]

  const householdIds = uniq(members.map((m) => m.household_id))
  const dncHouseholdIds: string[] = []
  for (const ids of chunk(householdIds, READ_CHUNK)) {
    const { data: h, error: hErr } = await db
      .from('households')
      .select('id')
      .in('id', ids)
      .eq('do_not_contact', true)
    if (hErr) throw hErr
    for (const row of (h ?? []) as { id: string }[]) dncHouseholdIds.push(row.id)
  }

  const { decisions, report } = planGroupGrants(members, existing, dnc, dncHouseholdIds, channels)

  // ── Preview: return the PLANNED report, write nothing ────────────────────────────
  if (opts.dryRun) {
    return {
      ...report,
      groupKey: group.key,
      source: group.source,
      channels,
      capturedAt,
    }
  }

  // ── Insert grants idempotently; only ACTUALLY-created rows get audited/timelined ──
  const grants = decisions.filter((d) => d.grant)
  const created = { ...emptyReport(), membersProcessed: report.membersProcessed }
  created.skippedAlreadyGranted = report.skippedAlreadyGranted
  created.skippedRevoked = report.skippedRevoked
  created.skippedDnc = report.skippedDnc
  created.skippedHouseholdDnc = report.skippedHouseholdDnc

  for (const gchunk of chunk(grants, WRITE_CHUNK)) {
    const rows = gchunk.map((d) =>
      buildConsentGrantRow(d.memberId, d.householdId, d.channel, group.source, capturedAt, group.disclosure),
    )
    const { data: insertedRows, error } = await db
      .from('consents')
      .upsert(rows, { onConflict: 'member_id,channel', ignoreDuplicates: true })
      .select('member_id, household_id, channel')
    if (error) throw error
    const inserted = (insertedRows ?? []) as { member_id: string; household_id: string; channel: PopChannel }[]

    const auditRows: ReturnType<typeof buildAuditRow>[] = []
    const activityRows: NonNullable<ReturnType<typeof buildConsentActivityRow>>[] = []
    for (const r of inserted) {
      if (r.channel === 'sms') created.smsCreated++
      else created.emailCreated++
      const change: ConsentChange = {
        actor,
        channel: r.channel,
        newStatus: 'granted',
        previousStatus: 'none',
        source: group.source,
        reason: group.disclosure,
        memberId: r.member_id,
        householdId: r.household_id,
      }
      auditRows.push(buildAuditRow(buildConsentAuditEntry(change)))
      const act = buildConsentActivityRow(change)
      if (act) activityRows.push(act)
    }
    if (auditRows.length) {
      try {
        await db.from('audit_log').insert(auditRows)
      } catch {
        /* best-effort; the run-summary audit below still records the grant */
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

  // The bulk group grant is itself an audited event (§B) — one summary row with the report.
  await writeAudit({
    actor,
    action: 'config.changed',
    entity: 'consent_group_grant',
    entityId: null,
    diff: {
      group: group.key,
      source: group.source,
      channels,
      captured_at: capturedAt,
      members_processed: created.membersProcessed,
      sms_created: created.smsCreated,
      email_created: created.emailCreated,
      skipped_already_granted: created.skippedAlreadyGranted,
      skipped_revoked: created.skippedRevoked,
      skipped_dnc: created.skippedDnc,
      skipped_household_dnc: created.skippedHouseholdDnc,
    },
  })

  return { ...created, groupKey: group.key, source: group.source, channels, capturedAt }
}
