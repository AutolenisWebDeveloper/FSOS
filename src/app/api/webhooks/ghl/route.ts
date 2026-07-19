import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  findStageById,
  isApplicationSubmittedStage,
  isIssuedStage,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/ghl
// ─────────────────────────────────────────────────────────────────────────
// Receives native GoHighLevel workflow / automation webhooks for the
// Markist Athelus Agency location and syncs them into Supabase.
//
// Setup in GHL:
//   Automation → Workflows → add a "Webhook" action (or Settings → Webhooks)
//   POST https://<your-domain>/api/webhooks/ghl
//   Set a shared secret and store it as GHL_WEBHOOK_SECRET; configure GHL to
//   sign the raw body (HMAC-SHA256, hex) into the `x-ghl-signature` header.
//
// Events handled:
//   ContactCreate / ContactUpdate     → upsert customer, link ghl_contact_id
//   OpportunityStageUpdate            → resolve stage via the ID map; create a
//                                       commission case at "Application
//                                       Submitted", mark issued at "Issued"
//   AppointmentCreate                 → log appointment activity
//   ContactDndUpdate / OptOut         → append to consent ledger, flip consent
//
// The route always returns 200 on handler errors (logged) to avoid GHL
// retry-storms; only auth/parse failures return non-200.
// ─────────────────────────────────────────────────────────────────────────

function verifyGHLSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed in production; allow through in non-prod for local testing.
    return process.env.NODE_ENV !== 'production'
  }
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evt = Record<string, any>

