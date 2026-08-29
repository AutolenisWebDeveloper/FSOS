import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { WorkshopRegisterSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { provisionZoomForRegistration } from '@/lib/workshops/server'
import { notifyFsa, renderHtml, renderText, type EmailContent } from '@/lib/notifications/transactional'
import { sendThroughGate } from '@/lib/comms/send'
import { buildIcs } from '@/lib/booking/ics'
import { BUSINESS } from '@/lib/site'
import {
  SIGNUP_FORM_VERSION,
  SMS_REMINDER_DISCLOSURE,
  MARKETING_OPT_IN_LABEL,
  EMAIL_REMINDER_BASIS,
} from '@/lib/workshops/consent-copy'

// Gate step-4 handle for the instant ack (seeded approved in migration 131 — the
// pre-existing live production receipt, brought under sendThroughGate by D-8).
const ACK_GATE_TEMPLATE_ID = 'eeee0000-0000-4000-8000-00000000ac01'

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

  // WS-061: the rate limiter runs FIRST so honeypot traffic consumes the per-IP window
  // (previously the fake-success short-circuit let bots probe without ever being counted).
  const ip = clientIp(req)
  if (!rateLimit(`workshop-reg:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 })
  }

  // Honeypot — bots fill `company`; accept without writing, but LOG the hit (WS-057:
  // an autofill victim's silent drop must at least be visible in monitoring).
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    console.warn('[workshop-register] honeypot hit (no row written)', { ip })
    return NextResponse.json({ ok: true })
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
    if (wErr) return dbErrorResponse('public/workshops/register', wErr)
    if (!w || w.status !== 'published') {
      return NextResponse.json({ error: 'This workshop is not open for registration.' }, { status: 404 })
    }

    // Resolve the session (provided, else the workshop's next UPCOMING session — the
    // claim function re-verifies it belongs to this workshop and has not started).
    let sessionId = v.data.session_id ?? null
    if (!sessionId) {
      const { data: s } = await db
        .from('workshop_sessions')
        .select('id')
        .eq('workshop_id', v.data.workshop_id)
        .neq('status', 'cancelled')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      sessionId = s?.id ?? null
    }
    if (!sessionId) {
      return NextResponse.json({ error: 'This workshop has no upcoming session to register for.' }, { status: 409 })
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

    // SETTLED model: registering IS reminder consent — the reachable channels are simply
    // the contact details provided. consent_channels stays as the capture-time staging
    // record; the MARKETING fact is the single opt-in box, stored on the row below.
    const channels = ['email', ...(v.data.phone ? ['sms'] : [])] as ('email' | 'sms')[]
    const joinToken = randomUUID()

    // Atomic seat claim (migration 128): session-locked per-mode capacity count + insert
    // in ONE transaction — concurrent last-seat claims serialize, duplicates surface as a
    // distinct outcome, past/mismatched/cancelled sessions are refused (WS-003/004/037/
    // 048/060, D-7). Email is normalized to lowercase inside the claim.
    const { data: claim, error: claimErr } = await db.rpc('workshop_claim_registration', {
      p_workshop: v.data.workshop_id,
      p_session: sessionId,
      p_name: v.data.name,
      p_email: v.data.email,
      p_phone: v.data.phone ?? null,
      p_chosen_delivery: v.data.chosen_delivery ?? null,
      p_consent_channels: channels,
      p_lead_source: leadSource,
      p_join_token: joinToken,
      p_guest_count: v.data.guest_count ?? 0,
    })
    if (claimErr) return dbErrorResponse('public/workshops/register', claimErr)
    const outcome = (claim ?? {}) as { ok?: boolean; reason?: string; reg_id?: string; seats_left?: number }
    if (!outcome.ok) {
      switch (outcome.reason) {
        case 'duplicate':
          // WS-024: already registered is a STATE, not an error — and never a second row.
          return NextResponse.json({ ok: true, already_registered: true, workshop: w.title })
        case 'full':
          return NextResponse.json(
            { error: 'This session is full.', code: 'full', seats_left: outcome.seats_left ?? 0 },
            { status: 409 },
          )
        case 'past_event':
          return NextResponse.json({ error: 'This session has already started.', code: 'past_event' }, { status: 409 })
        case 'session_cancelled':
          return NextResponse.json({ error: 'This session has been cancelled.', code: 'session_cancelled' }, { status: 409 })
        case 'session_not_found':
        case 'session_mismatch':
          return NextResponse.json({ error: 'Please pick a valid session for this workshop.' }, { status: 422 })
        case 'not_published':
          return NextResponse.json({ error: 'This workshop is not open for registration.' }, { status: 404 })
        default:
          return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })
      }
    }
    const reg = { reg_id: outcome.reg_id as string }

    // D-3.3: the consent facts live ON THE REGISTRATION ROW — the marketing opt-in, the
    // capture timestamp, and the exact form version the registrant was shown.
    await db
      .from('workshop_registrations')
      .update({
        marketing_opt_in: v.data.marketing_opt_in === true,
        consent_captured_at: new Date().toISOString(),
        consent_form_version: SIGNUP_FORM_VERSION,
      })
      .eq('reg_id', reg.reg_id)

    // Capture-time evidence trail (unchanged store): the reminder basis for each reachable
    // channel — with the DISCLOSURE ACTUALLY SHOWN at the field — plus a marketing row per
    // channel when the one box was ticked.
    const evidence = [
      ...channels.map((channel) => ({
        registration_id: reg.reg_id,
        channel,
        action: 'granted',
        disclosure_text: channel === 'sms' ? SMS_REMINDER_DISCLOSURE : `${disclosureText} ${EMAIL_REMINDER_BASIS}`,
        disclosure_version: `${SIGNUP_FORM_VERSION} · ${disclosureVersion}`,
        ip_address: ip,
        user_agent: userAgent,
      })),
      ...(v.data.marketing_opt_in === true
        ? channels.map((channel) => ({
            registration_id: reg.reg_id,
            channel,
            action: 'granted',
            disclosure_text: MARKETING_OPT_IN_LABEL,
            disclosure_version: `${SIGNUP_FORM_VERSION} · marketing`,
            ip_address: ip,
            user_agent: userAgent,
          }))
        : []),
    ]
    await db.from('workshop_consent_events').insert(evidence)

    await writeAudit({
      actor: 'public',
      action: 'entity.created',
      entity: 'workshop_registration',
      entityId: reg.reg_id,
      diff: { workshop_id: v.data.workshop_id, source: leadSource },
    })
    {
      await writeAudit({
        actor: 'public',
        action: 'consent.captured',
        entity: 'workshop_registration',
        entityId: reg.reg_id,
        diff: { source: 'workshop', channels, marketing_opt_in: v.data.marketing_opt_in === true, form_version: SIGNUP_FORM_VERSION },
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

    // When (date, venue) is known, surface it in the acknowledgement. Best-effort lookup —
    // a missing session never blocks the confirmation (the cron cadence carries the details).
    let whenLocal: string | null = null
    let venue: string | null = null
    let sessionForIcs: { starts_at: string; ends_at: string | null; venue_name: string | null; venue_address: string | null; ics_uid: string | null } | null = null
    if (sessionId) {
      const { data: s } = await db
        .from('workshop_sessions')
        .select('starts_at, ends_at, timezone, venue_name, venue_address, ics_uid')
        .eq('id', sessionId)
        .maybeSingle()
      sessionForIcs = s ?? null
      if (s?.starts_at) {
        try {
          whenLocal = new Intl.DateTimeFormat('en-US', {
            timeZone: s.timezone || 'America/Chicago',
            dateStyle: 'full',
            timeStyle: 'short',
          }).format(new Date(s.starts_at))
        } catch {
          whenLocal = new Date(s.starts_at).toUTCString()
        }
      }
      venue = s?.venue_name || s?.venue_address || null
    }

    // TRANSACTIONAL receipt (best-effort — the registration is already persisted). D-8:
    // the instant ack IS the single confirmation of record (the engine 'confirmation'
    // kind is deleted) and it now rides sendThroughGate like every other client-facing
    // send — one send path per channel; DNC/suppression enforced even on the receipt.
    // The .ics calendar file attaches here (WS-022). The FSA ops alert is internal.
    const displayName = v.data.name?.trim() || 'there'
    const ackContent: EmailContent = {
      heading: `You're registered, ${displayName}.`,
      lede: `Thanks for registering for “${w.title}” with ${BUSINESS.agent}. This is an educational event — no product recommendation. Your details are below.`,
      rows: [
        { label: 'Workshop', value: w.title },
        { label: 'When', value: whenLocal },
        { label: 'Where', value: venue },
      ],
      note: 'We\'ll send a reminder before the event. If you did not register, you can ignore this email.',
    }
    // Calendar attachment — DTEND falls back to +60min when the session has no end time.
    let attachments: { filename: string; content: string; contentType: string }[] | undefined
    if (sessionForIcs?.starts_at) {
      const endsAt = sessionForIcs.ends_at ?? new Date(Date.parse(sessionForIcs.starts_at) + 60 * 60_000).toISOString()
      const ics = buildIcs({
        uid: sessionForIcs.ics_uid ?? `fsos-workshop-${sessionId}`,
        title: w.title,
        description: 'Educational workshop — no product recommendation.',
        location: sessionForIcs.venue_name || sessionForIcs.venue_address || undefined,
        startsAt: sessionForIcs.starts_at,
        endsAt,
      })
      attachments = [{ filename: 'workshop.ics', content: Buffer.from(ics, 'utf8').toString('base64'), contentType: 'text/calendar' }]
    }
    await Promise.allSettled([
      sendThroughGate({
        channel: 'email',
        to: v.data.email,
        subject: `You're registered — ${w.title}`,
        body: renderHtml(ackContent),
        bodyText: renderText(ackContent),
        actor: 'system:workshop-register',
        // Registration receipt: servicing-class, and registering IS its basis (D-3).
        purpose: 'TRANSACTIONAL',
        durableConsentGranted: true,
        isSecurity: false,
        // Gate step 4 handle (mig 131) — the pre-existing live receipt brought under the gate.
        templateId: ACK_GATE_TEMPLATE_ID,
        entity: { type: 'workshop_registration', id: reg.reg_id },
        recipientContext: { full_name: v.data.name },
        attachments,
      }),
      notifyFsa({
        subject: `New workshop registration — ${w.title}`,
        heading: 'New workshop registration',
        lede: `${v.data.name} just registered through the public site.`,
        rows: [
          { label: 'Name', value: v.data.name },
          { label: 'Email', value: v.data.email },
          { label: 'Phone', value: v.data.phone ?? null },
          { label: 'Workshop', value: w.title },
          { label: 'When', value: whenLocal },
          { label: 'Consent', value: channels.length ? channels.join(', ') : 'none' },
          { label: 'Source', value: leadSource },
        ],
        replyTo: v.data.email,
      }),
    ])

    return NextResponse.json({ ok: true, workshop: w.title, join_token: joinToken })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })
  }
}
