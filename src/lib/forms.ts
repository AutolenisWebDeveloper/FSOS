// src/lib/forms.ts
// Shared form-send core. Called in-process by POST /api/forms/send and by the
// Calendly webhook (no HTTP self-fetch, so it works even when NEXT_PUBLIC_URL
// is unset and needs no internal auth round-trip).

import { getDb } from '@/lib/supabase/client'
import { TRAIGA_SMS_FOOTER } from '@/lib/compliance'
import { generateFormToken } from '@/lib/tokens'
import { escapeHtml } from '@/lib/http'
import { Resend } from 'resend'

export const FORM_TITLES: Record<string, string> = {
  'customer-questionnaire': 'Customer Questionnaire',
  'customer-profile': 'Customer Profile Worksheet',
  'liability-exposure': 'Liability Exposure Worksheet',
  'cash-flow': 'Cash Flow Statement',
  'financial-position': 'Statement of Financial Position',
  'business-questionnaire': 'Business Information Questionnaire',
  'financial-needs-analysis': 'Financial Needs Analysis',
}

export type SendChannel = 'email' | 'sms' | 'both' | 'link'

export interface SendFormInput {
  form_id: string
  channel: SendChannel
  email?: string | null
  phone?: string | null
  client_name?: string | null
  customer_id?: string | null
  agency_id?: string | null
}

export type SendFormResult =
  | {
      ok: true
      link: string
      token: string
      submission_id: string
      email_sent: boolean
      sms_sent: boolean
      reused?: boolean
    }
  | { ok: false; status: number; error: string; reason?: string }

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  )
}

