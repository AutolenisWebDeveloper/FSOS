// src/lib/comms/consent-population.ts
// §B — one-time (re-runnable) consent population for EXISTING clients. All current
// household members are existing clients with recorded opt-in on file; hasConsent()
// returns false without a granted row, so this seeds a channel-wide `granted` row for
// BOTH sms and email for every current client member — WITHOUT ever overriding a later
// opt-out.
//
// This is the PURE decision core (no DB, no clock) so it is unit-testable offline
// (tests/consent-population.test.mjs). The DB runner (consent-population-run.ts) reads the
// members/consents/DNC, calls planPopulation(), inserts the grants idempotently, and logs
// each grant to audit_log + the CRM timeline via consent-events.ts.
//
// The three suppression winners (a later opt-out always beats this backfill):
//   1. an existing `revoked` consent row for that member+channel (explicit opt-out),
//   2. the contact is on dnc_entries for that channel (STOP / unsubscribe / manual DNC),
//   3. the household is flagged do_not_contact.
// Idempotency is guaranteed both here (an existing `granted` row is a no-op skip) AND at
// the DB (unique(member_id,channel) + ON CONFLICT DO NOTHING) so a re-run never duplicates
// or overwrites.

import { smsTail } from './contact-consent'

export type PopChannel = 'sms' | 'email'
export const POP_CHANNELS: PopChannel[] = ['sms', 'email']

export interface MemberForPopulation {
  id: string
  household_id: string
  email?: string | null
  phone?: string | null
}

export interface ExistingConsentRow {
  member_id: string
  channel: string
  status: string
}

/** A dnc_entries row (contact + channel in sms/email/call/all). */
export interface DncRow {
  contact: string
  channel: string
}

export type SkipReason = 'already_granted' | 'revoked' | 'dnc' | 'household_dnc'

export interface ChannelDecision {
  memberId: string
  householdId: string
  channel: PopChannel
  grant: boolean
  skipReason?: SkipReason
}

export interface PopulationReport {
  membersProcessed: number
  smsCreated: number
  emailCreated: number
  skippedAlreadyGranted: number
  skippedRevoked: number
  skippedDnc: number
  skippedHouseholdDnc: number
}

export function emptyReport(): PopulationReport {
  return {
    membersProcessed: 0,
    smsCreated: 0,
    emailCreated: 0,
    skippedAlreadyGranted: 0,
    skippedRevoked: 0,
    skippedDnc: 0,
    skippedHouseholdDnc: 0,
  }
}

/** Email storage/match key — trimmed + lower-cased (identical to the send-path norm). */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase()
}

/** `${memberId}:${channel}` key for the existing-consent index. */
export function consentKey(memberId: string, channel: string): string {
  return `${memberId}:${channel}`
}

export interface SuppressionIndex {
  /** Normalized emails on DNC for channel email or all. */
  dncEmails: Set<string>
  /** 10-digit phone tails on DNC for channel sms or all (tolerant of +1/bare drift). */
  dncSmsTails: Set<string>
  /** Household ids flagged do_not_contact. */
  dncHouseholds: Set<string>
}

/**
 * Index the existing consents by member+channel → status. The channel-wide `consents`
 * table is unique on (member_id, channel), so at most one row exists per key.
 */
export function indexExistingConsents(rows: ExistingConsentRow[]): Map<string, string> {
  const idx = new Map<string, string>()
  for (const r of rows || []) {
    if (!r || !r.member_id || !r.channel) continue
    idx.set(consentKey(r.member_id, r.channel), r.status)
  }
  return idx
}

/** Build the suppression index from DNC rows + do_not_contact household ids. */
export function buildSuppressionIndex(dnc: DncRow[], dncHouseholdIds: string[]): SuppressionIndex {
  const dncEmails = new Set<string>()
  const dncSmsTails = new Set<string>()
  for (const d of dnc || []) {
    if (!d || !d.contact || !d.channel) continue
    const ch = d.channel
    if (ch === 'email' || ch === 'all') dncEmails.add(normalizeEmail(d.contact))
    if (ch === 'sms' || ch === 'all') {
      const tail = smsTail(d.contact)
      if (tail.length === 10) dncSmsTails.add(tail)
    }
  }
  return { dncEmails, dncSmsTails, dncHouseholds: new Set(dncHouseholdIds || []) }
}

/**
 * Decide a single (member, channel): grant, or skip with a reason. A later opt-out always
 * wins — an existing revoke, a channel DNC, or a do_not_contact household all skip. An
 * existing grant is a no-op skip (idempotent re-run). A member with no contact value for
 * the channel is STILL granted (consent is member-keyed permission; there is simply nothing
 * suppressible to check, and a grant lets a later-added contact send without re-consenting).
 */
export function decideChannel(
  member: MemberForPopulation,
  channel: PopChannel,
  existing: Map<string, string>,
  suppression: SuppressionIndex,
): ChannelDecision {
  const base = { memberId: member.id, householdId: member.household_id, channel }
  const status = existing.get(consentKey(member.id, channel))
  if (status === 'granted') return { ...base, grant: false, skipReason: 'already_granted' }
  if (status === 'revoked') return { ...base, grant: false, skipReason: 'revoked' }
  if (suppression.dncHouseholds.has(member.household_id)) return { ...base, grant: false, skipReason: 'household_dnc' }

  const contact = channel === 'email' ? member.email : member.phone
  if (contact) {
    if (channel === 'email' && suppression.dncEmails.has(normalizeEmail(contact))) {
      return { ...base, grant: false, skipReason: 'dnc' }
    }
    if (channel === 'sms' && suppression.dncSmsTails.has(smsTail(contact))) {
      return { ...base, grant: false, skipReason: 'dnc' }
    }
  }
  return { ...base, grant: true }
}

/**
 * Plan the whole population: one decision per member × channel, plus the aggregate report.
 * `membersProcessed` counts distinct members considered; the created counts here are the
 * INTENDED grants (the DB insert reconciles the ACTUAL created count under ON CONFLICT).
 */
export function planPopulation(
  members: MemberForPopulation[],
  existing: ExistingConsentRow[],
  dnc: DncRow[],
  dncHouseholdIds: string[],
): { decisions: ChannelDecision[]; report: PopulationReport } {
  const existingIdx = indexExistingConsents(existing)
  const suppression = buildSuppressionIndex(dnc, dncHouseholdIds)
  const decisions: ChannelDecision[] = []
  const report = emptyReport()
  report.membersProcessed = members.length

  for (const m of members) {
    for (const channel of POP_CHANNELS) {
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

/**
 * The channel-wide `granted` consents row for one member+channel (insert shape). The
 * `disclosure` records the DOCUMENTED BASIS of the grant for the TCPA/audit trail; callers
 * that seed consent from a different basis (e.g. an import consent group) pass their own so
 * the row honestly states why consent exists — it is never a generic blanket claim.
 */
export function buildConsentGrantRow(
  memberId: string,
  householdId: string,
  channel: PopChannel,
  source: string,
  capturedAtIso: string,
  disclosure = 'Existing client — communications opt-in on file at population.',
): {
  member_id: string
  household_id: string
  channel: PopChannel
  status: 'granted'
  source: string
  disclosure: string
  captured_at: string
} {
  return {
    member_id: memberId,
    household_id: householdId,
    channel,
    status: 'granted',
    source,
    disclosure,
    captured_at: capturedAtIso,
  }
}
