import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { FormPublicSubmitSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC, UNAUTHENTICATED client-form intake (docs/legacy-port.md §2.3).
// Writes a form_responses row against an active template. Guardrails:
//  - honeypot (`company`) silently accepts bots without writing
//  - fixed-window rate limit per IP (best-effort flood defense)
//  - consent captured with source 'client_form' (materialized into consents on
//    attach to a household); never messageable until consent + a household exist
//  - NO securities data is collected or accepted (guardrail §2.1)
//  - the created id is never leaked back to the public caller
export async function POST(req: NextRequest) {
  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  // Honeypot: bots fill the hidden `company` field. Silently accept, write nothing.
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const ip = clientIp(req)
  if (!rateLimit(`form-submit:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many submissions. Please try again shortly.' }, { status: 429 })
  }

  const v = FormPublicSubmitSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid submission', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()

    // Resolve the template by public slug; must be active.
    const { data: template, error: tErr } = await db
      .from('form_templates')
      .select('id, slug, active, captures_consent')
      .eq('slug', v.data.template_slug)
      .maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!template || !template.active) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }

    const channels = [v.data.consent_sms ? 'sms' : null, v.data.consent_email ? 'email' : null].filter(
      Boolean,
    ) as string[]

    // If this submission is for a pre-sent tokened link, update that row; else insert.
    let responseId: string | null = null
    if (v.data.token) {
      const { data: existing } = await db
        .from('form_responses')
        .select('id, status')
        .eq('token', v.data.token)
        .eq('template_id', template.id)
        .is('deleted_at', null)
        .maybeSingle()
      if (existing && existing.status !== 'submitted' && existing.status !== 'attached') {
        const { data: upd, error: uErr } = await db
          .from('form_responses')
          .update({
            status: 'submitted',
            data: v.data.answers,
            submitter_name: v.data.full_name,
            submitter_email: v.data.email,
            submitter_phone: v.data.phone ?? null,
            consent_channels: channels,
            ip_address: ip,
            submitted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .neq('status', 'submitted')
          .select('id')
        if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
        responseId = upd?.[0]?.id ?? null
      }
    }

    if (!responseId) {
      const { data: ins, error: iErr } = await db
        .from('form_responses')
        .insert({
          template_id: template.id,
          token: v.data.token ?? null,
          status: 'submitted',
          data: v.data.answers,
          submitter_name: v.data.full_name,
          submitter_email: v.data.email,
          submitter_phone: v.data.phone ?? null,
          consent_channels: channels,
          ip_address: ip,
          submitted_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
      responseId = ins.id
    }

    // Audit on the PUBLIC actor (§2.3: "Audit actor='public' on submission").
    await writeAudit({
      actor: 'public',
      action: 'entity.created',
      entity: 'form_response',
      entityId: responseId,
      diff: { template: template.slug, source: 'client_form' },
    })
    if (template.captures_consent && channels.length > 0) {
      await writeAudit({
        actor: 'public',
        action: 'consent.captured',
        entity: 'form_response',
        entityId: responseId,
        diff: { source: 'client_form', channels },
      })
    }

    // Never leak the created id to the public caller.
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to submit form' }, { status: 500 })
  }
}
