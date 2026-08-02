// src/lib/comms/consent-revoke.ts
// A2P 10DLC / TCPA — PURE planner for BULK consent REVOKE (the safe direction). Given a set of
// household members and the selected channels, plan one `revoked` consents row per member ×
// channel. Revoke ALWAYS applies (it IS suppression — the §12 gate's first winner), so there
// is no suppression check here; the only no-op is a member already revoked on that channel.
//
// Semantics (mirrors the bulk-update contract): a member with an existing `granted` row is
// UPDATED to revoked; a member with NO row gets a `revoked` row CREATED (an explicit opt-out
// record); a member already `revoked` is an idempotent no-op skip. The previous status is
// carried on each decision so the audit trail records previous → new value.
//
// No DB, no clock — unit-testable offline (tests/consent-revoke.test.mjs).

import {
  indexExistingConsents,
  consentKey,
  type MemberForPopulation,
  type ExistingConsentRow,
  type PopChannel,
} from './consent-population'

export type RevokeSkipReason = 'already_revoked'

export interface RevokeDecision {
  memberId: string
  householdId: string
  channel: PopChannel
  revoke: boolean
  /** The status before this decision ('none' when no row exists) — for the audit trail. */
  previousStatus: string
  skipReason?: RevokeSkipReason
}

export interface RevokeReport {
  membersProcessed: number
  smsRevoked: number
  emailRevoked: number
  skippedAlreadyRevoked: number
}

export function emptyRevokeReport(): RevokeReport {
  return { membersProcessed: 0, smsRevoked: 0, emailRevoked: 0, skippedAlreadyRevoked: 0 }
}

/** Decide a single (member, channel): revoke (create/update), or no-op if already revoked. */
export function decideRevoke(
  member: MemberForPopulation,
  channel: PopChannel,
  existing: Map<string, string>,
): RevokeDecision {
  const previousStatus = existing.get(consentKey(member.id, channel)) ?? 'none'
  const base = { memberId: member.id, householdId: member.household_id, channel, previousStatus }
  if (previousStatus === 'revoked') return { ...base, revoke: false, skipReason: 'already_revoked' }
  return { ...base, revoke: true }
}

/**
 * Plan the whole revoke: one decision per member × selected channel, plus the aggregate report.
 * `smsRevoked`/`emailRevoked` are the INTENDED writes (create or update); an already-revoked
 * member+channel is tallied under `skippedAlreadyRevoked`.
 */
export function planRevoke(
  members: MemberForPopulation[],
  existing: ExistingConsentRow[],
  channels: PopChannel[],
): { decisions: RevokeDecision[]; report: RevokeReport } {
  const existingIdx = indexExistingConsents(existing)
  const order: PopChannel[] = ['sms', 'email']
  const active = order.filter((c) => channels.includes(c))
  const decisions: RevokeDecision[] = []
  const report = emptyRevokeReport()
  report.membersProcessed = members.length

  for (const m of members) {
    for (const channel of active) {
      const d = decideRevoke(m, channel, existingIdx)
      decisions.push(d)
      if (d.revoke) {
        if (channel === 'sms') report.smsRevoked++
        else report.emailRevoked++
      } else {
        report.skippedAlreadyRevoked++
      }
    }
  }
  return { decisions, report }
}
