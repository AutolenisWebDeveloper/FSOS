// Social engagement service (ADR-026, Slice 5). Ingests inbound engagement,
// resolves the author to an EXISTING contact (never a duplicate), and creates
// follow-up tasks / opportunities through the existing CRM tables.
//
// Ingestion is fed by an adapter's read-engagement capability where the platform
// API allows; with no connected/credentialed account there is nothing to ingest
// (the adapters report not_configured), so this stays inert until access is obtained.

import { getDb } from '@/lib/supabase/client'
import {
  classifyEngagement,
  routeFor,
  matchContact,
  type ContactCandidate,
  type ResolutionStatus,
} from './triage'
import type { SocialPlatform } from './adapters'

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid' | 'error'; message: string }

export interface EngagementRow {
  id: string
  channel_id: string | null
  platform: SocialPlatform
  post_ref: string | null
  engagement_type: string
  author_handle: string | null
  author_platform_id: string | null
  body: string | null
  received_at: string
  resolved_contact_id: string | null
  resolution_status: ResolutionStatus
  classification: string | null
  route: string | null
  matched_by: string | null
  linked_task_id: string | null
  linked_opportunity_id: string | null
}

const COLUMNS =
  'id, channel_id, platform, post_ref, engagement_type, author_handle, author_platform_id, body, ' +
  'received_at, resolved_contact_id, resolution_status, classification, route, matched_by, ' +
  'linked_task_id, linked_opportunity_id'

export interface IngestRecord {
  channelId: string | null
  platform: SocialPlatform
  postRef?: string | null
  engagementType: 'comment' | 'mention' | 'reaction' | 'message'
  authorHandle?: string | null
  authorPlatformId?: string | null
  authorEmail?: string | null
  authorPhone?: string | null
  body?: string | null
  receivedAt?: string
}

export async function listEngagement(filter?: {
  status?: ResolutionStatus
}): Promise<StoreResult<EngagementRow[]>> {
  let q = getDb().from('social_engagement').select(COLUMNS).order('received_at', { ascending: false }).limit(200)
  if (filter?.status) q = q.eq('resolution_status', filter.status)
  const { data, error } = await q
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as unknown as EngagementRow[] }
}

// Ingest engagement records. Each is classified + routed, and the author is matched
// to an EXISTING contact (by email/phone) where possible — NEVER creating a contact.
// Unmatched authors default to the review queue.
export async function ingestEngagement(records: IngestRecord[], actor: string): Promise<StoreResult<{ inserted: number; matched: number }>> {
  const db = getDb()
  let inserted = 0
  let matched = 0

  for (const r of records) {
    const classification = classifyEngagement(r.body)
    const route = routeFor(classification)

    // Attempt to resolve the author to an EXISTING contact.
    let resolvedContactId: string | null = null
    let matchedBy: string | null = null
    if (r.authorEmail || r.authorPhone) {
      const email = (r.authorEmail ?? '').trim().toLowerCase()
      const phone = (r.authorPhone ?? '').replace(/\D/g, '')
      let cq = db.from('contacts').select('id, email_lc, phone_digits').is('deleted_at', null).limit(25)
      if (email && phone) cq = cq.or(`email_lc.eq.${email},phone_digits.eq.${phone}`)
      else if (email) cq = cq.eq('email_lc', email)
      else cq = cq.eq('phone_digits', phone)
      const { data: candidates } = await cq
      const hit = matchContact({ email: r.authorEmail, phone: r.authorPhone }, (candidates ?? []) as ContactCandidate[])
      if (hit) {
        resolvedContactId = hit.contactId
        matchedBy = hit.matchedBy
        matched++
      }
    }

    const { error } = await db.from('social_engagement').insert({
      channel_id: r.channelId,
      platform: r.platform,
      post_ref: r.postRef ?? null,
      engagement_type: r.engagementType,
      author_handle: r.authorHandle ?? null,
      author_platform_id: r.authorPlatformId ?? null,
      body: r.body ?? null,
      received_at: r.receivedAt ?? new Date().toISOString(),
      resolved_contact_id: resolvedContactId,
      resolution_status: resolvedContactId ? 'matched' : 'unmatched',
      classification,
      route,
      matched_by: matchedBy,
    })
    if (!error) inserted++
  }

  return { ok: true, data: { inserted, matched } }
}

