import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { ContactLeadSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { emailLc } from '@/lib/contacts/normalize'
import { SMS_CONSENT, BUSINESS } from '@/lib/site'
import { smsConsentVersion } from '@/lib/comms/consent-version'
import { consentContactKey } from '@/lib/comms/contact-consent'
import { notifyFsa, sendVisitorAck } from '@/lib/notifications/transactional'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC, UNAUTHENTICATED homepage contact / consultation-request intake.
// Creates a lead on the CRM referral spine (owner_scope null → surfaces in the
// FSA's public-referral triage), records a non-destructive possible-duplicate
// signal, and — only when the visitor affirmatively checked the box — persists
// A2P 10DLC / TCPA SMS consent into BOTH the append-only audit_log (evidence:
// wording version, source, timestamp, IP, user agent) AND the enforceable
// comm_contact_consents store the outbound send path actually reads before
// sending (src/lib/comms/send.ts). Providing a phone number NEVER enrolls SMS.
// Guardrails: honeypot + per-IP rate limit, no securities data accepted (§2.1),
// created id never leaked to the caller.
const SLA_HOURS = 24

function mask(value: string | undefined | null): string {
  if (!value) return ''
  const s = String(value)
  return s.length <= 4 ? '***' : `${s.slice(0, 3)}***${s.slice(-2)}`
}

export async function POST(req: NextRequest) {
  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  // Honeypot: bots fill the hidden `company` field. Silently accept, write nothing.
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const ip = clientIp(req)
  if (!rateLimit(`contact:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many submissions. Please try again shortly.' }, { status: 429 })
  }

  const v = ContactLeadSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid submission', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const actor = 'public'
    const now = new Date()
    const slaDue = new Date(now.getTime() + SLA_HOURS * 3600000)
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 300)
    const email = emailLc(v.data.email)
    const phone = v.data.phone ?? null

    // Non-destructive duplicate detection: does an open lead already exist for
    // this email? We NEVER auto-merge — we flag the new lead so staff can reconcile.
    let possibleDuplicate = false
    if (email) {
      const { data: existing } = await db
        .from('referrals')
        .select('id')
        .ilike('referred_email', email)
        .is('deleted_at', null)
        .limit(1)
      possibleDuplicate = Boolean(existing && existing.length > 0)
    }

    const { data: referral, error } = await db
      .from('referrals')
      .insert({
        referred_name: v.data.full_name,
        engagement: 'direct',
        referred_email: v.data.email,
        referred_phone: phone,
        status: 'received',
        received_at: now.toISOString(),
        sla_due_at: slaDue.toISOString(),
        owner_scope: null,
      })
      .select('id')
      .single()
    if (error || !referral) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    }

    // Inbound message + attribution — a durable activity on the lead timeline.
    const summary = [
      v.data.interest ? `Interest: ${v.data.interest}` : null,
      v.data.preferred_contact !== 'no_preference' ? `Prefers: ${v.data.preferred_contact}` : null,
      v.data.appointment_pref ? `Appointment: ${v.data.appointment_pref}` : null,
      `Source: ${v.data.source_page} (${v.data.form_name})`,
      Object.keys(v.data.utm).length ? `UTM: ${JSON.stringify(v.data.utm)}` : null,
      possibleDuplicate ? '⚠ Possible duplicate of an existing lead — reconcile before merge.' : null,
      '',
      v.data.message,
    ]
      .filter(Boolean)
      .join('\n')
    await db.from('activities').insert({
      entity_type: 'referral',
      entity_id: referral.id,
      kind: 'inbound_message',
      note: summary,
      actor,
    })

    // SMS consent AUDIT TRAIL (TCPA / A2P 10DLC defense record). We persist the
    // consent DECISION alongside the lead every time — `granted` reflects the
    // affirmative checkbox — with the exact wording shown, the version, a
    // server-stamped timestamp, and the server-captured IP + user agent + source
    // URL. Full (unmasked) IP + user agent are the point here: masked values are
    // worthless as consent proof. Enrollment only ever follows an affirmative
    // opt-in; providing a phone number never enrolls the number.
    const granted = Boolean(v.data.consent_sms)
    // Version is DERIVED from the deployed consent-template content (never the client-sent
    // value, never a hand-maintained string) so the record proves the exact wording shown.
    const consentVersion = smsConsentVersion()
    await writeAudit({
      actor,
      action: 'consent.captured',
      entity: 'referral',
      entityId: referral.id,
      diff: {
        channel: 'sms',
        granted,
        consentText: SMS_CONSENT.disclosure,
        consentVersion,
        timestampUtc: now.toISOString(),
        ipAddress: ip,
        userAgent,
        sourceUrl: SMS_CONSENT.sourceUrl,
        phone_masked: mask(phone),
      },
    })
    // ENFORCEABLE PERSISTENCE (A2P 10DLC / TCPA fix). An affirmative opt-in — and ONLY an
    // affirmative opt-in — writes a durable `granted` row into comm_contact_consents, the
    // CONTACT-RESOLVABLE store the outbound authorization layer reads at send time
    // (src/lib/comms/send.ts → durableContactConsentGranted, gate step 1). Without this,
    // consent would live only in audit_log, which the send path never reads — a false
    // control. An UNCHECKED box writes NO positive-consent row and enrolls nothing.
    if (granted && phone) {
      await db.from('comm_contact_consents').insert({
        contact: consentContactKey('sms', phone),
        channel: 'sms',
        action: 'granted',
        consent_text: SMS_CONSENT.disclosure,
        consent_version: consentVersion,
        source_url: SMS_CONSENT.sourceUrl,
        ip_address: ip,
        user_agent: userAgent,
        referral_id: referral.id,
        captured_at: now.toISOString(),
      })
      // Timeline breadcrumb. The enforceable grant lives in comm_contact_consents above;
      // it materializes into a member-keyed `consents` row when the lead converts (WF-1).
      await db.from('activities').insert({
        entity_type: 'referral',
        entity_id: referral.id,
        kind: 'consent_intent',
        note: `SMS consent captured at public intake (${consentVersion})`,
        actor,
      })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'referral',
      entityId: referral.id,
      diff: {
        source: 'homepage_contact',
        engagement: 'direct',
        interest: v.data.interest || null,
        possible_duplicate: possibleDuplicate,
        email_masked: mask(email),
      },
    })

    // TRANSACTIONAL notifications (best-effort — the lead is already persisted). The visitor
    // gets an acknowledgement of their own request; the FSA gets an internal "new lead" alert
    // (reply-to set to the lead so a reply reaches them directly). Neither is marketing, so
    // neither is consent-gated; a failure is logged, never fatal to the submission.
    const displayName = v.data.full_name?.trim() || 'there'
    const leadRows = [
      { label: 'Name', value: v.data.full_name },
      { label: 'Email', value: v.data.email },
      { label: 'Phone', value: phone },
      { label: 'Interest', value: v.data.interest || null },
      { label: 'Preferred contact', value: v.data.preferred_contact !== 'no_preference' ? v.data.preferred_contact : null },
      { label: 'Appointment', value: v.data.appointment_pref || null },
      { label: 'Source', value: `${v.data.source_page} (${v.data.form_name})` },
      { label: 'Message', value: v.data.message },
      ...(possibleDuplicate ? [{ label: 'Note', value: '⚠ Possible duplicate of an existing lead — reconcile before merge.' }] : []),
    ]
    await Promise.allSettled([
      sendVisitorAck({
        // The lead was persisted immediately above; this address was supplied for this reply.
        transactionalBasis: true,
        to: v.data.email,
        subject: `We received your request — ${BUSINESS.short}`,
        heading: `Thanks for reaching out, ${displayName}.`,
        lede: `Your message has reached ${BUSINESS.agent}, ${BUSINESS.title} with ${BUSINESS.carrier}. We aim to respond within ${SLA_HOURS} hours during business hours. Here's a copy of what you sent.`,
        rows: [
          { label: 'Interest', value: v.data.interest || null },
          { label: 'Your message', value: v.data.message },
        ],
        note: 'This is a confirmation that your request was received — no action is needed. If you did not submit this, you can ignore this email.',
      }),
      notifyFsa({
        subject: `New lead — ${v.data.full_name}${v.data.interest ? ` (${v.data.interest})` : ''}`,
        heading: 'New consultation request',
        lede: 'A new lead came in through the public contact form. Details below.',
        rows: leadRows,
        replyTo: v.data.email,
      }),
    ])

    // Never leak the created id to the public caller.
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to submit your message' }, { status: 500 })
  }
}
