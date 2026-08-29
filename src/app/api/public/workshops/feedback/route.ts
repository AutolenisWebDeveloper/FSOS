import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { WorkshopFeedbackSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { notifyFsa } from '@/lib/notifications/transactional'
import { convertRegistrationToLead } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC workshop feedback survey (spec §D). Reached from the replay page via the
// registrant's join_token. Writes workshop_feedback (rating 1–5, most_useful,
// consult_requested) — unique per registration, so a re-submit updates in place.
//
// consult_requested=true routes into the EXISTING consult spine via convertRegistrationToLead:
//   - non-securities → GHL Pipeline-A `prospect_client`, lead_source="Event", event tags;
//   - is_security=true → the FFS-supervised path (compliance_events + agent_actions
//     escalation), NEVER the automated consult sequence (guardrail 1).
// Guardrails: honeypot, per-IP rate limit, token-scoped (no id leak), no securities data.
export async function POST(req: NextRequest) {
  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  // Honeypot — bots fill `company`; silently accept without writing.
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const ip = clientIp(req)
  if (!rateLimit(`workshop-feedback:${ip}`, 8, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 })
  }

  const v = WorkshopFeedbackSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Please check your answers.', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    // Resolve the registration by its personal join_token (never by name/email).
    const { data: reg } = await db
      .from('workshop_registrations')
      .select('reg_id, name, email, phone, session_id, workshop_id, lead_converted_at')
      .eq('join_token', v.data.join_token)
      .maybeSingle()
    if (!reg) return NextResponse.json({ error: 'We could not find your registration.' }, { status: 404 })

    // Upsert the feedback (unique on registration_id → idempotent re-submit).
    await db.from('workshop_feedback').upsert(
      {
        registration_id: reg.reg_id,
        session_id: reg.session_id ?? null,
        rating: v.data.rating ?? null,
        most_useful: v.data.most_useful ?? null,
        consult_requested: v.data.consult_requested ?? false,
      },
      { onConflict: 'registration_id' },
    )

    await writeAudit({
      actor: 'public',
      action: 'entity.created',
      entity: 'workshop_feedback',
      entityId: reg.reg_id,
      diff: { rating: v.data.rating ?? null, consult_requested: v.data.consult_requested ?? false },
    })

    // Route a consult request into the existing spine (firewall-gated for is_security).
    let consult: { routed: string } | null = null
    if (v.data.consult_requested) {
      const { data: w } = await db
        .from('workshops')
        .select('is_security, slug, title')
        .eq('workshop_id', reg.workshop_id)
        .maybeSingle()
      const outcome = await convertRegistrationToLead(
        db,
        { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, lead_converted_at: reg.lead_converted_at },
        { is_security: w?.is_security ?? false, slug: w?.slug ?? null, title: w?.title ?? null },
        'public',
        ['wshop-consult-requested', 'wshop-replay-feedback'],
      )
      // WS-043: a consult request is a LIVE buying signal — the FSA hears about it now
      // (internal ops alert, best-effort; the spine routing above is the durable record).
      try {
        await notifyFsa({
          subject: `Consult requested — ${w?.title ?? 'workshop'}`,
          heading: 'Workshop attendee requested a consult',
          lede: `${reg.name ?? 'A registrant'} asked for a consultation from the ${w?.title ?? 'workshop'} feedback form.`,
          rows: [
            { label: 'Name', value: reg.name },
            { label: 'Email', value: reg.email },
            { label: 'Phone', value: reg.phone },
            { label: 'Workshop', value: w?.title ?? null },
            { label: 'Routing', value: outcome.ok ? outcome.routed : 'error' },
          ],
          replyTo: reg.email,
        })
      } catch (nErr) {
        console.error('[workshop-feedback] consult notify (non-fatal):', nErr)
      }
      if (outcome.ok) {
        // convertRegistrationToLead marks the native conversion (lead_converted_at) itself
        // for the non-securities path; securities routes to FFS. Nothing further to persist.
        consult = { routed: outcome.routed }
      }
      await writeAudit({
        actor: 'public',
        action: 'entity.updated',
        entity: 'workshop_registration',
        entityId: reg.reg_id,
        diff: { via: 'feedback_consult_request', routed: outcome.ok ? outcome.routed : 'error' },
      })
    }

    return NextResponse.json({ ok: true, consult })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not submit feedback.' }, { status: 500 })
  }
}
