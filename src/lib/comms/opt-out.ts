// src/lib/comms/opt-out.ts
// The ONE writer for a channel opt-out, wherever it arrives from.
//
// FSOS learns that someone opted out through two independent routes, and until now only one of
// them wrote anything:
//   • an inbound STOP keyword on our own number   → inbound.ts (kept every store in sync);
//   • a CARRIER-level opt-out reported by Twilio on the delivery callback as ErrorCode 21610
//     ("attempt to send to unsubscribed recipient") → recorded as an event detail string and
//     nothing else, so the very next appointment re-attempted the same suppressed number.
//     That second route is not hypothetical: Twilio's own Advanced Opt-Out absorbs the STOP at
//     the carrier, so the keyword never reaches our inbound webhook at all.
//
// Both now land here, so an opt-out means the same thing to every store regardless of how we
// found out about it:
//   dnc_entries          — the ENFORCED suppression (gate step `dnc`, checked on every send);
//   comm_contact_consents— the contact-resolvable evidence store (latest-wins), which is the
//                          ONLY consent record a public booker has;
//   consents / comm_consent_purposes — the member-keyed stores, when the number resolves to a
//                          household member (a channel revoke also cascades to every scoped
//                          purpose grant, so a scoped grant can never survive a STOP).
//
// Best-effort by contract: an opt-out must never throw into a webhook handler and cause the
// provider to retry. The DNC write is first precisely because it is the enforced one.

// Relative (not the @/ alias): messaging.ts imports this module lazily, so it is part of the
// standalone-tsc chokepoint compile (tests/helpers/chokepoint.mjs), which has no path aliases.
import { getDb } from '../supabase/client'
import { recordConsentChange } from './consent-events'
import { PRIOR_MEMBER_GRANT_MARKER, KEYWORD_OPT_OUT_VERSION } from './contact-consent'

export type OptOutChannel = 'sms' | 'email'

export interface ChannelOptOut {
  /** Normalized contact key (normalizeContact / consentContactKey — they are byte-identical). */
  contact: string
  channel: OptOutChannel
  /** Provenance label recorded on the consent change, e.g. 'inbound_stop' or 'carrier_opt_out'. */
  source: string
  /** Human reason for the DNC row + audit trail. */
  reason: string
  /** Text stored as the consent record's evidence (what we know the person did). */
  consentText: string
  /** Version label for the consent record. Opt-outs use 'opt-out' (no disclosure was shown). */
  consentVersion?: string
  memberId?: string | null
  householdId?: string | null
}

const KEYWORD_SOURCES: ReadonlySet<string> = new Set(['inbound_stop', 'carrier_opt_out'])

export interface DncEntry {
  /** Normalized contact key (as the gate reads it). */
  contact: string
  /** 'sms' | 'email' | 'call' | 'all'. */
  channel: string
  /** Recorded only when this writer CREATES the row. */
  reason: string
  /**
   * Append a contact-level REVOKE evidence row (comm_contact_consents) recording this opt-out, so a
   * later bare START can see that a non-keyword opt-out happened even when the DNC row's first
   * reason is a STOP. Default true; a caller that writes its own evidence row passes false.
   */
  evidence?: boolean
}

/**
 * THE shared DNC writer (every opt-out path). Two properties, proven exhaustively over event
 * orderings by tests/optout-consent-property.test.mjs:
 *   • NEVER RELABEL — an existing row keeps the reason its first opt-out recorded; a later opt-out
 *     only re-arms it. Overwriting the reason erased the earlier opt-out (e.g. a STOP became
 *     "unsubscribe", a complaint became "hard_bounce").
 *   • ALWAYS RE-ARM — `created_at` is refreshed, so a row a bare START had lifted is active again
 *     (lifted_at < created_at; contact-consent.ts isDncLifted). Rows are never deleted.
 * Returns ok:false when either enforced write returned an error (supabase-js does not throw).
 */
