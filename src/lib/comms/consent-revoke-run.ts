// src/lib/comms/consent-revoke-run.ts
// The DB runner for BULK consent REVOKE. Given a set of household-member ids + an explicit
// documented basis, it reads the world for exactly those members, plans the revokes with the
// PURE core (consent-revoke.ts), and writes each `revoked` row (create-or-update), recording
// the previous → new value on every change for the audit trail (§13.9). Revoke is the SAFE
// direction — it is the §12 gate's first suppression winner — so there is no suppression skip;
// the only no-op is a member already revoked on that channel.
//
// Thin service (business logic out of the route, §3.1). Shares the read/write/audit shape with
// the grant core so there is ONE consent-write pattern (§6) — grant and revoke differ only in
// the decision (suppression-aware add vs. always-revoke) and the row status written.

import { getDb } from '@/lib/supabase/client'
import { writeAudit, buildAuditRow } from '@/lib/audit/log'
import type { MemberForPopulation, ExistingConsentRow, PopChannel } from './consent-population'
import { planRevoke, emptyRevokeReport, type RevokeReport } from './consent-revoke'
import { buildConsentAuditEntry, buildConsentActivityRow, type ConsentChange } from './consent-events'

export interface RevokeConsentForMembersOptions {
  memberIds: string[]
  /** Provenance recorded in `consents.source` + the audit/timeline entry. */
  source: string
  /** Documented basis written verbatim onto every revoked row. */
  disclosure: string
  channels: PopChannel[]
  actor: string
  /** Preview only — read + plan, write nothing. */
  dryRun?: boolean
  auditEntity?: string
  auditDiffExtra?: Record<string, unknown>
}

export interface RevokeConsentForMembersResult extends RevokeReport {
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

export async function revokeConsentForMembers(
  opts: RevokeConsentForMembersOptions,
): Promise<RevokeConsentForMembersResult> {
  const { source, disclosure, actor } = opts
  const channels = (['sms', 'email'] as PopChannel[]).filter((c) => opts.channels.includes(c))
  const memberIds = uniq(opts.memberIds)
  const capturedAt = new Date().toISOString()

  const empty: RevokeConsentForMembersResult = { ...emptyRevokeReport(), source, channels, capturedAt }
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

  const { decisions, report } = planRevoke(members, existing, channels)

  // ── Preview: return the PLANNED report, write nothing ───────────────────────
  if (opts.dryRun) return { ...report, source, channels, capturedAt }

  // ── Write revokes (create-or-update to revoked); audit previous → new ───────
  const revokes = decisions.filter((d) => d.revoke)
  const written = { ...emptyRevokeReport(), membersProcessed: report.membersProcessed, skippedAlreadyRevoked: report.skippedAlreadyRevoked }

  for (const rchunk of chunk(revokes, WRITE_CHUNK)) {
    const rows = rchunk.map((d) => ({
      member_id: d.memberId,
      household_id: d.householdId,
      channel: d.channel,
      status: 'revoked' as const,
      source,
      disclosure,
      captured_at: capturedAt,
    }))
    // NOT ignoreDuplicates: a granted row must be UPDATED to revoked (revoke wins).
    const { data: writtenRows, error } = await db
      .from('consents')
      .upsert(rows, { onConflict: 'member_id,channel' })
      .select('member_id, household_id, channel')
    if (error) throw error
    const done = (writtenRows ?? []) as { member_id: string; household_id: string; channel: PopChannel }[]

    // Index the previous status per member+channel from the plan for the audit trail.
    const prev = new Map<string, string>()
    for (const d of rchunk) prev.set(`${d.memberId}:${d.channel}`, d.previousStatus)

    const auditRows: ReturnType<typeof buildAuditRow>[] = []
    const activityRows: NonNullable<ReturnType<typeof buildConsentActivityRow>>[] = []
    for (const r of done) {
      if (r.channel === 'sms') written.smsRevoked++
      else written.emailRevoked++
      const change: ConsentChange = {
        actor,
        channel: r.channel,
        newStatus: 'revoked',
        previousStatus: (prev.get(`${r.member_id}:${r.channel}`) as ConsentChange['previousStatus']) ?? 'none',
        source,
        reason: disclosure,
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
        /* best-effort; the run-summary audit below still records the revoke */
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

  // The bulk revoke is itself an audited event — one summary row with the report.
  await writeAudit({
    actor,
    action: 'config.changed',
    entity: opts.auditEntity ?? 'consent_bulk_revoke',
    entityId: null,
    diff: {
      ...(opts.auditDiffExtra ?? {}),
      source,
      channels,
      captured_at: capturedAt,
      members_processed: written.membersProcessed,
      sms_revoked: written.smsRevoked,
      email_revoked: written.emailRevoked,
      skipped_already_revoked: written.skippedAlreadyRevoked,
    },
  })

  return { ...written, source, channels, capturedAt }
}
