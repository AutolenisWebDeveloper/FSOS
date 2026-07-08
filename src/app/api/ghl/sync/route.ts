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
  type GhlPipeline,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ghl/sync  (internal)
// Push an FSOS customer into GoHighLevel so the GHL workflows (WF-0…43) can run
// against them. Upserts the contact, then either creates an opportunity at the
// requested pipeline stage or moves the existing one. Idempotent: the returned
// GHL ids are stored back on the customer, so re-syncing reuses them.
//
// Body:
//   { customer_id: string,
//     pipeline?: 'prospect_client' | 'agency_owner' | 'term_conversions',  // default prospect_client
//     stage?: number,        // 1-based position, default 1 (New Opportunity)
//     tags?: string[] }
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
    customer_id: string
    pipeline?: GhlPipeline['key']
    stage?: number
    tags?: string[]
  }>(req)
  if ('error' in parsed) return parsed.error

  const { customer_id, pipeline = 'prospect_client', stage = 1, tags } = parsed.data
  if (!customer_id) {
    return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
  }
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

  // 1) Upsert the contact.
  const up = await upsertContact({
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    source: customer.source || 'fsos',
    tags,
    customFields: {
      sms_consent: customer.consent_sms ? 'true' : 'false',
      email_consent: customer.consent_email ? 'true' : 'false',
    },
  })

  if (!up.ok) {
    return NextResponse.json({ success: false, step: 'upsertContact', error: up.error }, { status: 502 })
  }

  const contactId = up.data?.contact?.id || customer.ghl_contact_id
  if (!contactId) {
    return NextResponse.json({ success: false, error: 'No GHL contact id returned' }, { status: 502 })
  }

  // 2) Create or move the opportunity.
  let opportunityId = customer.ghl_opportunity_id as string | null
  let stageStep = 'createOpportunity'
  if (opportunityId) {
    stageStep = 'moveOpportunityStage'
    const mv = await moveOpportunityStage(opportunityId, pipeline, stage)
    if (!mv.ok) {
      return NextResponse.json({ success: false, step: stageStep, error: mv.error }, { status: 502 })
    }
  } else {
    const clientName = `${customer.first_name} ${customer.last_name}`.trim()
    const opp = await createOpportunity({
      contactId,
      pipelineKey: pipeline,
      stagePosition: stage,
      name: clientName || customer.email || 'FSOS Opportunity',
    })
    if (!opp.ok) {
      return NextResponse.json({ success: false, step: stageStep, error: opp.error }, { status: 502 })
    }
    opportunityId = opp.data?.opportunity?.id || null
  }

  if (tags?.length) await addContactTags(contactId, tags)

  // 3) Persist the GHL ids back onto the customer.
  await supabase
    .from('customers')
    .update({ ghl_contact_id: contactId, ghl_opportunity_id: opportunityId })
    .eq('customer_id', customer_id)

  return NextResponse.json({
    success: true,
    customer_id,
    ghl_contact_id: contactId,
    ghl_opportunity_id: opportunityId,
    pipeline,
    stage,
  })
}
