// src/lib/forms.ts
// Shared form-send core. Called in-process by POST /api/forms/send (no HTTP
// self-fetch, so it works even when NEXT_PUBLIC_URL is unset and needs no
// internal auth round-trip).

import { getDb } from '@/lib/supabase/client'
import { generateFormToken } from '@/lib/tokens'
import { escapeHtml } from '@/lib/http'
import { sendEmail } from '@/lib/messaging'
import { sendThroughGate } from '@/lib/comms/send'
import { resolveSender } from '@/lib/comms/senders'
import { renderEmailShell, paragraphHtml, buttonHtml, fineHtml } from '@/lib/notifications/email-shell'

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
      email_error?: string
      sms_error?: string
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
  let email_error: string | undefined
  let sms_error: string | undefined

  if ((channel === 'email' || channel === 'both') && email) {
    // Transactional send through the shared, guarded sender (src/lib/messaging.ts):
    // one Resend wrapper for the whole app, so config checks, reply-to routing, and
    // the never-throw { ok, error } contract are identical everywhere. A form link
    // is transactional — it is NOT gated by marketing consent. Fail loudly on
    // misconfiguration or provider rejection instead of reporting a phantom "sent".
    const result = await sendEmail(
      email,
      `Action Required — ${FORM_TITLES[form_id]}`,
      buildEmailHTML(client_name || 'Client', FORM_TITLES[form_id], link, form_id),
      undefined,
      // Transactional stream (notify.) for reputation isolation; falls back to
      // RESEND_FROM_EMAIL until the subdomain is configured.
      { from: resolveSender('transactional').from || undefined },
    )
    if (result.ok) {
      email_sent = true
      await db.from('form_sends').insert({
        submission_id: submission.submission_id,
        customer_id: customer_id || null,
        form_id,
        channel: 'email',
        destination: email,
      })
      if (result.id) console.log('[forms] Resend accepted email id', result.id)
    } else {
      email_error = result.error || 'Email delivery failed'
      console.error('[forms] email send failed:', email_error)
    }
  }

  if ((channel === 'sms' || channel === 'both') && phone) {
    // Route the form-link SMS through the ONE gated pipeline (sendThroughGate) — identical to every
    // other outbound SMS. Consent, DNC/STOP, the A2P 10DLC hold, the securities firewall, the audit
    // trail, and the message-of-record are ALL enforced there. This replaces a raw inline Twilio
    // fetch that bypassed every one of them (audit finding F-3). The dispatcher appends the
    // carrier-required "Reply STOP to opt out." footer, so it is no longer appended here.
    //
    // Purpose = TRANSACTIONAL: a staff-initiated, per-client form link is an operational/servicing
    // message, not marketing — quiet-hours- and marketing-consent-exempt, while consent, DNC/STOP,
    // and the securities firewall still apply. humanAuthored = true: the send is 1:1 and operator-
    // initiated (POST /api/forms/send is requireInternalAuth-gated), so the licensed operator is the
    // content approval for gate step 4 (there is no comm_templates row for a form link). Consent is
    // NOT waived — a recipient with no channel consent is blocked+escalated by the gate, never sent.
    const e164 = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`
    const smsBody = `Hi ${client_name || 'there'}, Markist sent you a secure form to complete before your appointment. Tap to open: ${link}`
    try {
      const outcome = await sendThroughGate({
        channel: 'sms',
        to: e164,
        body: smsBody,
        actor: 'system:forms',
        purpose: 'TRANSACTIONAL',
        humanAuthored: true,
        isSecurity: false,
        entity: { type: 'form_submission', id: submission.submission_id },
        recipientContext: { full_name: client_name || null },
      })
      if (outcome.sent) {
        sms_sent = true
        await db.from('form_sends').insert({
          submission_id: submission.submission_id,
          customer_id: customer_id || null,
          form_id,
          channel: 'sms',
          destination: phone,
        })
      } else {
        sms_error = outcome.reason || 'SMS blocked by the compliance gate'
        console.error('[forms] SMS gate-blocked:', sms_error)
      }
    } catch (err) {
      sms_error = err instanceof Error ? err.message : String(err)
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
    email_error,
    sms_error,
  }
}

function buildLink(form_id: string, token: string, client_name?: string | null): string {
  const clientParam = client_name ? `&client=${encodeURIComponent(client_name)}` : ''
  return `${baseUrl()}/forms/${form_id}?t=${token}${clientParam}`
}

function buildEmailHTML(clientName: string, formTitle: string, link: string, formId: string): string {
  const isProfileForm = formId === 'customer-profile' || formId === 'financial-needs-analysis'
  const estimatedTime = isProfileForm ? '8–10 minutes' : '3–5 minutes'

  // Rendered through the shared premium shell (email-shell.ts) so this transactional
  // email matches the campaign design system. Raw text is escaped INSIDE the shell +
  // helpers — pass unescaped values (the manual link block below escapes its own URL).
  const contentHtml = [
    paragraphHtml(`Hi ${clientName},`),
    paragraphHtml(
      `Please take a few minutes to complete your ${formTitle} before our appointment. It helps us prepare a more ` +
        `personalized review for you, and takes about ${estimatedTime}.`,
    ),
    buttonHtml('Complete your form', link),
    fineHtml('This link is secure and expires in 30 days. Your information is kept strictly confidential and used only to prepare for your financial review.'),
    `<p style="margin:0;color:#8A94A6;font-size:11px;line-height:1.6;">If the button doesn&rsquo;t work, copy this link:<br><span style="color:#2C4C9C;word-break:break-all;">${escapeHtml(link)}</span></p>`,
  ].join('\n')

  return renderEmailShell({
    preheader: `Complete your ${formTitle} before our appointment`,
    eyebrow: 'Action Required',
    heading: `Your ${formTitle} is ready, ${clientName}`,
    contentHtml,
  })
}
