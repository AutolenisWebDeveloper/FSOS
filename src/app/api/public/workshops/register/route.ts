import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { WorkshopRegisterSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { provisionZoomForRegistration } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC workshop registration (spec §D). FSOS-native: writes a workshop_registrations
// row with captured consent + DURABLE TCPA/A2P consent evidence (workshop_consent_events),
// an immutable lead_source, and a per-registrant join_token. Guardrails: honeypot, per-IP
// rate limit, capacity check, no securities data, no id leak, published-only. Registration
// is NEVER conditioned on consent; consent boxes are separate/optional. Educational only.
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
    return NextResponse.json(
      { error: 'Please check your details.', details: v.error.flatten() },
      { status: 400 },
    )
  }

  // Immutable lead-source attribution (referring agency slug / campaign / UTM), sanitized.
  const rawSource = typeof parsed.data.lead_source === 'string' ? parsed.data.lead_source : ''
  const leadSource = rawSource.trim().slice(0, 120) || 'workshop'
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null

  try {
    const db = getDb()
    // Published-only: the compliance publish gate is the single door to public registration.
    const { data: w, error: wErr } = await db
      .from('workshops')
      .select('workshop_id, title, status, max_attendees, disclosure_config_id')
      .eq('workshop_id', v.data.workshop_id)
      .maybeSingle()
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
    if (!w || w.status !== 'published') {
      return NextResponse.json({ error: 'This workshop is not open for registration.' }, { status: 404 })
    }

    const { count } = await db
      .from('workshop_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('workshop_id', v.data.workshop_id)
    if (w.max_attendees && (count ?? 0) >= w.max_attendees) {
      return NextResponse.json({ error: 'This workshop is full.' }, { status: 409 })
    }

    // Resolve the session (provided, else the workshop's default 1:1 session).
    let sessionId = v.data.session_id ?? null
    if (!sessionId) {
      const { data: s } = await db
        .from('workshop_sessions')
        .select('id')
        .eq('workshop_id', v.data.workshop_id)
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      sessionId = s?.id ?? null
    }

    // The approved disclosure the registrant is shown (evidence for consent capture).
    let disclosureText = 'Educational event — no product recommendation.'
    let disclosureVersion = 'none'
    if (w.disclosure_config_id) {
      const { data: d } = await db
        .from('workshop_disclosure_configs')
        .select('kind, version, body, is_assumption')
        .eq('id', w.disclosure_config_id)
        .maybeSingle()
      // A published workshop always has an approved (non-placeholder) disclosure (gate),
      // but guard anyway so placeholder text can never be recorded as shown.
      if (d && d.is_assumption === false) {
        disclosureText = d.body
        disclosureVersion = `${d.kind} v${d.version}`
      }
    }

    const channels = [v.data.consent_email ? 'email' : null, v.data.consent_sms ? 'sms' : null].filter(
      Boolean,
    ) as ('email' | 'sms')[]
    const joinToken = randomUUID()

    const { data: reg, error: regErr } = await db
      .from('workshop_registrations')
      .insert({
        workshop_id: v.data.workshop_id,
        session_id: sessionId,
        name: v.data.name,
        email: v.data.email,
        phone: v.data.phone ?? null,
        chosen_delivery: v.data.chosen_delivery ?? null,
        consent_channels: channels,
        lead_source: leadSource,
        join_token: joinToken,
        status: 'registered',
      })
      .select('reg_id')
      .single()
    if (regErr) return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })

    // Durable TCPA/A2P consent evidence — one row per consented channel.
    if (channels.length > 0) {
      await db.from('workshop_consent_events').insert(
        channels.map((channel) => ({
          registration_id: reg.reg_id,
          channel,
          action: 'granted',
          disclosure_text: disclosureText,
          disclosure_version: disclosureVersion,
          ip_address: ip,
          user_agent: userAgent,
        })),
      )
    }

    await writeAudit({
      actor: 'public',
      action: 'entity.created',
      entity: 'workshop_registration',
      entityId: reg.reg_id,
      diff: { workshop_id: v.data.workshop_id, source: leadSource },
    })
    if (channels.length > 0) {
      await writeAudit({
        actor: 'public',
        action: 'consent.captured',
        entity: 'workshop_registration',
        entityId: reg.reg_id,
        diff: { source: 'workshop', channels, disclosure_version: disclosureVersion },
      })
    }

    // Best-effort per-registrant Zoom provisioning (spec §A). Never blocks registration:
    // a virtual/hybrid-virtual registration gets a personalized join_url + registrant token
    // when Zoom is configured; any failure (Zoom off, no meeting id, transient API error)
    // leaves the registration intact for a later /provision-zoom retry — the link is never
    // lost. No securities data is sent to Zoom.
    try {
      await provisionZoomForRegistration(db, reg.reg_id)
    } catch (provErr) {
      console.error('[workshop] zoom provisioning (non-fatal):', provErr)
    }

    return NextResponse.json({ ok: true, workshop: w.title, join_token: joinToken })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })
  }
}
