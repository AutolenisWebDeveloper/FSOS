import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { GhlSyncSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import {
  ghlEnabled,
  upsertContactWithRetry,
  createOpportunity,
  moveOpportunityStage,
  addContactTags,
  GHL_CUSTOM_FIELDS,
  type GhlPipeline,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Native GoHighLevel sync (App A parity, rebuilt on the App B spine). Push an App
// B record into GHL so its workflows can run, then store the returned ids back on
// the record for idempotent re-sync. Two modes:
//   household → prospect_client pipeline · agency → agency_owner pipeline.
// This is an outbound CRM sync of identity + pipeline placement only. It never
// sends a client-facing message (those go through /api/comms/send's 7-step gate),
// so it is not gated by consent here; consent is enforced at send time.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = String(full || '').trim().split(/\s+/)
  return { firstName: parts[0] || full || 'Contact', lastName: parts.slice(1).join(' ') }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  if (!ghlEnabled()) {
    return NextResponse.json({ error: 'GoHighLevel not configured (set GHL_API_KEY).', reason: 'not_configured' }, { status: 503 })
  }

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = GhlSyncSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { entity_type, entity_id } = v.data

    // Resolve the record → contact identity, default pipeline, and stored ids.
    let displayName = ''
    let contact: { firstName: string; lastName: string; email: string | null; phone: string | null }
    let pipeline: GhlPipeline['key']
    let existingContactId: string | null
    let existingOppId: string | null
    let customFields: Record<string, string>
    const table = entity_type === 'agency' ? 'agency_partnerships' : 'households'

    if (entity_type === 'agency') {
      const { data: agency } = await db
        .from('agency_partnerships')
        .select('id, agency_name, owner_name, ghl_contact_id, ghl_opportunity_id')
        .eq('id', entity_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!agency) return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
      const { data: owner } = await db
        .from('agency_owners')
        .select('email, phone, full_name')
        .eq('agency_id', entity_id)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      const nm = splitName(agency.owner_name || owner?.full_name || agency.agency_name)
      displayName = agency.agency_name || agency.owner_name || 'Agency Owner'
      contact = { firstName: nm.firstName, lastName: nm.lastName, email: owner?.email ?? null, phone: owner?.phone ?? null }
      pipeline = v.data.pipeline ?? 'agency_owner'
      existingContactId = agency.ghl_contact_id ?? null
      existingOppId = agency.ghl_opportunity_id ?? null
      customFields = { [GHL_CUSTOM_FIELDS.contact_type]: 'agency_owner', [GHL_CUSTOM_FIELDS.owner_agency]: agency.agency_name || '' }
    } else {
      const { data: hh } = await db
        .from('households')
        .select('id, primary_name, do_not_contact, ghl_contact_id, ghl_opportunity_id')
        .eq('id', entity_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!hh) return NextResponse.json({ error: 'Household not found' }, { status: 404 })
      if (hh.do_not_contact) {
        return NextResponse.json({ error: 'Household is marked do-not-contact; not synced.', reason: 'do_not_contact' }, { status: 409 })
      }
      const { data: member } = await db
        .from('household_members')
        .select('full_name, email, phone')
        .eq('household_id', entity_id)
        .is('deleted_at', null)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      const nm = splitName(hh.primary_name)
      displayName = hh.primary_name || member?.full_name || 'Household'
      contact = { firstName: nm.firstName, lastName: nm.lastName, email: member?.email ?? null, phone: member?.phone ?? null }
      pipeline = v.data.pipeline ?? 'prospect_client'
      existingContactId = hh.ghl_contact_id ?? null
      existingOppId = hh.ghl_opportunity_id ?? null
      customFields = { [GHL_CUSTOM_FIELDS.contact_type]: 'prospect_client' }
    }

    const stage = v.data.stage ?? 1
    const tags = v.data.tags

    // 1. Upsert the contact (transient-failure retry).
    const up = await upsertContactWithRetry({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      source: entity_type === 'agency' ? 'fsos_agency' : 'fsos',
      tags,
      customFields,
    })
    if (!up.ok) {
      return NextResponse.json({ error: `GHL contact sync failed: ${up.error}`, step: 'upsertContact' }, { status: 502 })
    }
    const contactId = up.data?.contact?.id || existingContactId
    if (!contactId) {
      return NextResponse.json({ error: 'No GHL contact id returned.', step: 'upsertContact' }, { status: 502 })
    }

    // 2. Create the opportunity, or move the existing one to the requested stage.
    let opportunityId = existingOppId
    if (existingOppId) {
      const mv = await moveOpportunityStage(existingOppId, pipeline, stage)
      if (!mv.ok) return NextResponse.json({ error: `GHL stage move failed: ${mv.error}`, step: 'moveOpportunityStage' }, { status: 502 })
    } else {
      const opp = await createOpportunity({ contactId, pipelineKey: pipeline, stagePosition: stage, name: displayName })
      if (!opp.ok) return NextResponse.json({ error: `GHL opportunity create failed: ${opp.error}`, step: 'createOpportunity' }, { status: 502 })
      opportunityId = opp.data?.opportunity?.id || null
    }

    if (tags?.length) await addContactTags(contactId, tags)

    // 3. Store the ids back on the App B record + audit.
    await db
      .from(table)
      .update({ ghl_contact_id: contactId, ghl_opportunity_id: opportunityId, ghl_synced_at: new Date().toISOString() })
      .eq('id', entity_id)

    await db.from('activities').insert({
      entity_type: entity_type === 'agency' ? 'agency_partnership' : 'household',
      entity_id,
      kind: 'ghl_sync',
      note: `Synced to GoHighLevel (${pipeline}, stage ${stage}).`,
      actor,
    })
    await writeAudit({ actor, action: 'entity.updated', entity: entity_type === 'agency' ? 'agency_partnership' : 'household', entityId: entity_id, diff: { ghl_sync: true, pipeline, stage } })

    return NextResponse.json({ ok: true, ghl_contact_id: contactId, ghl_opportunity_id: opportunityId, pipeline, stage })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to sync to GoHighLevel' }, { status: 500 })
  }
}
