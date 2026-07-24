// Social content lifecycle service (ADR-026, Slice 2).
//
// The heart of "AI drafts → human approves → immutable version". social_content
// holds the CURRENT editable fields + status; social_content_versions are IMMUTABLE
// frozen snapshots. Approving freezes a version (status APPROVED, snapshot frozen by
// the mig-063 trigger); editing an approved item supersedes it and re-drafts. Only an
// APPROVED version may be scheduled/published (enforced in the service AND the DB).
//
// Thin routes call these; getDb() resolves INSIDE each function; audit is written by
// the route (single writeAudit path). The AI never approves or publishes — only a
// human transitions IN_REVIEW → APPROVED.

import { getDb } from '@/lib/supabase/client'
import { canTransitionContent, type SocialContentStatus } from './status'
import type { ContentDraft } from './schema'

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid' | 'invalid_transition' | 'error'; message: string }

export interface ContentRow {
  id: string
  title: string | null
  body: string
  content_type: string
  platforms: string[]
  media: unknown[]
  link: string | null
  campaign_tag: string | null
  topic_tag: string | null
  author_kind: string
  status: SocialContentStatus
  current_version_id: string | null
  household_id: string | null
  is_security: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface VersionRow {
  id: string
  content_id: string
  version_no: number
  status: 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'SUPERSEDED'
  snapshot: Record<string, unknown>
  created_by: string | null
  created_at: string
}

const CONTENT_COLUMNS =
  'id, title, body, content_type, platforms, media, link, campaign_tag, topic_tag, ' +
  'author_kind, status, current_version_id, household_id, is_security, created_by, updated_by, created_at, updated_at'

const VERSION_COLUMNS = 'id, content_id, version_no, status, snapshot, created_by, created_at'

// Freeze the editable fields into an immutable snapshot payload.
function snapshotOf(row: ContentRow): Record<string, unknown> {
  return {
    title: row.title,
    body: row.body,
    content_type: row.content_type,
    platforms: row.platforms,
    media: row.media,
    link: row.link,
    campaign_tag: row.campaign_tag,
    topic_tag: row.topic_tag,
    is_security: row.is_security,
  }
}

export async function listContent(filters?: {
  status?: SocialContentStatus
}): Promise<StoreResult<ContentRow[]>> {
  let q = getDb().from('social_content').select(CONTENT_COLUMNS).is('deleted_at', null)
  if (filters?.status) q = q.eq('status', filters.status)
  const { data, error } = await q.order('updated_at', { ascending: false })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: (data ?? []) as unknown as ContentRow[] }
}

export async function getContent(id: string): Promise<StoreResult<ContentRow>> {
  const { data, error } = await getDb()
    .from('social_content')
    .select(CONTENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Content not found' }
  return { ok: true, data: data as unknown as ContentRow }
}

export async function listVersions(contentId: string): Promise<StoreResult<VersionRow[]>> {
  const { data, error } = await getDb()
    .from('social_content_versions')
    .select(VERSION_COLUMNS)
    .eq('content_id', contentId)
    .order('version_no', { ascending: false })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: (data ?? []) as unknown as VersionRow[] }
}

export async function createDraft(
  input: ContentDraft,
  opts: { actor: string; authorKind?: 'human' | 'ai'; isSecurity?: boolean },
): Promise<StoreResult<ContentRow>> {
  const { data, error } = await getDb()
    .from('social_content')
    .insert({
      title: input.title ?? null,
      body: input.body,
      content_type: input.content_type,
      platforms: input.platforms,
      media: input.media ?? [],
      link: input.link ?? null,
      campaign_tag: input.campaign_tag ?? null,
      topic_tag: input.topic_tag ?? null,
      household_id: input.household_id ?? null,
      author_kind: opts.authorKind ?? 'human',
      is_security: opts.isSecurity ?? false,
      status: 'DRAFT',
      created_by: opts.actor,
      updated_by: opts.actor,
    })
    .select(CONTENT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'error', message: 'Failed to create draft' }
  return { ok: true, data: data as unknown as ContentRow }
}

