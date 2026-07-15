import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { WorkshopRegisterSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC workshop registration (docs/legacy-port.md §2.5). FSOS-native: writes a
// workshop_registrations row with captured consent. Guardrails: honeypot, per-IP
// rate limit, consent captured at registration (materialized on convert-to-referral),
// capacity check, no securities data, no id leak. Educational events only.
export async function POST(req: NextRequest) {
  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  // Honeypot — bots fill `company`; silently accept without writing.
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const ip = clientIp(req)
  if (!rateLimit(`workshop-reg:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 })
  }

  const v = WorkshopRegisterSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Please provide your name and a valid email.', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const { data: w, error: wErr } = await db
      .from('workshops')
      .select('workshop_id, title, status, max_attendees')
      .eq('workshop_id', v.data.workshop_id)
      .maybeSingle()
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
    if (!w || w.status === 'cancelled') return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    const { count } = await db
      .from('workshop_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('workshop_id', v.data.workshop_id)
    if (w.max_attendees && (count ?? 0) >= w.max_attendees) {
      return NextResponse.json({ error: 'This workshop is full.' }, { status: 409 })
    }

    const channels = [v.data.consent_email ? 'email' : null, v.data.consent_sms ? 'sms' : null].filter(
      Boolean,
    ) as string[]

    const { data: reg, error: regErr } = await db
      .from('workshop_registrations')
      .insert({
        workshop_id: v.data.workshop_id,
        name: v.data.name,
        email: v.data.email,
        phone: v.data.phone ?? null,
        consent_channels: channels,
        status: 'registered',
      })
      .select('reg_id')
      .single()
    if (regErr) return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })

    await writeAudit({
      actor: 'public',
      action: 'entity.created',
      entity: 'workshop_registration',
      entityId: reg.reg_id,
      diff: { workshop_id: v.data.workshop_id, source: 'workshop' },
    })
    if (channels.length > 0) {
      await writeAudit({
        actor: 'public',
        action: 'consent.captured',
        entity: 'workshop_registration',
        entityId: reg.reg_id,
        diff: { source: 'workshop', channels },
      })
    }

    return NextResponse.json({ ok: true, workshop: w.title })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })
  }
}
