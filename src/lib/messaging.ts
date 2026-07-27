// src/lib/messaging.ts
// Guarded, reusable email (Resend) + SMS (Twilio) senders. Both return a
// discriminated result and never throw into the caller, so campaign runs and
// one-off sends handle misconfiguration and provider errors uniformly.

import { Resend } from 'resend'

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
  skipped?: boolean
}

export function emailConfigured(): boolean {
  const from = process.env.RESEND_FROM_EMAIL
  return !!process.env.RESEND_API_KEY && !!from && !/yourdomain\.com/i.test(from)
}

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
}

/** Optional per-send email delivery options (deliverability: reply routing + headers). */
export interface EmailSendOptions {
  /** Reply-To address (monitored inbox). Falls back to RESEND_REPLY_TO env when unset. */
  replyTo?: string
  /** Extra SMTP headers, e.g. RFC 8058 List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  opts?: EmailSendOptions,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }
  if (!from || /yourdomain\.com/i.test(from)) return { ok: false, error: 'RESEND_FROM_EMAIL not a verified sender' }
  if (!to) return { ok: false, error: 'No recipient email' }
  const replyTo = opts?.replyTo || process.env.RESEND_REPLY_TO || undefined
  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
      ...(opts?.headers ? { headers: opts.headers } : {}),
    })
    if (error) return { ok: false, error: error.message || String(error) }
    return { ok: true, id: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Absolute base URL for building Twilio status-callback links (best-effort). */
function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    ''
  return raw.replace(/\/$/, '')
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  // A2P 10DLC backstop (§12): never place an SMS to a real contact before the A2P
  // campaign is approved. The pure gate (step `sms_live`) is the primary enforcement;
  // this is defense-in-depth so no code path — even one that bypasses the gate — can
  // send SMS while staged. Flip SMS_A2P_APPROVED=true on approval to activate.
  const { smsA2pApproved } = await import('./comms/a2p')
  if (!smsA2pApproved()) return { ok: false, error: 'sms_pending_a2p_approval', skipped: true }
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  // Prefer a Messaging Service SID when configured (handles number pools + opt-out).
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  if (!sid || !token || (!from && !messagingServiceSid)) return { ok: false, error: 'Twilio env not set' }
  if (!to) return { ok: false, error: 'No recipient phone' }
  try {
    const params: Record<string, string> = { To: to, Body: body }
    if (messagingServiceSid) params.MessagingServiceSid = messagingServiceSid
    else if (from) params.From = from
    // Ask Twilio to POST delivery-status updates to our webhook (sent/delivered/failed).
    const base = appBaseUrl()
    if (base) params.StatusCallback = `${base}/api/webhooks/twilio/status`
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    })
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const json = (await res.json().catch(() => ({}))) as { sid?: string }
    return { ok: true, id: json.sid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
