import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'
import {
  ghlEnabled,
  upsertContact,
  createOpportunity,
  moveOpportunityStage,
  addContactTags,
  PIPELINES,
  GHL_CUSTOM_FIELDS,
  type GhlPipeline,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ghl/sync  (internal)
// Push an FSOS record into GoHighLevel so the GHL workflows (WF-0…43) can run
// against it. Upserts the contact, then creates an opportunity at the requested
// pipeline stage or moves the existing one. Idempotent: the returned GHL ids are
// stored back on the record, so re-syncing reuses them.
//
// Two modes (exactly one of customer_id / agency_id):
//   Customer → { customer_id, pipeline?, stage?, tags? }
//              default pipeline 'prospect_client', stage 1 (New Opportunity)
//   Owner    → { agency_id, pipeline?, stage?, tags? }
//              default pipeline 'agency_owner', stage 1 (Prospect Owner)
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  if (!ghlEnabled()) {
    return NextResponse.json(
      { success: false, error: 'GHL not configured (set GHL_API_KEY)' },
      { status: 503 },
    )
  }

  const parsed = await readJson<{
    customer_id?: string
    agency_id?: string
    pipeline?: GhlPipeline['key']
    stage?: number
    tags?: string[]
  }>(req)
  if ('error' in parsed) return parsed.error

  const { customer_id, agency_id } = parsed.data
  if (!customer_id && !agency_id) {
    return NextResponse.json({ error: 'customer_id or agency_id required' }, { status: 400 })
  }

  return agency_id ? syncAgency(parsed.data) : syncCustomer(parsed.data)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncCustomer(body: Record<string, any>) {
  const { customer_id, pipeline = 'prospect_client', stage = 1, tags } = body
  if (!PIPELINES.some((p) => p.key === pipeline)) {
    return NextResponse.json({ error: `Unknown pipeline: ${pipeline}` }, { status: 400 })
  }

  const supabase = getDb()
  const { data: customer, error } = await supabase
    .from('customers')
    .select(
      'customer_id, first_name, last_name, email, phone, source, consent_sms, consent_email, ghl_contact_id, ghl_opportunity_id',
    )
    .eq('customer_id', customer_id)
    .single()

  if (error || !customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const up = await upsertContact({
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    source: customer.source || 'fsos',
    tags,
    customFields: {
      [GHL_CUSTOM_FIELDS.sms_consent]: customer.consent_sms ? 'true' : 'false',
      [GHL_CUSTOM_FIELDS.email_consent]: customer.consent_email ? 'true' : 'false',
    },
  })
  if (!up.ok) {
    return NextResponse.json({ success: false, step: 'upsertContact', error: up.error }, { status: 502 })
  }
  const contactId = up.data?.contact?.id || customer.ghl_contact_id
  if (!contactId) {
    return NextResponse.json({ success: false, error: 'No GHL contact id returned' }, { status: 502 })
  }

  const name = `${customer.first_name} ${customer.last_name}`.trim() || customer.email || 'FSOS Opportunity'
  const oppRes = await upsertOpportunity(customer.ghl_opportunity_id, contactId, pipeline, stage, name)
  if ('error' in oppRes) return oppRes.error
  if (tags?.length) await addContactTags(contactId, tags)

  await supabase
    .from('customers')
    .update({ ghl_contact_id: contactId, ghl_opportunity_id: oppRes.opportunityId })
    .eq('customer_id', customer_id)

  return NextResponse.json({
    success: true,
    customer_id,
    ghl_contact_id: contactId,
    ghl_opportunity_id: oppRes.opportunityId,
    pipeline,
    stage,
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncAgency(body: Record<string, any>) {
  const { agency_id, pipeline = 'agency_owner', stage = 1, tags } = body
  if (!PIPELINES.some((p) => p.key === pipeline)) {
    return NextResponse.json({ error: `Unknown pipeline: ${pipeline}` }, { status: 400 })
  }

  const supabase = getDb()
  const { data: agency, error } = await supabase
    .from('agencies')
    .select('agency_id, name, owner, email, phone, ghl_contact_id, ghl_opportunity_id')
    .eq('agency_id', agency_id)
    .single()

  if (error || !agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }

  const ownerParts = String(agency.owner || '').trim().split(' ')
  const up = await upsertContact({
    firstName: ownerParts[0] || agency.name || 'Owner',
    lastName: ownerParts.slice(1).join(' ') || '',
    email: agency.email,
    phone: agency.phone,
    source: 'fsos_agency',
    tags: tags || ['type-owner'],
    customFields: {
      [GHL_CUSTOM_FIELDS.contact_type]: 'agency_owner',
      [GHL_CUSTOM_FIELDS.owner_agency]: agency.name || '',
    },
  })
  if (!up.ok) {
    return NextResponse.json({ success: false, step: 'upsertContact', error: up.error }, { status: 502 })
  }
  const contactId = up.data?.contact?.id || agency.ghl_contact_id
  if (!contactId) {
    return NextResponse.json({ success: false, error: 'No GHL contact id returned' }, { status: 502 })
  }

  const name = agency.name || agency.owner || 'Agency Owner'
  const oppRes = await upsertOpportunity(agency.ghl_opportunity_id, contactId, pipeline, stage, name)
  if ('error' in oppRes) return oppRes.error
  if (tags?.length) await addContactTags(contactId, tags)

  await supabase
    .from('agencies')
    .update({ ghl_contact_id: contactId, ghl_opportunity_id: oppRes.opportunityId })
    .eq('agency_id', agency_id)

  return NextResponse.json({
    success: true,
    agency_id,
    ghl_contact_id: contactId,
    ghl_opportunity_id: oppRes.opportunityId,
    pipeline,
    stage,
  })
}

// Create the opportunity if there's no id yet, otherwise move the existing one.
async function upsertOpportunity(
  existingId: string | null,
  contactId: string,
  pipeline: GhlPipeline['key'],
  stage: number,
  name: string,
): Promise<{ opportunityId: string | null } | { error: NextResponse }> {
  if (existingId) {
    const mv = await moveOpportunityStage(existingId, pipeline, stage)
    if (!mv.ok) {
      return {
        error: NextResponse.json(
          { success: false, step: 'moveOpportunityStage', error: mv.error },
          { status: 502 },
        ),
      }
    }
    return { opportunityId: existingId }
  }
  const opp = await createOpportunity({ contactId, pipelineKey: pipeline, stagePosition: stage, name })
  if (!opp.ok) {
    return {
      error: NextResponse.json(
        { success: false, step: 'createOpportunity', error: opp.error },
        { status: 502 },
      ),
    }
  }
  return { opportunityId: opp.data?.opportunity?.id || null }
}
