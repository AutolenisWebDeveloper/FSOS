// src/lib/comms/contact-consent-read.ts
// The CONTACT-RESOLVABLE consent and DNC reads, extracted from send.ts so the dispatch
// chokepoint (messaging.ts → dispatch-policy.ts) can perform them without importing the
// message-preparation layer.
//
// These are the reads that let a BARE caller — a transactional acknowledgement that knows
// only an email address — be gated identically to a campaign send. They resolve entirely
// from the destination address, which is why consolidating the nine ungated paths was
// possible at all.
//
// TOLERANT MATCHING IS LOAD-BEARING. A STOP arrives from the carrier as full E.164
// (`+1XXXXXXXXXX`) while an outbound `to` may be stored bare (`XXXXXXXXXX`). An exact
// string match would miss the opt-out row and re-message a suppressed recipient, so SMS is
// matched on the last-10-digit suffix and email on the lower-cased address.
//
// EVERY FUNCTION HERE FAILS SAFE. A lookup error returns the RESTRICTIVE answer — no
// consent, on-DNC, revoked — never the permissive one. An unverifiable control must never
// resolve to "allowed".

import { getDb } from '../supabase/client'
import { latestConsentGranted, smsTail } from './contact-consent'
import { purposeToConsentPurpose, type MessagePurpose } from './purpose'

export type Channel = 'sms' | 'email'

/**
 * Durable, CONTACT-RESOLVABLE consent (comm_contact_consents, migration 074) for a lead
 * captured at public intake before any household member exists. Latest action wins — a
 * later `revoked` overrides an earlier `granted`.
 *
 * Scope: callers apply this ONLY when the contact has not resolved to a household member.
 * Once a member exists the member-keyed `consents` table is authoritative, so this can
 * never re-grant a member-level revoke.
 */
export async function durableContactConsentGranted(contact: string, channel: Channel): Promise<boolean> {
  try {
    const db = getDb()
    if (channel === 'sms') {
      const tail = smsTail(contact)
      if (tail.length < 10) return false
      const { data } = await db
        .from('comm_contact_consents')
        .select('action, captured_at')
        .eq('channel', 'sms')
        .ilike('contact', `%${tail}`)
        .order('captured_at', { ascending: false })
        .limit(1)
      return latestConsentGranted(data as { action: string; captured_at: string }[] | null)
    }
    const { data } = await db
      .from('comm_contact_consents')
      .select('action, captured_at')
      .eq('channel', channel)
      .eq('contact', contact.toLowerCase())
      .order('captured_at', { ascending: false })
      .limit(1)
    return latestConsentGranted(data as { action: string; captured_at: string }[] | null)
  } catch {
    return false // fail closed — never grant on a lookup failure
  }
}

/**
 * An explicit opt-out / revoke at ANY level — member channel revoke, purpose-scoped revoke,
 * or the latest contact-level action being `revoked`. Used only to keep the console /
 * self-test consent WAIVER opt-out-safe: a revoke here disables the waiver so the normal
 * consent step blocks the send.
 *
 * Fails SAFE (returns true = treat as revoked), so a lookup failure can never turn a waiver
 * into an unwanted send.
 */
export async function contactConsentRevoked(
  memberId: string | null | undefined,
  contact: string,
  channel: Channel,
  purpose?: MessagePurpose,
): Promise<boolean> {
  try {
    const db = getDb()
    if (memberId) {
      const { data } = await db.from('consents').select('status').eq('member_id', memberId).eq('channel', channel).maybeSingle()
      if (data?.status === 'revoked') return true
      if (purpose) {
        const consentPurpose = purposeToConsentPurpose(purpose, channel)
        const { data: pr } = await db
          .from('comm_consent_purposes')
          .select('status')
          .eq('member_id', memberId)
          .eq('channel', channel)
          .eq('purpose', consentPurpose)
          .maybeSingle()
        if (pr?.status === 'revoked') return true
      }
    }
    if (channel === 'sms') {
      const tail = smsTail(contact)
      if (tail.length < 10) return false
      const { data } = await db
        .from('comm_contact_consents')
        .select('action, captured_at')
        .eq('channel', 'sms')
        .ilike('contact', `%${tail}`)
        .order('captured_at', { ascending: false })
        .limit(1)
      const rows = data as { action: string; captured_at: string }[] | null
      return Array.isArray(rows) && rows.length > 0 && !latestConsentGranted(rows) && rows[0]?.action === 'revoked'
    }
    const { data } = await db
      .from('comm_contact_consents')
      .select('action, captured_at')
      .eq('channel', channel)
      .eq('contact', contact.toLowerCase())
      .order('captured_at', { ascending: false })
      .limit(1)
    const rows = data as { action: string; captured_at: string }[] | null
    return Array.isArray(rows) && rows.length > 0 && !latestConsentGranted(rows) && rows[0]?.action === 'revoked'
  } catch {
    return true // fail safe: unverifiable ⇒ treat as revoked, waiver does not apply
  }
}

/**
 * Recipient on internal/external DNC for this channel (gate step 3). SMS matches on the
 * last-10-digit suffix so carrier-format drift cannot miss a STOP row; email matches the
 * normalized address. Fails SAFE (blocked) on any error — never send blindly.
 */
export async function isOnDNC(to: string, channel: Channel): Promise<boolean> {
  try {
    const db = getDb()
    if (channel === 'sms') {
      const digits = to.replace(/[^\d]/g, '')
      const tail = digits.slice(-10)
      if (tail.length < 10) {
        const { data } = await db.from('dnc_entries').select('id').eq('contact', to).in('channel', ['sms', 'all']).limit(1)
        return Array.isArray(data) && data.length > 0
      }
      const { data } = await db
        .from('dnc_entries')
        .select('id')
        .in('channel', ['sms', 'all'])
        .ilike('contact', `%${tail}`)
        .limit(1)
      return Array.isArray(data) && data.length > 0
    }
    const { data } = await db.from('dnc_entries').select('id').eq('contact', to).in('channel', ['email', 'all']).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch {
    return true // fail safe
  }
}