export async function armDncEntry(e: DncEntry): Promise<{ ok: boolean; error?: string }> {
  const db = getDb()
  const now = new Date().toISOString()
  try {
    const ins = await db
      .from('dnc_entries')
      .upsert({ contact: e.contact, channel: e.channel, scope: 'internal', reason: e.reason, created_at: now }, { onConflict: 'contact,channel', ignoreDuplicates: true })
    if (ins?.error) return { ok: false, error: ins.error.message }
    // Evidence BEFORE the re-arm: a START reading between the two must already see this opt-out's
    // evidence (it refuses to lift on any non-keyword evidence), never a re-armed row without it.
    if (e.evidence !== false && (e.channel === 'sms' || e.channel === 'email')) {
      const ev = await db.from('comm_contact_consents').insert({
        contact: e.contact,
        channel: e.channel,
        action: 'revoked',
        consent_text: e.reason,
        consent_version: 'opt-out',
        captured_at: now,
      })
      if (ev?.error) return { ok: false, error: ev.error.message }
    }
    const arm = await db.from('dnc_entries').update({ created_at: now }).eq('contact', e.contact).eq('channel', e.channel)
    if (arm?.error) return { ok: false, error: arm.error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Apply a channel opt-out across every store, and log it once through the shared consent-change
 * recorder (audit_log + the CRM timeline). Never throws.
 *
 * Returns `ok: false` when any ENFORCED write failed — the DNC row, the contact-consent revoke
 * or the member consent revoke, each of which a later send's gate reads. supabase-js resolves
 * `{ error }` instead of throwing, so these were previously reported as success while nothing
 * was written (audit B-14). The caller decides how to surface it (a webhook answers 5xx).
 */
export async function recordChannelOptOut(o: ChannelOptOut): Promise<{ ok: boolean }> {
  const db = getDb()
  const now = new Date().toISOString()
  const failures: string[] = []
  try {
    // 1. The ENFORCED suppression. First, so a failure later still leaves the send blocked. The
    //    shared writer never relabels a row already on file and re-arms one a START had lifted.
    const dnc = await armDncEntry({ contact: o.contact, channel: o.channel, reason: o.reason, evidence: false })
    if (!dnc.ok) failures.push(`dnc_entries: ${dnc.error}`)

    // 2. The contact-resolvable evidence store (append-only; latest action wins). The member's
    //    consent BEFORE this opt-out is recorded on the revoke row: the member store is overwritten
    //    below and keeps no history, and a later bare START may restore only a documented grant.
    let priorMemberGranted = false
    if (o.memberId) {
      try {
        const r = await db.from('consents').select('status').eq('member_id', o.memberId).eq('channel', o.channel).maybeSingle()
        priorMemberGranted = !r.error && (r.data as { status?: string } | null)?.status === 'granted'
      } catch {
        /* unreadable → no evidence recorded (START will not restore from it) */
      }
    }
    const cc = await db.from('comm_contact_consents').insert({
      contact: o.contact,
      channel: o.channel,
      action: 'revoked',
      consent_text: priorMemberGranted ? `${o.consentText} (${PRIOR_MEMBER_GRANT_MARKER})` : o.consentText,
      // The keyword stamp is what lets a later bare START recognise this evidence as liftable.
      consent_version: o.consentVersion ?? (KEYWORD_SOURCES.has(o.source) ? KEYWORD_OPT_OUT_VERSION : 'opt-out'),
      captured_at: now,
    })
    if (cc?.error) failures.push(`comm_contact_consents: ${cc.error.message}`)

    // 3. The member-keyed stores, when the number belongs to an existing client. The channel
    //    revoke is the floor and the scoped grants are cascaded so the two cannot disagree.
    if (o.memberId) {
      const mc = await db
        .from('consents')
        .upsert(
          { member_id: o.memberId, household_id: o.householdId ?? null, channel: o.channel, status: 'revoked', source: o.source, updated_at: now },
          { onConflict: 'member_id,channel' },
        )
      if (mc?.error) failures.push(`consents: ${mc.error.message}`)
      const sp = await db
        .from('comm_consent_purposes')
        .update({ status: 'revoked', updated_at: now })
        .eq('member_id', o.memberId)
        .eq('channel', o.channel)
      if (sp?.error) failures.push(`comm_consent_purposes: ${sp.error.message}`)
    }

    // 4. ONE consent-logging path → audit_log AND the CRM timeline.
    await recordConsentChange({
      actor: 'system',
      channel: o.channel,
      newStatus: 'revoked',
      previousStatus: 'granted',
      source: o.source,
      reason: o.reason,
      memberId: o.memberId ?? null,
      householdId: o.householdId ?? null,
    })
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err))
  }
  if (failures.length) {
    console.error('[opt-out] enforced write failed', { channel: o.channel, source: o.source, failures })
    return { ok: false }
  }
  return { ok: true }
}

/**
 * Twilio delivery-callback error codes that mean the RECIPIENT has opted out, as opposed to a
 * delivery problem. Deliberately narrow: only 21610 is an unambiguous unsubscribe. Carrier
 * filtering (30007), unreachable handsets (30003/30005) and generic blocks (30004) are delivery
 * failures — suppressing on those would silently opt people out of messages they asked for.
 */
const CARRIER_OPT_OUT_CODES: ReadonlySet<string> = new Set(['21610'])

/** True when a Twilio ErrorCode means the recipient is unsubscribed at the carrier. */
export function isCarrierOptOutCode(code: string | null | undefined): boolean {
  return !!code && CARRIER_OPT_OUT_CODES.has(String(code).trim())
}

/**
 * Apply a carrier-reported SMS opt-out (Twilio 21610) for a raw recipient number, wherever it was
 * learned: the delivery status callback, or a synchronous REST rejection at send time. Resolves
 * the household-member link so the member-keyed stores are revoked too. Never throws; `ok: false`
 * when an enforced write failed (the status webhook then answers 5xx so the provider retries).
 */
export async function recordCarrierOptOut(toRaw: string, errorCode: string): Promise<{ ok: boolean }> {
  if (!toRaw || !isCarrierOptOutCode(errorCode)) return { ok: true } // nothing to apply
  try {
    const { normalizeContact, resolveContact } = await import('./conversations')
    const contact = normalizeContact('sms', toRaw)
    const link = await resolveContact('sms', contact)
    const res = await recordChannelOptOut({
      contact,
      channel: 'sms',
      source: 'carrier_opt_out',
      reason: `Twilio ErrorCode ${errorCode} — recipient unsubscribed at the carrier`,
      consentText: `Carrier-reported opt-out (Twilio ${errorCode})`,
      memberId: link.memberId,
      householdId: link.householdId,
    })
    // Callbacks → engine state (audit B-10 / D-12), behind the off-by-default switch. DNC already
    // blocks every later send; this only stops the cadences from re-attempting (and escalating) a
    // number the carrier has unsubscribed — the same terminal fan-out an inbound STOP applies.
    if (res.ok) {
      const { switchAllows } = await import('../ops/automation-switch')
      if (await switchAllows('callback_engine_state', { channel: 'sms', address: contact })) {
        const { terminateAutomationForAddress } = await import('./stop-fanout')
        await terminateAutomationForAddress('sms', contact, `carrier opt-out (Twilio ${errorCode})`, 'opted_out')
      }
    }
    return res
  } catch {
    return { ok: false } // never throw into a webhook or the send path
  }
}