// GHL is inconsistent about event-type field/casing across native webhooks and
// custom workflow webhooks. Normalise to a lowercase token.
function eventType(evt: Evt): string {
  return String(evt.type || evt.event || evt.eventType || evt.webhookType || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-ghl-signature') || req.headers.get('x-wh-signature') || ''

  if (!verifyGHLSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let evt: Evt
  try {
    evt = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const kind = eventType(evt)

  try {
    if (kind.includes('opportunity')) {
      await handleOpportunityStage(evt)
    } else if (kind.includes('appointment')) {
      await handleAppointment(evt)
    } else if (kind.includes('dnd') || kind.includes('optout') || kind.includes('unsubscribe')) {
      await handleOptOut(evt)
    } else if (kind.includes('contact')) {
      await handleContactUpsert(pickContact(evt))
    } else {
      console.log('[ghl] unhandled event type:', kind || '(none)')
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[ghl] webhook handler error:', err)
    return NextResponse.json({ received: true, error: 'Handler error logged' })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

// Native GHL webhooks put contact fields at the top level; workflow webhooks
// often nest them under `contact`. Accept both.
function pickContact(evt: Evt): Evt {
  return (evt.contact as Evt) || evt || {}
}

function contactName(c: Evt): { first: string; last: string } {
  const first =
    (c.firstName as string) ||
    (c.first_name as string) ||
    (String(c.name || c.full_name || '').trim().split(' ')[0] || 'Unknown')
  const last =
    (c.lastName as string) ||
    (c.last_name as string) ||
    String(c.name || c.full_name || '')
      .trim()
      .split(' ')
      .slice(1)
      .join(' ')
  return { first: first || 'Unknown', last: last || '' }
}

async function findCustomerByContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ghlContactId: string | null,
  email: string | null,
): Promise<string | null> {
  if (ghlContactId) {
    const { data } = await supabase
      .from('customers')
      .select('customer_id')
      .eq('ghl_contact_id', ghlContactId)
      .maybeSingle()
    if (data) return data.customer_id
  }
  if (email) {
    const { data } = await supabase
      .from('customers')
      .select('customer_id')
      .eq('email', email.toLowerCase())
      .maybeSingle()
    if (data) return data.customer_id
  }
  return null
}

// `c` is an already-resolved contact object (not the whole event), so
// opportunity/appointment handlers can pass the nested contact explicitly and
// never accidentally mint a customer from event-level fields.
async function handleContactUpsert(c: Evt): Promise<string | null> {
  const supabase = getDb()
  const ghlContactId = (c.id as string) || (c.contactId as string) || (c.contact_id as string) || null
  const email = ((c.email as string) || '').toLowerCase() || null
  const phone = (c.phone as string) || (c.phoneNumber as string) || null
  if (!ghlContactId && !email) return null

  const existingId = await findCustomerByContact(supabase, ghlContactId, email)

  if (existingId) {
    const patch: Record<string, unknown> = {}
    if (ghlContactId) patch.ghl_contact_id = ghlContactId
    if (phone) patch.phone = phone
    if (Object.keys(patch).length) {
      await supabase.from('customers').update(patch).eq('customer_id', existingId)
    }
    return existingId
  }

  const { first, last } = contactName(c)
  const { data: newC } = await supabase
    .from('customers')
    .insert({
      first_name: first,
      last_name: last,
      email,
      phone,
      ghl_contact_id: ghlContactId,
      source: 'ghl',
      // Never infer consent from a webhook. A GHL ContactCreate can fire for an
      // imported/purchased/scraped contact who gave no express consent, so the
      // mere presence of an email is NOT consent (TCPA/CAN-SPAM + roadmap rule
      // "do not assume consent on import"). Consent must arrive as its own
      // recorded event (opt-in form, Calendly funnel, or GHL consent webhook)
      // that writes an immutable consent_ledger row. Leave the flags at their
      // DB default of false so the campaign runner will not message this
      // contact until real consent is captured.
      consent_email: false,
      consent_sms: false,
    })
    .select('customer_id')
    .single()

  return newC?.customer_id ?? null
}

async function handleOpportunityStage(evt: Evt) {
  const supabase = getDb()
  const opp = (evt.opportunity as Evt) || evt
  const oppId = (opp.id as string) || (opp.opportunityId as string) || null
  const stageId =
    (opp.pipelineStageId as string) ||
    (opp.pipeline_stage_id as string) ||
    ((opp.pipelineStage as Evt) || {}).id ||
    null
  if (!oppId) return

  const loc = findStageById(stageId)

  // Resolve the contact explicitly from the opportunity payload (nested
  // `contact` object, or a bare `contactId`) — never from event-level fields.
  const oppContact: Evt =
    (opp.contact as Evt) ||
    (evt.contact as Evt) || {
      id: (opp.contactId as string) || (opp.contact_id as string) || null,
      email: opp.email || null,
      name: opp.contactName || opp.name || null,
      phone: opp.phone || null,
    }

  // Make sure we have a linked customer (upsert from the embedded contact).
  const customerId = await handleContactUpsert(oppContact)
  if (!customerId) return

  // Keep the customer's current-stage pointer fresh for the command center.
  await supabase
    .from('customers')
    .update({
      ghl_opportunity_id: oppId,
      ghl_stage_id: stageId || null,
      ghl_pipeline_id: loc?.pipeline.id || null,
    })
    .eq('customer_id', customerId)

  // Application Submitted → create a commission case (idempotent on opp id).
  if (isApplicationSubmittedStage(stageId)) {
    const { data: existing } = await supabase
      .from('commission_cases')
      .select('case_id')
      .eq('ghl_opportunity_id', oppId)
      .maybeSingle()

    if (!existing) {
      const premium = opp.monetaryValue != null ? Number(opp.monetaryValue) : null
      await supabase.from('commission_cases').insert({
        customer_id: customerId,
        carrier: (opp.carrier as string) || 'Unknown',
        product_name: (opp.productName as string) || (opp.name as string) || 'Unknown',
        product_type: (opp.productType as string) || 'unknown',
        premium: Number.isFinite(premium as number) ? premium : null,
        case_status: 'submitted',
        submitted_at: new Date().toISOString(),
        ghl_opportunity_id: oppId,
        pipeline: loc?.pipeline.internal || 'general',
      })
    }
  }

  // Issued / Converted → mark the case issued.
  if (isIssuedStage(stageId)) {
    await supabase
      .from('commission_cases')
      .update({ case_status: 'issued', issued_at: new Date().toISOString() })
      .eq('ghl_opportunity_id', oppId)
      .neq('case_status', 'issued')
  }

  await supabase.from('activity').insert({
    customer_id: customerId,
    type: 'note',
    channel: 'ghl',
    subject: `Pipeline stage → ${loc ? loc.stageName : stageId || 'unknown'}`,
    notes: loc
      ? `${loc.pipeline.name} · stage ${loc.position} · opp ${oppId}`
      : `Opportunity ${oppId} moved to unmapped stage ${stageId}`,
  })
}

async function handleAppointment(evt: Evt) {
  const supabase = getDb()
  const c = pickContact(evt)
  const appt = (evt.appointment as Evt) || (evt.calendar as Evt) || {}
  const ghlContactId = (c.id as string) || null
  const email = ((c.email as string) || '').toLowerCase() || null

  const customerId =
    (await findCustomerByContact(supabase, ghlContactId, email)) ||
    (await handleContactUpsert(c))
  if (!customerId) return

  await supabase.from('activity').insert({
    customer_id: customerId,
    type: 'appointment',
    direction: 'inbound',
    channel: 'ghl',
    subject: `Appointment booked — ${(appt.title as string) || 'Financial Review'}`,
    notes: `Via GHL · ${(appt.startTime as string) || (appt.start_time as string) || ''}`,
    ghl_activity_id: (appt.id as string) || null,
  })
}

async function handleOptOut(evt: Evt) {
  const supabase = getDb()
  const c = pickContact(evt)
  const ghlContactId = (c.id as string) || null
  const email = ((c.email as string) || '').toLowerCase() || null
  const customerId = await findCustomerByContact(supabase, ghlContactId, email)
  if (!customerId) return

  const dnd = (evt.dnd as Evt) || {}
  const rawChannel = ((dnd.channel as string) || (evt.channel as string) || 'sms').toLowerCase()
  // Normalize GHL's channel value. Case-sensitive matching previously let
  // "Email", "all", or "both" fall through and clear only SMS consent, so a
  // contact who opted out of email kept receiving campaign emails. Treat any
  // all/both/*/dnd value as an opt-out of BOTH channels — the safe default.
  const optOutEmail = ['email', 'all', 'both', '*', 'dnd'].includes(rawChannel)
  const optOutSms = rawChannel !== 'email' // everything except an email-only opt-out clears SMS

  await supabase.from('consent_ledger').insert({
    customer_id: customerId,
    channel: rawChannel,
    status: 'opted_out',
    source: 'ghl_webhook',
    notes: `GHL opt-out (${rawChannel})`,
  })

  const patch: Record<string, boolean> = {}
  if (optOutEmail) patch.consent_email = false
  if (optOutSms) patch.consent_sms = false
  if (Object.keys(patch).length) {
    await supabase.from('customers').update(patch).eq('customer_id', customerId)
  }
}
