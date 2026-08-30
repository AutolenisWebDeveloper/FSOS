// src/lib/notifications/transactional.ts
// Shared TRANSACTIONAL / OPERATIONAL email notifications for the public intake flows
// (contact request, workshop registration, appointment booking). Two audiences per event:
//
//   • the VISITOR — a receipt/acknowledgement of the action they just took, and
//   • the FSA     — an internal "new lead / registration / booking" ops alert.
//
// Both are TRANSACTIONAL (a direct response to a user-initiated action).
//
// THESE ARE NOW GATED. They were the largest of the nine paths Phase A found sending with
// no consent read, no DNC check, no suppression and no audit. They still call
// lib/messaging.sendEmail — but that function IS the dispatch chokepoint now, so every one
// of those checks runs. What each call declares below is the basis on which it is entitled
// to send, not an exemption from being checked:
//
//   templateKind: 'system_transactional' — a fixed, code-resident, review-controlled
//     template. It satisfies gate step 4 (approved content) and nothing else.
//   purpose: 'TRANSACTIONAL' — drives purpose-scoped consent and the correct stream.
//   suppressible: false — a receipt for an action the person just took is not marketing
//     outreach, so agent-book / individual BUSINESS suppression does not apply. DNC and
//     consent are regulatory and DO still apply.
//
// A DNC'd or revoked recipient now blocks here where it previously sent. That is the
// intended tightening.
//
// Every send is BEST-EFFORT: it never throws into the caller and never blocks the
// user-facing action (the lead/registration/booking is already persisted). A provider
// rejection or missing config is LOGGED (never silently dropped) so a broken Resend setup
// is diagnosable instead of leaving both parties with no email and no trace.
//
// All recipient-controlled values are HTML-escaped (name, email, message, free text) —
// stored/reflected-XSS defense (§13.8).

import { sendEmail, emailConfigured, type SendResult, type SendPolicyOptions } from '@/lib/messaging'
import { resolveSender } from '@/lib/comms/senders'
import { BUSINESS, CONTACT } from '@/lib/site'
import { renderEmailShell, paragraphHtml, detailTableHtml, fineHtml } from './email-shell'

/**
 * The inbox that receives internal FSA ops alerts. Env-overridable so the owner can route
 * alerts wherever they actually read them; falls back to the marketing reply-to and then to
 * the verified business email (site.ts) so alerts have a working default WITHOUT new config.
 */
export function fsaNotificationInbox(): string {
  return (
    process.env.FSOS_NOTIFY_EMAIL ||
    process.env.RESEND_REPLY_TO ||
    CONTACT.email
  )
}

export interface DetailRow {
  label: string
  value: string | null | undefined
}

export interface EmailContent {
  /** Preheader / H1 line (plain text; escaped by the renderer). */
  heading: string
  /** Lead paragraph (plain text; escaped by the renderer). */
  lede: string
  /** Label/value detail rows (values escaped by the renderer; empty values dropped). */
  rows?: DetailRow[]
  /** Optional closing note (plain text; escaped by the renderer). */
  note?: string
}

/**
 * A branded, self-contained transactional email (HTML), rendered through the shared
 * premium shell (email-shell.ts) so it matches the campaign templates + DESIGN.md.
 * All dynamic text is HTML-escaped inside the shell helpers (§13.8).
 */
export function renderHtml(content: EmailContent): string {
  const contentHtml = [
    paragraphHtml(content.lede),
    detailTableHtml((content.rows ?? []).map((r) => ({ label: r.label, value: r.value }))),
    content.note ? fineHtml(content.note) : '',
  ]
    .filter(Boolean)
    .join('\n')

  return renderEmailShell({ preheader: content.lede, heading: content.heading, contentHtml })
}

