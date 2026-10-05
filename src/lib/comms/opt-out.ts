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
import { PRIOR_MEMBER_GRANT_MARKER, KEYWORD_OPT_OUT_VERSION, isKeywordOptOutReason, isKeywordRevokeEvidence } from './contact-consent'

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
    const withEvidence = e.evidence !== false && (e.channel === 'sms' || e.channel === 'email')
    if (withEvidence) {
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
    // Fresh timestamp for the re-arm, taken AFTER the evidence: a START that lifted the row in the
    // meantime stamped an earlier lifted_at, so this re-arm lands after it.
    const armedAt = new Date().toISOString()
    const arm = await db.from('dnc_entries').update({ created_at: armedAt }).eq('contact', e.contact).eq('channel', e.channel)
    if (arm?.error) return { ok: false, error: arm.error.message }
    // CONCURRENCY (no transaction spans these statements; each is its own PostgREST call). Two
    // post-checks close the windows a concurrent START or re-consent could open:
    //   1. the row must read ACTIVE now — if a lift landed at or after the re-arm (clock skew between
    //      instances), push created_at past lifted_at;
    //   2. if a documented grant was captured at or after this opt-out's evidence (a re-consent racing
    //      this opt-out), append fresh evidence so a later START's window still sees this opt-out.
    const { data: rows, error: readErr } = await db.from('dnc_entries').select('*').eq('contact', e.contact).eq('channel', e.channel).limit(1)
    if (readErr) return { ok: false, error: readErr.message }
    const row = (Array.isArray(rows) ? rows[0] : null) as { created_at?: string | null; lifted_at?: string | null } | null
    if (row?.lifted_at && row.created_at && Date.parse(row.lifted_at) >= Date.parse(row.created_at)) {
      const again = await db
        .from('dnc_entries')
        .update({ created_at: new Date(Date.parse(row.lifted_at) + 1).toISOString() })
        .eq('contact', e.contact)
        .eq('channel', e.channel)
      if (again?.error) return { ok: false, error: again.error.message }
    }
    if (withEvidence) {
      const { data: grants, error: gErr } = await db
        .from('comm_contact_consents')
        .select('captured_at, consent_version')
        .eq('contact', e.contact)
        .eq('channel', e.channel)
        .eq('action', 'granted')
        .gte('captured_at', now)
        .limit(5)
      if (gErr) return { ok: false, error: gErr.message }
      if (Array.isArray(grants) && grants.some((g) => (g as { consent_version?: string }).consent_version !== 'opt-in')) {
        const ev2 = await db.from('comm_contact_consents').insert({
          contact: e.contact,
          channel: e.channel,
          action: 'revoked',
          consent_text: e.reason,
          consent_version: 'opt-out',
          captured_at: new Date().toISOString(),
        })
        if (ev2?.error) return { ok: false, error: ev2.error.message }
      }
    }
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
    // Follow-up R13: a carrier opt-out is a stop condition like an inbound STOP, so it closes the
    // cadences unconditionally — the same terminal fan-out. It only ever STOPS sends; it no longer
    // waits on the callback_engine_state switch.
    if (res.ok) {
      const { terminateAutomationForAddress } = await import('./stop-fanout')
      await terminateAutomationForAddress('sms', contact, `carrier opt-out (Twilio ${errorCode})`, 'opted_out')
    }
    return res
  } catch {
    return { ok: false } // never throw into a webhook or the send path
  }
}

/** lifted_reason prefix a documented re-consent stamps on the DNC rows it clears. */
export const RECONSENT_LIFT_MARK = 'documented re-consent'
/** consent_version on the contact-level GRANT evidence a re-consent records when its source wrote none. */
export const RECONSENT_VERSION = 'reconsent'
/** DNC reasons a re-consent never clears — the address itself failed (owner, round 3). */
const NEVER_CLEARED_BY_CONSENT = ['hard_bounce']

/**
 * Owner decision (round 3): a DOCUMENTED re-consent on a channel clears the earlier opt-outs on that
 * channel, after which START works normally for a later STOP. Rows are LIFTED (`lifted_at`), never
 * deleted or relabelled. Hard bounces are not consent: a row that carries one stays active until the
 * address is verified again.
 *
 * WHO may call it: only a source that ties the person to the address — today the authenticated
 * client portal, for the signed-in client's OWN address. The public contact form and the public
 * booking opt-in do NOT call it: anyone can type anyone's number there, so a stranger could clear
 * someone else's STOP. Those people re-open SMS by texting START from the handset, which lifts a
 * keyword STOP as before.
 *
 *   • Reads the address's DNC rows on this channel (SMS: last-10 suffix, like the gate) and on 'all'.
 *   • A row with a hard-bounce reason, or any hard-bounce revoke evidence for the address, is kept.
 *   • A row armed at or after this re-consent started is kept (that opt-out came later).
 *   • An 'all' row covers the other channel too: the other channel is first armed with the same
 *     reason (a new row; its opt-out stands), then the 'all' row is lifted.
 *   • Lifts are compare-and-set on created_at, so an opt-out re-arming the row concurrently wins.
 *   • Every lift is audited through the one consent-logging path (recordConsentChange).
 *   • `recordGrant` appends contact-level GRANT evidence (for a source that wrote none, e.g. the
 *     portal) so a later START's evidence window starts here.
 * Fails closed: any read error clears nothing; a failed audit reports ok:false. Never throws.
 */
