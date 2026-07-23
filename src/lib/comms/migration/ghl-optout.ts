// src/lib/comms/migration/ghl-optout.ts
// D0 GHL opt-out migration — PURE planner (no I/O, unit-testable offline).
//
// Maps a raw GHL DND/opt-out/unsubscribe record into the writes the FSOS
// compliance gate ACTUALLY ENFORCES at send time (send.ts):
//   • dnc_entries — contact-keyed suppression, checked by onDNC (gate step 3).
//     This is the FAIL-CLOSED enforcement: it needs only a phone/email, no member,
//     so an opt-out we can't resolve to a member is still honored.
//   • consents    — member-keyed revoke, checked by hasConsent (gate step 1).
//     Written ONLY when a member resolves. Insert-only-when-absent so the
//     migration never clobbers an existing consent row and rollback is a clean
//     delete-by-marker.
//
// It NEVER targets consent_ledger — send.ts/gate.ts never read it, so a row there
// does not suppress anything (that was the whole point of the D0 correction).
//
// Mirrors the STOP path in inbound.ts (revoke consents + add dnc_entries) so the
// migrated state is indistinguishable from a native opt-out. Pure + relative-import-
// free → compiles standalone for tests/ghl-optout-migration.test.mjs.

/** Channels the FSOS gate reasons about for SMS/email suppression. */
export type OptOutChannel = 'sms' | 'email'

/** One raw opt-out record exported from GHL (DND/optout/unsubscribe). */
export interface GhlOptOutRecord {
  ghl_contact_id?: string | null
  email?: string | null
  phone?: string | null
  /** GHL's raw channel token — inconsistent across DND vs workflow payloads. */
  channel?: string | null
  /** Original opt-out timestamp from GHL. PRESERVED verbatim — never "now()". */
  opted_out_at?: string | null
}

/** A household member resolved from a GHL contact (filled by the importer's DB lookup). */
export interface ResolvedMember {
  member_id: string
  household_id: string | null
}

export interface DncWrite {
  target: 'dnc_entries'
  contact: string // phone (sms) or lowercased email (email)
  channel: OptOutChannel
  scope: 'internal'
  reason: 'ghl_migration'
  created_at: string | null // original GHL timestamp, preserved
}

export interface ConsentWrite {
  target: 'consents'
  member_id: string
  household_id: string | null
  channel: OptOutChannel
  status: 'revoked'
  source: 'ghl_migration'
  captured_at: string | null // original GHL timestamp, preserved
}

export type OptOutWrite = DncWrite | ConsentWrite

export interface OptOutPlan {
  writes: OptOutWrite[]
  channels: OptOutChannel[]
  /** True when a channel has NO member AND NO contact value → nothing can enforce it. */
  unresolved: boolean
  notes: string[]
}

/**
 * Normalize GHL's channel token into the affected FSOS channels.
 * Matches the GHL webhook's conservative rule: an explicit email-only opt-out
 * clears email; SMS/text/phone clears SMS; anything ambiguous (all, both,
 * wildcard, dnd, empty, or unknown) clears BOTH — the safe default.
 */
export function normalizeOptOutChannels(raw: string | null | undefined): OptOutChannel[] {
  const v = (raw ?? '').toString().trim().toLowerCase()
  if (v === 'email') return ['email']
  if (v === 'sms' || v === 'text' || v === 'phone') return ['sms']
  // all | both | * | dnd | '' | any unknown token → both channels (conservative).
  return ['sms', 'email']
}

/** The contact string the dnc_entries row uses for a given channel, or null if absent. */
export function contactForChannel(rec: GhlOptOutRecord, ch: OptOutChannel): string | null {
  const raw = ch === 'email' ? rec.email : rec.phone
  const v = (raw ?? '').toString().trim()
  if (!v) return null
  return ch === 'email' ? v.toLowerCase() : v
}

/**
 * Plan the enforceable writes for one GHL opt-out record.
 *   • dnc_entries per channel whenever a contact value exists (fail-closed, member-free).
 *   • consents revoke per channel only when a member resolved (member-keyed mirror).
 *   • unresolved=true if any channel has neither a member nor a contact value.
 * Timestamps are carried through unchanged so the audit trail keeps GHL's original dates.
 */
export function planOptOut(rec: GhlOptOutRecord, member: ResolvedMember | null): OptOutPlan {
  const channels = normalizeOptOutChannels(rec.channel)
  const writes: OptOutWrite[] = []
  const notes: string[] = []
  const ts = rec.opted_out_at ?? null
  let unresolved = false

  for (const ch of channels) {
    const contact = contactForChannel(rec, ch)
    if (contact) {
      writes.push({
        target: 'dnc_entries',
        contact,
        channel: ch,
        scope: 'internal',
        reason: 'ghl_migration',
        created_at: ts,
      })
    }
    if (member) {
      writes.push({
        target: 'consents',
        member_id: member.member_id,
        household_id: member.household_id,
        channel: ch,
        status: 'revoked',
        source: 'ghl_migration',
        captured_at: ts,
      })
    } else if (!contact) {
      unresolved = true
      notes.push(`unresolved:${ch} — no member and no ${ch === 'email' ? 'email' : 'phone'}; cannot enforce`)
    } else {
      notes.push(`fail-closed:${ch} — no member → dnc_entries only`)
    }
  }

  return { writes, channels, unresolved, notes }
}

/**
 * Does the plan produce an enforceable suppression on this channel?
 * True if it writes a dnc_entries row (blocks at gate step 3) OR revokes consent
 * (blocks at gate step 1) for the channel. Used by the reconciliation report and
 * by the enforcement test that runs the result through evaluateGate.
 */
export function planEnforcesChannel(plan: OptOutPlan, ch: OptOutChannel): boolean {
  return plan.writes.some(
    (w) =>
      w.channel === ch &&
      (w.target === 'dnc_entries' || (w.target === 'consents' && w.status === 'revoked')),
  )
}
