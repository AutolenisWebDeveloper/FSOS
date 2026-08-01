// src/lib/comms/consent-group-grant.ts
// A2P 10DLC / TCPA — PURE planner for CONSENT-GROUP grants at bulk import. Given a set of
// household members (the just-imported contacts) and a consent group's selected channels,
// plan one `granted` consents row per member × selected channel.
//
// This does NOT re-implement the suppression rules — it REUSES the shared decision core
// (consent-population.ts): an existing revoke, a channel DNC (tolerant of +1/bare drift), or
// a do_not_contact household all still WIN, so a bulk group grant can only ADD consent and
// can never re-consent someone who opted out (CLAUDE.md §6 — one suppression path, §12 gate
// stays authoritative). The only difference from the existing-client population is that the
// operator chooses WHICH channels a group covers, so we iterate the selected channels
// instead of always both. No DB, no clock — unit-testable offline.

import {
  decideChannel,
  indexExistingConsents,
  buildSuppressionIndex,
  emptyReport,
  type MemberForPopulation,
  type ExistingConsentRow,
  type DncRow,
  type ChannelDecision,
  type PopChannel,
  type PopulationReport,
} from './consent-population'

/**
 * Plan the grants for a group import: one decision per member × selected channel, plus the
 * aggregate report. `membersProcessed` counts distinct members considered; `smsCreated` /
 * `emailCreated` are the INTENDED grants (the DB insert reconciles the ACTUAL created count
 * under ON CONFLICT DO NOTHING). A member suppressed on a channel is tallied by reason.
 */
export function planGroupGrants(
  members: MemberForPopulation[],
  existing: ExistingConsentRow[],
  dnc: DncRow[],
  dncHouseholdIds: string[],
  channels: PopChannel[],
): { decisions: ChannelDecision[]; report: PopulationReport } {
  const existingIdx = indexExistingConsents(existing)
  const suppression = buildSuppressionIndex(dnc, dncHouseholdIds)
  const decisions: ChannelDecision[] = []
  const report = emptyReport()
  report.membersProcessed = members.length

  // De-duplicate + stabilise the channel set (defensive — the registry already normalises).
  const order: PopChannel[] = ['sms', 'email']
  const active = order.filter((c) => channels.includes(c))

  for (const m of members) {
    for (const channel of active) {
      const d = decideChannel(m, channel, existingIdx, suppression)
      decisions.push(d)
      if (d.grant) {
        if (channel === 'sms') report.smsCreated++
        else report.emailCreated++
      } else {
        switch (d.skipReason) {
          case 'already_granted':
            report.skippedAlreadyGranted++
            break
          case 'revoked':
            report.skippedRevoked++
            break
          case 'dnc':
            report.skippedDnc++
            break
          case 'household_dnc':
            report.skippedHouseholdDnc++
            break
        }
      }
    }
  }
  return { decisions, report }
}
