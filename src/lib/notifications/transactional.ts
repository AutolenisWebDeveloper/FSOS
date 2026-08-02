// src/lib/notifications/transactional.ts
// Shared TRANSACTIONAL / OPERATIONAL email notifications for the public intake flows
// (contact request, workshop registration, appointment booking). Two audiences per event:
//
//   • the VISITOR — a receipt/acknowledgement of the action they just took, and
//   • the FSA     — an internal "new lead / registration / booking" ops alert.
//
// Both are TRANSACTIONAL (a direct response to a user-initiated action) and INTERNAL,
// so — exactly like lib/forms.ts, briefing/send, and the legacy workshop confirmation —
// they route through the ONE shared, guarded Resend sender (lib/messaging.sendEmail) and
// are NOT gated by the marketing compliance dispatcher (sendThroughGate) or the `consents`
// table. They carry no product recommendation, no securities content, and no SMS (§4/§12).
//
// Every send is BEST-EFFORT: it never throws into the caller and never blocks the
// user-facing action (the lead/registration/booking is already persisted). A provider
// rejection or missing config is LOGGED (never silently dropped) so a broken Resend setup
// is diagnosable instead of leaving both parties with no email and no trace.
//
// All recipient-controlled values are HTML-escaped (name, email, message, free text) —
// stored/reflected-XSS defense (§13.8).

import { sendEmail, emailConfigured, type SendResult } from '@/lib/messaging'
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

interface EmailContent {
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
function renderHtml(content: EmailContent): string {
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
function renderText(content: EmailContent): string {
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
}): Promise<SendResult> {
  if (!emailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[notify] email not configured — FSA alert not sent:', opts.subject)
    return { ok: false, error: 'email_not_configured', skipped: true }
  }
  const to = fsaNotificationInbox()
  const content: EmailContent = { heading: opts.heading, lede: opts.lede, rows: opts.rows, note: opts.note }
  const result = await sendEmail(to, opts.subject, renderHtml(content), renderText(content), {
    replyTo: opts.replyTo || undefined,
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
}): Promise<SendResult> {
  if (!opts.to) return { ok: false, error: 'no_recipient', skipped: true }
  if (!emailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[notify] email not configured — visitor ack not sent:', opts.subject)
    return { ok: false, error: 'email_not_configured', skipped: true }
  }
  const content: EmailContent = { heading: opts.heading, lede: opts.lede, rows: opts.rows, note: opts.note }
  const result = await sendEmail(opts.to, opts.subject, renderHtml(content), renderText(content), {
    replyTo: opts.replyTo || fsaNotificationInbox(),
  })
  return logOutcome(`visitor-ack (${opts.subject})`, opts.to, result)
}