/** A plaintext part mirroring the HTML (deliverability + accessible fallback). */
export function renderText(content: EmailContent): string {
  const rows = (content.rows ?? [])
    .filter((r) => r.value != null && String(r.value).trim() !== '')
    .map((r) => `${r.label}: ${r.value}`)
    .join('\n')
  return [
    content.heading,
    '',
    content.lede,
    rows ? `\n${rows}` : '',
    content.note ? `\n${content.note}` : '',
    '',
    `${BUSINESS.agent} · ${BUSINESS.carrier}`,
    `${CONTACT.phoneDisplay} · ${CONTACT.email}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n')
    .trim()
}

/** Log a non-fatal notification outcome uniformly (never throws). */
function logOutcome(kind: string, to: string, result: SendResult): SendResult {
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[notify] ${kind} → ${to} failed (action kept):`, result.error)
  }
  return result
}

/**
 * Send the internal FSA "new <event>" ops alert. Best-effort; returns the SendResult so a
 * caller MAY inspect it, but the user-facing action must never depend on it. `replyTo`
 * routes the FSA's reply straight to the lead when a contactable address is known.
 */
export async function notifyFsa(opts: {
  subject: string
  heading: string
  lede: string
  rows?: DetailRow[]
  note?: string
  replyTo?: string | null
  /** Entity linkage for the audit trail, when the caller has one. */
  entity?: { type: string; id: string }
}): Promise<SendResult> {
  if (!emailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[notify] email not configured — FSA alert not sent:', opts.subject)
    return { ok: false, error: 'email_not_configured', skipped: true }
  }
  const to = fsaNotificationInbox()
  const content: EmailContent = { heading: opts.heading, lede: opts.lede, rows: opts.rows, note: opts.note }
  // The recipient is the PRACTICE'S OWN operations inbox, not a client. There is no consent
  // relationship with yourself, so the waiver applies — and it stays opt-out-safe: an
  // explicit revoke on that address still blocks (contactConsentRevoked at the chokepoint).
  const policy: SendPolicyOptions = {
    actor: 'system:notify',
    purpose: 'TRANSACTIONAL',
    templateKind: 'system_transactional',
    suppressible: false,
    consentWaived: true,
    entity: opts.entity,
  }
  const result = await sendEmail(to, opts.subject, renderHtml(content), renderText(content), {
    from: resolveSender('transactional').from || undefined,
    replyTo: opts.replyTo || undefined,
    policy,
  })
  return logOutcome(`fsa-alert (${opts.subject})`, to, result)
}

/**
 * Send the VISITOR their transactional acknowledgement. Best-effort; returns the SendResult.
 * `replyTo` defaults to the FSA inbox so a visitor reply reaches a human.
 */
export async function sendVisitorAck(opts: {
  to: string
  subject: string
  heading: string
  lede: string
  rows?: DetailRow[]
  note?: string
  replyTo?: string | null
  /** Entity linkage for the audit trail. */
  entity?: { type: string; id: string }
  /**
   * The caller asserts that this person just performed the action being acknowledged and
   * supplied this address FOR that acknowledgement — the transactional basis. Each call
   * site states it explicitly rather than this helper assuming it, because the assertion is
   * only true where a submission was in fact just persisted. Defaults to false, which means
   * the chokepoint requires ordinary consent on file.
   */
  transactionalBasis?: boolean
}): Promise<SendResult> {
  if (!opts.to) return { ok: false, error: 'no_recipient', skipped: true }
  if (!emailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[notify] email not configured — visitor ack not sent:', opts.subject)
    return { ok: false, error: 'email_not_configured', skipped: true }
  }
  const content: EmailContent = { heading: opts.heading, lede: opts.lede, rows: opts.rows, note: opts.note }
  const policy: SendPolicyOptions = {
    actor: 'system:notify',
    purpose: 'TRANSACTIONAL',
    templateKind: 'system_transactional',
    suppressible: false,
    // The basis is the action the visitor just took, asserted by the call site. DNC/STOP,
    // the securities firewall and the red line are enforced independently of it.
    durableConsentGranted: opts.transactionalBasis === true,
    entity: opts.entity,
  }
  const result = await sendEmail(opts.to, opts.subject, renderHtml(content), renderText(content), {
    from: resolveSender('transactional').from || undefined,
    replyTo: opts.replyTo || fsaNotificationInbox(),
    policy,
  })
  return logOutcome(`visitor-ack (${opts.subject})`, opts.to, result)
}
