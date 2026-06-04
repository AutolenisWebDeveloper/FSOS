import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { TRAIGA_SMS_FOOTER } from '@/lib/compliance'
import { Resend } from 'resend'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

const FORM_TITLES: Record<string, string> = {
  'customer-questionnaire':   'Customer Questionnaire',
  'customer-profile':         'Customer Profile Worksheet',
  'liability-exposure':       'Liability Exposure Worksheet',
  'cash-flow':                'Cash Flow Statement',
  'financial-position':       'Statement of Financial Position',
  'business-questionnaire':   'Business Information Questionnaire',
  'financial-needs-analysis': 'Financial Needs Analysis',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      customer_id,
      form_id,
      channel,       // 'email' | 'sms' | 'both' | 'link'
      destination,   // email address or phone number
      client_name,
      agency_id,
    } = body

    if (!form_id || !channel) {
      return NextResponse.json({ error: 'form_id and channel required' }, { status: 400 })
    }
    if (!FORM_TITLES[form_id]) {
      return NextResponse.json({ error: 'Unknown form_id' }, { status: 400 })
    }

    // 1. Check if form already sent and not expired (prevent duplicates)
    if (customer_id) {
      const { data: existing } = await getDb()
        .from('form_submissions')
        .select('submission_id, status')
        .eq('customer_id', customer_id)
        .eq('form_id', form_id)
        .in('status', ['sent', 'opened', 'complete'])
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing?.status === 'complete') {
        return NextResponse.json({
          success: false,
          reason: 'already_complete',
          message: `${client_name || 'Client'} has already submitted this form`,
        })
      }
    }

    // 2. Generate unique token
    const token = randomUUID().replace(/-/g, '').slice(0, 16) + Date.now().toString(36)

    // 3. Build the link
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'
    const link = `${baseUrl}/forms/${form_id}?t=${token}${client_name ? `&client=${encodeURIComponent(client_name)}` : ''}`

    // 4. Create submission record
    const { data: submission, error: insertErr } = await getDb()
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
      .select()
      .single()

    if (insertErr || !submission) {
      console.error('Form send insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to create form record' }, { status: 500 })
    }

    // 5. Send via email
    if ((channel === 'email' || channel === 'both') && destination) {
      try {
        await getResend().emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'Markist — Farmers Financial <forms@yourdomain.com>',
          to: destination,
          subject: `Action Required — ${FORM_TITLES[form_id]}`,
          html: buildEmailHTML(client_name || 'Client', FORM_TITLES[form_id], link, form_id),
        })

        await getDb().from('form_sends').insert({
          submission_id: submission.submission_id,
          customer_id: customer_id || null,
          form_id,
          channel: 'email',
          destination,
        })
      } catch (emailErr) {
        console.error('Email send error:', emailErr)
        // Don't fail the whole request if email fails — still return the link
      }
    }

    // 6. Send via SMS — direct Twilio REST API (no platform layer)
    if ((channel === 'sms' || channel === 'both') && destination) {
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID
        const authToken  = process.env.TWILIO_AUTH_TOKEN
        const fromNumber = process.env.TWILIO_PHONE_NUMBER

        if (accountSid && authToken && fromNumber) {
          const smsBody = `Hi ${client_name || 'there'}, Markist sent you a secure form to complete before your appointment. Tap to open: ${link}\n\n${TRAIGA_SMS_FOOTER}`

          // Twilio Messages API — direct REST, no SDK required
          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                From: fromNumber,
                To:   destination.startsWith('+') ? destination : `+1${destination.replace(/\D/g, '')}`,
                Body: smsBody,
              }).toString(),
            }
          )

          if (!twilioRes.ok) {
            const errBody = await twilioRes.text()
            console.error('Twilio SMS error:', errBody)
          } else {
            await getDb().from('form_sends').insert({
              submission_id: submission.submission_id,
              customer_id: customer_id || null,
              form_id,
              channel: 'sms',
              destination,
            })
          }
        }
      } catch (smsErr) {
        console.error('SMS send error:', smsErr)
      }
    }

    // 7. Log activity
    if (customer_id) {
      await getDb().from('activity').insert({
        customer_id,
        agency_id: agency_id || null,
        type: 'form_sent',
        direction: 'outbound',
        channel,
        subject: `${FORM_TITLES[form_id]} sent`,
        notes: `Sent via ${channel} to ${destination || 'link only'}`,
      })
    }

    return NextResponse.json({
      success: true,
      link,
      token,
      submission_id: submission.submission_id,
    })

  } catch (err) {
    console.error('Form send unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function buildEmailHTML(clientName: string, formTitle: string, link: string, formId: string): string {
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
    <!-- Header -->
    <div style="background:#0f1e36;padding:24px 32px;">
      <div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:.04em;">FARMERS FINANCIAL SOLUTIONS</div>
      <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;">Markist · Licensed FSA</div>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-size:16px;color:#1a2332;margin:0 0 8px;font-weight:600;">Hi ${clientName},</p>
      <p style="font-size:14px;color:#3d3830;line-height:1.7;margin:0 0 20px;">
        Please take a few minutes to complete your <strong>${formTitle}</strong> before our appointment.
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
        <span style="color:#2b6cb0;word-break:break-all;">${link}</span>
      </p>
    </div>
    <!-- Footer -->
    <div style="background:#f4f6f9;padding:16px 32px;border-top:1px solid #e4e8ef;">
      <p style="font-size:11px;color:#a8b4c0;margin:0;line-height:1.6;">
        Markist · Farmers Financial Solutions, LLC<br>
        Securities offered through Farmers Financial Solutions, LLC, Member FINRA & SIPC<br>
        To opt out of future communications, reply STOP to any SMS or contact us directly.
      </p>
    </div>
  </div>
</body>
</html>`
}