export async function sendForm(input: SendFormInput): Promise<SendFormResult> {
  const { form_id, channel, client_name, customer_id, agency_id } = input
  const email = input.email || null
  const phone = input.phone || null

  if (!form_id || !channel) return { ok: false, status: 400, error: 'form_id and channel required' }
  if (!FORM_TITLES[form_id]) return { ok: false, status: 400, error: 'Unknown form_id' }

  const db = getDb()

  // Dedupe: if a completed or still-live (sent/opened, unexpired) submission
  // exists for this customer+form, don't create a second one.
  if (customer_id) {
    const { data: existing } = await db
      .from('form_submissions')
      .select('submission_id, status, token, expires_at')
      .eq('customer_id', customer_id)
      .eq('form_id', form_id)
      .in('status', ['sent', 'opened', 'complete'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.status === 'complete') {
      return {
        ok: false,
        status: 200,
        reason: 'already_complete',
        error: `${client_name || 'Client'} has already submitted this form`,
      }
    }
    if (existing && existing.expires_at && new Date(existing.expires_at) > new Date()) {
      // Reuse the outstanding link instead of spamming a second one.
      const link = buildLink(form_id, existing.token, client_name)
      return {
        ok: true,
        link,
        token: existing.token,
        submission_id: existing.submission_id,
        email_sent: false,
        sms_sent: false,
        reused: true,
      }
    }
  }

  const token = generateFormToken()
  const link = buildLink(form_id, token, client_name)

  const { data: submission, error: insertErr } = await db
    .from('form_submissions')
    .insert({
      customer_id: customer_id || null,
      agency_id: agency_id || null,
      form_id,
      form_title: FORM_TITLES[form_id],
      token,
      status: 'sent',
      sent_via: channel,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('submission_id')
    .single()

  if (insertErr || !submission) {
    console.error('[forms] submission insert error:', insertErr)
    return { ok: false, status: 500, error: 'Failed to create form record' }
  }

  let email_sent = false
  let sms_sent = false

  if ((channel === 'email' || channel === 'both') && email) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Markist — Farmers Financial <forms@yourdomain.com>',
        to: email,
        subject: `Action Required — ${FORM_TITLES[form_id]}`,
        html: buildEmailHTML(client_name || 'Client', FORM_TITLES[form_id], link, form_id),
      })
      email_sent = true
      await db.from('form_sends').insert({
        submission_id: submission.submission_id,
        customer_id: customer_id || null,
        form_id,
        channel: 'email',
        destination: email,
      })
    } catch (err) {
      console.error('[forms] email send error:', err)
    }
  }

  if ((channel === 'sms' || channel === 'both') && phone) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const fromNumber = process.env.TWILIO_PHONE_NUMBER
      if (accountSid && authToken && fromNumber) {
        const smsBody = `Hi ${client_name || 'there'}, Markist sent you a secure form to complete before your appointment. Tap to open: ${link}\n\n${TRAIGA_SMS_FOOTER}`
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`,
              Body: smsBody,
            }).toString(),
          },
        )
        if (res.ok) {
          sms_sent = true
          await db.from('form_sends').insert({
            submission_id: submission.submission_id,
            customer_id: customer_id || null,
            form_id,
            channel: 'sms',
            destination: phone,
          })
        } else {
          console.error('[forms] Twilio SMS error:', await res.text())
        }
      }
    } catch (err) {
      console.error('[forms] SMS send error:', err)
    }
  }

  if (customer_id) {
    await db.from('activity').insert({
      customer_id,
      agency_id: agency_id || null,
      type: 'form_sent',
      direction: 'outbound',
      channel,
      subject: `${FORM_TITLES[form_id]} sent`,
      notes: `Sent via ${channel} to ${email || phone || 'link only'}`,
    })
  }

  return {
    ok: true,
    link,
    token,
    submission_id: submission.submission_id,
    email_sent,
    sms_sent,
  }
}

function buildLink(form_id: string, token: string, client_name?: string | null): string {
  const clientParam = client_name ? `&client=${encodeURIComponent(client_name)}` : ''
  return `${baseUrl()}/forms/${form_id}?t=${token}${clientParam}`
}

function buildEmailHTML(clientName: string, formTitle: string, link: string, formId: string): string {
  const name = escapeHtml(clientName)
  const title = escapeHtml(formTitle)
  const isProfileForm = formId === 'customer-profile' || formId === 'financial-needs-analysis'
  const estimatedTime = isProfileForm ? '8–10 minutes' : '3–5 minutes'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8ef;">
    <div style="background:#0f1e36;padding:24px 32px;">
      <div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:.04em;">FARMERS FINANCIAL SOLUTIONS</div>
      <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;">Markist · Licensed FSA</div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:16px;color:#1a2332;margin:0 0 8px;font-weight:600;">Hi ${name},</p>
      <p style="font-size:14px;color:#3d3830;line-height:1.7;margin:0 0 20px;">
        Please take a few minutes to complete your <strong>${title}</strong> before our appointment.
        This helps me prepare a more personalized review for you.
        It takes approximately <strong>${estimatedTime}</strong>.
      </p>
      <a href="${link}" style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;padding:14px 28px;border-radius:7px;font-size:14px;font-weight:600;margin-bottom:20px;">
        Complete Your Form →
      </a>
      <p style="font-size:12px;color:#7a7060;line-height:1.6;margin:0 0 8px;">
        This link is secure and expires in 30 days. Your information is kept strictly confidential
        and used only to prepare for your financial review.
      </p>
      <p style="font-size:11px;color:#a8b4c0;margin:0;">
        If the button doesn't work, copy this link:<br>
        <span style="color:#2b6cb0;word-break:break-all;">${escapeHtml(link)}</span>
      </p>
    </div>
    <div style="background:#f4f6f9;padding:16px 32px;border-top:1px solid #e4e8ef;">
      <p style="font-size:11px;color:#a8b4c0;margin:0;line-height:1.6;">
        Markist · Farmers Financial Solutions, LLC<br>
        Securities offered through Farmers Financial Solutions, LLC, Member FINRA &amp; SIPC<br>
        To opt out of future communications, reply STOP to any SMS or contact us directly.
      </p>
    </div>
  </div>
</body>
</html>`
}
