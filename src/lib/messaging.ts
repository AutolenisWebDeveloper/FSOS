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

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }
  if (!from || /yourdomain\.com/i.test(from)) return { ok: false, error: 'RESEND_FROM_EMAIL not a verified sender' }
  if (!to) return { ok: false, error: 'No recipient email' }
  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to, subject, html, text })
    if (error) return { ok: false, error: error.message || String(error) }
    return { ok: true, id: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return { ok: false, error: 'Twilio env not set' }
  if (!to) return { ok: false, error: 'No recipient phone' }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    })
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const json = (await res.json().catch(() => ({}))) as { sid?: string }
    return { ok: true, id: json.sid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
