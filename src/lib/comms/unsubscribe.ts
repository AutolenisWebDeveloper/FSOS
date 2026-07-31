// src/lib/comms/unsubscribe.ts
// Three-life-campaigns launch — email deliverability (CAN-SPAM + RFC 8058 one-click).
//
// Impure wrapper over unsubscribe-core: supplies the site origin, the monitored opt-out
// mailbox, and the signing secret, and performs the ONE enforced suppression the gate
// reads (§6 — a single suppression path shared by the human /unsubscribe page, the
// emailed per-recipient link, and the List-Unsubscribe one-click header). Suppression
// writes dnc_entries (contact-keyed) which gate step 3 (onDNC) blocks on — so an opt-out
// actually stops future sends, not merely a legacy ledger flag.

// Relative imports (not the "@/" alias) so this module compiles under the offline,
// bare-tsc test harness that pulls it in via the dispatcher's dynamic import — matching
// dispatcher.ts's own import style. Ditto: normalization is inlined below rather than
// importing conversations.ts (which uses the alias) so the compile graph stays clean.
import { getDb } from '../supabase/client'
import { recordConsentChange } from './consent-events'
import { smsTail } from './contact-consent'
import { siteUrl, CONTACT } from '../site'
import {
  type UnsubChannel,
  buildUnsubscribeUrl as buildUrl,
  listUnsubscribeHeaders as buildHeaders,
  verifyUnsubscribe as verifyCore,
} from './unsubscribe-core'

export type { UnsubChannel }

/** Signing secret for one-click tokens; null when unconfigured (degraded/dev — see core). */
function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.RESEND_WEBHOOK_SECRET || null
}

/**
 * Normalize a contact for the DNC store, IDENTICAL to conversations.normalizeContact
 * (email → trim+lowercase; phone → keep leading +, strip non-digits) so a stored DNC row
 * matches the destination the gate normalizes at send time. Inlined to avoid importing
 * conversations.ts into this module's offline-compiled graph.
 */
function normFor(channel: 'email' | 'sms', contact: string): string {
  const v = (contact || '').trim()
  if (channel === 'email') return v.toLowerCase()
  const plus = v.startsWith('+') ? '+' : ''
  return plus + v.replace(/[^\d]/g, '')
}

/** Per-recipient human-facing unsubscribe URL (goes in the email footer via merge token). */
export function emailUnsubscribeUrl(contact: string): string {
  return buildUrl(siteUrl(), contact, 'email')
}

/** RFC 8058 List-Unsubscribe headers for a marketing email to `contact`. */
export function emailListUnsubscribeHeaders(contact: string): Record<string, string> {
  return buildHeaders({ base: siteUrl(), replyEmail: replyToAddress(), contact, channel: 'email', secret: secret() })
}

/** The monitored reply / opt-out inbox (RESEND_REPLY_TO overrides the NAP email). */
export function replyToAddress(): string {
  return process.env.RESEND_REPLY_TO || CONTACT.email
}

/** Verify a one-click unsubscribe token against the configured secret. */
export function verifyOneClick(contact: string, channel: UnsubChannel, token: string | null | undefined): boolean {
  return verifyCore(contact, channel, token, secret())
}

/**
 * ENFORCED suppression: upsert dnc_entries for each requested channel so gate step 3
 * (onDNC) blocks all future sends to this contact. Idempotent (onConflict contact,channel).
 * Contacts are normalized the same way the gate normalizes the send destination, so a
 * stored DNC row matches. Best-effort audit. Never throws.
 */
export async function suppressContact(
  contact: string,
  channel: UnsubChannel = 'all',
): Promise<{ ok: boolean; channels: string[] }> {
  const channels: ('email' | 'sms')[] = channel === 'all' ? ['email', 'sms'] : [channel === 'sms' ? 'sms' : 'email']
  const rows = channels.map((ch) => ({
    contact: normFor(ch, contact),
    channel: ch,
    scope: 'internal' as const,
    reason: 'unsubscribe',
  }))
  try {
    const db = getDb()
    await db.from('dnc_entries').upsert(rows, { onConflict: 'contact,channel' })
    // Best-effort: resolve the member/household this contact belongs to so the opt-out is
    // anchored on the customer 360 timeline (not only audit-only). A bare contact with no
    // member (e.g. a public email with no household) is still audited via recordConsentChange.
    const anchor = await resolveContactAnchor(db, contact, channels)
    for (const ch of channels) {
      // ONE consent-logging path → audit_log AND (when a member/household is known) the CRM
      // timeline. Suppress is modeled as a channel-scoped revoke (§C).
      await recordConsentChange({
        actor: 'system',
        channel: ch,
        newStatus: 'revoked',
        previousStatus: 'granted',
        source: 'unsubscribe',
        reason: 'unsubscribe opt-out',
        memberId: anchor.memberId,
        householdId: anchor.householdId,
      })
    }
    return { ok: true, channels }
  } catch {
    return { ok: false, channels }
  }
}

/**
 * Best-effort resolve the household member behind an unsubscribing contact so the opt-out
 * lands on the customer 360 timeline. Email is matched normalized; SMS tolerantly on the
 * last-10 digits (like the send-path DNC match). Returns nulls when unresolved (audit-only).
 */
async function resolveContactAnchor(
  db: ReturnType<typeof getDb>,
  contact: string,
  channels: ('email' | 'sms')[],
): Promise<{ memberId: string | null; householdId: string | null }> {
  try {
    if (channels.includes('email') && contact.includes('@')) {
      const { data } = await db
        .from('household_members')
        .select('id, household_id')
        .ilike('email', normFor('email', contact))
        .limit(1)
      const m = Array.isArray(data) ? data[0] : null
      if (m) return { memberId: m.id as string, householdId: (m.household_id as string) ?? null }
    }
    const tail = smsTail(contact)
    if (channels.includes('sms') && tail.length === 10) {
      const { data } = await db
        .from('household_members')
        .select('id, household_id')
        .ilike('phone', `%${tail}`)
        .limit(1)
      const m = Array.isArray(data) ? data[0] : null
      if (m) return { memberId: m.id as string, householdId: (m.household_id as string) ?? null }
    }
  } catch {
    /* best-effort */
  }
  return { memberId: null, householdId: null }
}