export async function applyDocumentedReconsent(r: {
  contact: string
  channel: 'sms' | 'email'
  source: string
  recordGrant?: boolean
  actor?: string
  memberId?: string | null
  householdId?: string | null
}): Promise<{ ok: boolean; cleared: number }> {
  const db = getDb()
  const now = new Date().toISOString()
  try {
    const tail = r.channel === 'sms' ? r.contact.replace(/[^\d]/g, '').slice(-10) : ''
    const suffix = r.channel === 'sms' && tail.length === 10
    if (r.recordGrant) {
      const g = await db.from('comm_contact_consents').insert({
        contact: r.contact,
        channel: r.channel,
        action: 'granted',
        consent_text: `Documented re-consent (${r.source})`,
        consent_version: RECONSENT_VERSION,
        captured_at: now,
      })
      if (g?.error) return { ok: false, cleared: 0 }
    }
    const bq = db.from('comm_contact_consents').select('consent_text').eq('channel', r.channel).eq('action', 'revoked')
    const { data: bounces, error: bErr } = await (suffix ? bq.ilike('contact', `%${tail}`) : bq.eq('contact', r.contact)).limit(500)
    if (bErr || !Array.isArray(bounces)) return { ok: false, cleared: 0 }
    const bounced = bounces.some((b) => NEVER_CLEARED_BY_CONSENT.includes(String((b as { consent_text?: string }).consent_text ?? '')))
    const dq = db.from('dnc_entries').select('*').in('channel', [r.channel, 'all'])
    const { data: rows, error } = await (suffix ? dq.ilike('contact', `%${tail}`) : dq.eq('contact', r.contact)).limit(20)
    if (error || !Array.isArray(rows)) return { ok: false, cleared: 0 }
    let cleared = 0
    let audited = true
    for (const row of rows as { id: string; contact: string; channel: string; reason?: string | null; created_at?: string | null; lifted_at?: string | null }[]) {
      const lifted = !!row.lifted_at && !!row.created_at && Date.parse(row.lifted_at) > Date.parse(row.created_at)
      if (lifted) continue
      if (bounced || NEVER_CLEARED_BY_CONSENT.includes(row.reason ?? '')) continue
      if (row.created_at && Date.parse(row.created_at) >= Date.parse(now)) continue // armed after this re-consent
      if (row.channel === 'all') {
        const other = r.channel === 'sms' ? 'email' : 'sms'
        const keep = await armDncEntry({ contact: row.contact, channel: other, reason: row.reason ?? 'opt-out', evidence: false })
        if (!keep.ok) continue // never lift an 'all' row whose other-channel opt-out could not be kept
      }
      let q = db.from('dnc_entries').update({ lifted_at: now, lifted_reason: `${RECONSENT_LIFT_MARK} (${r.source})` }).eq('id', row.id)
      q = row.created_at ? q.eq('created_at', row.created_at) : q.is('created_at', null)
      const { data: hit, error: uErr } = await q.select('id')
      if (uErr || !Array.isArray(hit) || hit.length === 0) continue
      cleared++
      const a = await recordConsentChange({
        actor: r.actor ?? 'system',
        channel: r.channel,
        newStatus: 'granted',
        previousStatus: 'revoked',
        source: r.source,
        reason: `${RECONSENT_LIFT_MARK}: lifted DNC opt-out (${row.channel}: ${row.reason ?? 'opt-out'})`,
        memberId: r.memberId ?? null,
        householdId: r.householdId ?? null,
      })
      if (!a.audited) audited = false
    }
    return { ok: audited, cleared }
  } catch {
    return { ok: false, cleared: 0 }
  }
}

/**
 * Owner decision (round 4), COPY ONLY: Twilio keeps blocking a number that texted STOP (error 21610)
 * until that handset texts START, whatever FSOS records. So when a client turns texts back on in the
 * portal, the portal tells them to text START if their latest SMS opt-out on this number is a STOP
 * (or a carrier-reported 21610) that no START has answered since. Read-only; changes no consent state.
 *
 * "Answered" = a later START: a DNC row lifted by an inbound START, or START's own restore grant.
 * A read error answers true — the instruction is harmless where it was not needed, and its absence
 * would leave a client believing texts are back on while the carrier still blocks them.
 */
export async function smsStopNeedsStart(phone: string): Promise<boolean> {
  try {
    const db = getDb()
    const tail = phone.replace(/[^\d]/g, '').slice(-10)
    if (tail.length !== 10) return false
    const [dnc, ev] = await Promise.all([
      db.from('dnc_entries').select('reason, created_at, lifted_at, lifted_reason').in('channel', ['sms', 'all']).ilike('contact', `%${tail}`).limit(20),
      db.from('comm_contact_consents').select('action, consent_text, consent_version, captured_at').eq('channel', 'sms').ilike('contact', `%${tail}`).limit(1000),
    ])
    if (dnc.error || ev.error || !Array.isArray(dnc.data) || !Array.isArray(ev.data)) return true
    const ms = (v?: string | null) => (v ? Date.parse(v) || -Infinity : -Infinity)
    type Row = { reason?: string | null; created_at?: string | null; lifted_at?: string | null; lifted_reason?: string | null }
    type Ev = { action?: string; consent_text?: string | null; consent_version?: string | null; captured_at?: string | null }
    const rows = dnc.data as Row[]
    const evs = ev.data as Ev[]
    const lastStart = Math.max(
      -Infinity,
      ...rows.filter((r) => (r.lifted_reason ?? '').includes('inbound START')).map((r) => ms(r.lifted_at)),
      ...evs.filter((e) => e.action === 'granted' && e.consent_version === 'opt-in').map((e) => ms(e.captured_at)),
    )
    const lastStop = Math.max(
      -Infinity,
      ...evs.filter((e) => e.action === 'revoked' && isKeywordRevokeEvidence(e)).map((e) => ms(e.captured_at)),
      // A keyword row from before revoke evidence existed: its arming time is the STOP.
      ...rows.filter((r) => isKeywordOptOutReason(r.reason)).map((r) => ms(r.created_at)),
    )
    return lastStop > lastStart
  } catch {
    return true
  }
}
