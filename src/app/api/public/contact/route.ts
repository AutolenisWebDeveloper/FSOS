import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { ContactLeadSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { emailLc } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC, UNAUTHENTICATED homepage contact / consultation-request intake.
// Creates a lead on the CRM referral spine (owner_scope null → surfaces in the
// FSA's public-referral triage), records a non-destructive possible-duplicate
// signal, and captures A2P 10DLC SMS consent EVIDENCE (wording version, source,
// timestamp, IP, user agent, masked phone) — but only when the visitor
// affirmatively checked the box. Providing a phone number NEVER enrolls SMS.
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

    // SMS consent EVIDENCE — only on affirmative opt-in. Materializes into a
    // `consents` row once the lead converts to a household member (WF-1 spine).
    if (v.data.consent_sms) {
      await db.from('activities').insert({
        entity_type: 'referral',
        entity_id: referral.id,
        kind: 'consent_intent',
        note: `SMS consent captured at public intake (${v.data.consent_version ?? 'unversioned'})`,
        actor,
      })
      await writeAudit({
        actor,
        action: 'consent.captured',
        entity: 'referral',
        entityId: referral.id,
        diff: {
          channels: ['sms'],
          consent_version: v.data.consent_version ?? null,
          source_page: v.data.source_page,
          form_name: v.data.form_name,
          captured_at: now.toISOString(),
          ip_masked: mask(ip),
          user_agent: userAgent,
          phone_masked: mask(phone),
          purpose: 'appointments, requested information, service updates, account servicing, customer support',
        },
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

    // Never leak the created id to the public caller.
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to submit your message' }, { status: 500 })
  }
}