// Editing is only allowed while DRAFT. To edit an APPROVED item, call reopenForEdit
// first (which supersedes the approved version and returns to DRAFT).
export async function updateDraft(
  id: string,
  input: Partial<ContentDraft>,
  actor: string,
): Promise<StoreResult<ContentRow>> {
  const current = await getContent(id)
  if (!current.ok) return current
  if (current.data.status !== 'DRAFT') {
    return { ok: false, kind: 'invalid_transition', message: 'Only a DRAFT can be edited; reopen the item first' }
  }
  const patch: Record<string, unknown> = { updated_by: actor }
  for (const k of ['title', 'body', 'content_type', 'platforms', 'media', 'link', 'campaign_tag', 'topic_tag'] as const) {
    if (input[k] !== undefined) patch[k] = input[k]
  }
  const { data, error } = await getDb()
    .from('social_content')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select(CONTENT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Content not found' }
  return { ok: true, data: data as unknown as ContentRow }
}

// Freeze the current draft into an immutable IN_REVIEW version and move the item to
// IN_REVIEW. The frozen snapshot is exactly what a reviewer approves.
export async function submitForReview(id: string, actor: string): Promise<StoreResult<VersionRow>> {
  const current = await getContent(id)
  if (!current.ok) return current
  if (!canTransitionContent(current.data.status, 'IN_REVIEW')) {
    return { ok: false, kind: 'invalid_transition', message: `Cannot submit from ${current.data.status}` }
  }
  const db = getDb()
  const versions = await listVersions(id)
  if (!versions.ok) return versions
  const nextNo = (versions.data[0]?.version_no ?? 0) + 1

  const { data: version, error: vErr } = await db
    .from('social_content_versions')
    .insert({
      content_id: id,
      version_no: nextNo,
      status: 'IN_REVIEW',
      snapshot: snapshotOf(current.data),
      created_by: actor,
    })
    .select(VERSION_COLUMNS)
    .maybeSingle()
  if (vErr) return { ok: false, kind: 'error', message: vErr.message }
  if (!version) return { ok: false, kind: 'error', message: 'Failed to freeze version' }

  const { error: cErr } = await db
    .from('social_content')
    .update({ status: 'IN_REVIEW', current_version_id: (version as VersionRow).id, updated_by: actor })
    .eq('id', id)
  if (cErr) return { ok: false, kind: 'error', message: cErr.message }
  return { ok: true, data: version as unknown as VersionRow }
}

// Human approval — the only path that freezes a version as APPROVED. The AI can
// never call this (route authorization is human-only).
export async function approve(
  id: string,
  versionId: string,
  approver: string,
  notes?: string,
): Promise<StoreResult<ContentRow>> {
  const current = await getContent(id)
  if (!current.ok) return current
  if (current.data.status !== 'IN_REVIEW') {
    return { ok: false, kind: 'invalid_transition', message: 'Only content IN_REVIEW can be approved' }
  }
  const db = getDb()
  // The version's snapshot is immutable; only its status changes to APPROVED.
  const { error: vErr } = await db
    .from('social_content_versions')
    .update({ status: 'APPROVED' })
    .eq('id', versionId)
    .eq('content_id', id)
    .eq('status', 'IN_REVIEW')
  if (vErr) return { ok: false, kind: 'error', message: vErr.message }

  const { error: aErr } = await db
    .from('social_approvals')
    .insert({ content_id: id, version_id: versionId, decision: 'approved', approver, notes: notes ?? null })
  if (aErr) return { ok: false, kind: 'error', message: aErr.message }

  const { data, error } = await db
    .from('social_content')
    .update({ status: 'APPROVED', current_version_id: versionId, updated_by: approver })
    .eq('id', id)
    .select(CONTENT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as unknown as ContentRow }
}

// Reviewer decision that returns the item to the author. 'changes_requested' → DRAFT
// (revise); 'rejected' → ARCHIVED. The reviewed version is superseded either way.
export async function decline(
  id: string,
  versionId: string,
  decision: 'changes_requested' | 'rejected',
  approver: string,
  notes?: string,
): Promise<StoreResult<ContentRow>> {
  const current = await getContent(id)
  if (!current.ok) return current
  if (current.data.status !== 'IN_REVIEW') {
    return { ok: false, kind: 'invalid_transition', message: 'Only content IN_REVIEW can be declined' }
  }
  const nextStatus: SocialContentStatus = decision === 'rejected' ? 'ARCHIVED' : 'DRAFT'
  const db = getDb()
  await db.from('social_content_versions').update({ status: 'SUPERSEDED' }).eq('id', versionId).eq('content_id', id)
  const { error: aErr } = await db
    .from('social_approvals')
    .insert({ content_id: id, version_id: versionId, decision, approver, notes: notes ?? null })
  if (aErr) return { ok: false, kind: 'error', message: aErr.message }
  const { data, error } = await db
    .from('social_content')
    .update({ status: nextStatus, current_version_id: null, updated_by: approver })
    .eq('id', id)
    .select(CONTENT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as unknown as ContentRow }
}

// Reopen an APPROVED item for editing: supersede the approved version and return to
// DRAFT. A subsequent submit creates a NEW version — the approved snapshot is never
// mutated (audit-preserving).
export async function reopenForEdit(id: string, actor: string): Promise<StoreResult<ContentRow>> {
  const current = await getContent(id)
  if (!current.ok) return current
  if (current.data.status !== 'APPROVED') {
    return { ok: false, kind: 'invalid_transition', message: 'Only an APPROVED item can be reopened for edit' }
  }
  const db = getDb()
  if (current.data.current_version_id) {
    await db
      .from('social_content_versions')
      .update({ status: 'SUPERSEDED' })
      .eq('id', current.data.current_version_id)
      .eq('status', 'APPROVED')
  }
  const { data, error } = await db
    .from('social_content')
    .update({ status: 'DRAFT', current_version_id: null, updated_by: actor })
    .eq('id', id)
    .select(CONTENT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as unknown as ContentRow }
}