// Manually link an engagement to an EXISTING contact (review-queue triage).
export async function linkEngagementToContact(
  id: string,
  contactId: string,
  actor: string,
): Promise<StoreResult<EngagementRow>> {
  const db = getDb()
  // The contact must already exist — never create one here.
  const { data: contact, error: cErr } = await db.from('contacts').select('id').eq('id', contactId).is('deleted_at', null).maybeSingle()
  if (cErr) return { ok: false, kind: 'error', message: cErr.message }
  if (!contact) return { ok: false, kind: 'not_found', message: 'Contact not found' }

  const { data, error } = await db
    .from('social_engagement')
    .update({ resolved_contact_id: contactId, resolution_status: 'matched', matched_by: 'manual' })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Engagement not found' }
  return { ok: true, data: data as unknown as EngagementRow }
}

export async function dismissEngagement(id: string, actor: string): Promise<StoreResult<{ id: string }>> {
  const { data, error } = await getDb()
    .from('social_engagement')
    .update({ resolution_status: 'dismissed' })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Engagement not found' }
  return { ok: true, data: { id: (data as { id: string }).id } }
}

// Create a follow-up task from an engagement (existing work_tasks table).
export async function createTaskFromEngagement(
  id: string,
  input: { title: string; dueAt?: string },
  actor: string,
): Promise<StoreResult<{ taskId: string }>> {
  const db = getDb()
  const { data: eng, error: eErr } = await db.from('social_engagement').select('id').eq('id', id).maybeSingle()
  if (eErr) return { ok: false, kind: 'error', message: eErr.message }
  if (!eng) return { ok: false, kind: 'not_found', message: 'Engagement not found' }

  const { data: task, error: tErr } = await db
    .from('work_tasks')
    .insert({ title: input.title, entity_type: 'social_engagement', entity_id: id, source: 'manual', due_at: input.dueAt ?? null })
    .select('id')
    .maybeSingle()
  if (tErr) return { ok: false, kind: 'error', message: tErr.message }
  const taskId = (task as { id: string }).id

  await db.from('social_engagement').update({ linked_task_id: taskId, resolution_status: 'triaged' }).eq('id', id)
  return { ok: true, data: { taskId } }
}

// Create an opportunity from an engagement (existing opportunities table). Requires
// the engagement to be resolved to a contact; the opportunity attaches to that
// contact's household where one exists. Never securities (content firewall).
export async function createOpportunityFromEngagement(id: string, actor: string): Promise<StoreResult<{ opportunityId: string }>> {
  const db = getDb()
  const { data: eng, error: eErr } = await db
    .from('social_engagement')
    .select('id, resolved_contact_id')
    .eq('id', id)
    .maybeSingle()
  if (eErr) return { ok: false, kind: 'error', message: eErr.message }
  if (!eng) return { ok: false, kind: 'not_found', message: 'Engagement not found' }
  if (!eng.resolved_contact_id) {
    return { ok: false, kind: 'invalid', message: 'Resolve the engagement to a contact before creating an opportunity.' }
  }

  const { data: contact } = await db.from('contacts').select('id, household_id, owner_scope').eq('id', eng.resolved_contact_id).maybeSingle()

  const { data: opp, error: oErr } = await db
    .from('opportunities')
    .insert({
      household_id: (contact as { household_id?: string | null } | null)?.household_id ?? null,
      engagement: 'warm_handoff',
      stage: 'prospect',
      is_security: false,
      owner_scope: (contact as { owner_scope?: string | null } | null)?.owner_scope ?? null,
    })
    .select('id')
    .maybeSingle()
  if (oErr) return { ok: false, kind: 'error', message: oErr.message }
  const opportunityId = (opp as { id: string }).id

  await db.from('social_engagement').update({ linked_opportunity_id: opportunityId, resolution_status: 'triaged' }).eq('id', id)
  return { ok: true, data: { opportunityId } }
}
