// Social scheduling service (ADR-026, Slice 3). Queues an APPROVED version to a
// channel, with conflict detection, timezone capture, reschedule and cancel.
//
// Thin routes call these; getDb() is resolved inside each function. Audit is
// written by the route. The approval gate is enforced by the DB trigger from
// mig 063 AND re-checked here; only an APPROVED version may be scheduled.

import { getDb } from '@/lib/supabase/client'
import { hasScheduleConflict, canReschedule, canCancel, type SocialScheduleStatus } from './scheduling'

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid' | 'conflict' | 'error'; message: string }

export type ScheduleResult<T> = { ok: true; data: T; warnings: string[] } | { ok: false; kind: 'not_found' | 'invalid' | 'error'; message: string }

export interface ScheduleEntryRow {
  id: string
  version_id: string
  channel_id: string
  scheduled_at: string
  timezone: string
  status: SocialScheduleStatus
  attempts: number
  last_error: string | null
  next_attempt_at: string | null
  created_at: string
  updated_at: string
}

const ENTRY_COLUMNS =
  'id, version_id, channel_id, scheduled_at, timezone, status, attempts, last_error, next_attempt_at, created_at, updated_at'

// Deterministic idempotency key so re-submitting the same version→channel→time does
// not create a duplicate queue entry (unique index enforces it).
function idemKey(versionId: string, channelId: string, scheduledAtIso: string): string {
  return `sched:${versionId}:${channelId}:${scheduledAtIso}`
}

export async function listQueue(filters?: {
  status?: SocialScheduleStatus
  channelId?: string
}): Promise<StoreResult<ScheduleEntryRow[]>> {
  let q = getDb()
    .from('social_schedule_entries')
    .select(ENTRY_COLUMNS)
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: true })
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.channelId) q = q.eq('channel_id', filters.channelId)
  const { data, error } = await q
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as ScheduleEntryRow[] }
}

export async function listCalendar(rangeStartIso: string, rangeEndIso: string): Promise<StoreResult<ScheduleEntryRow[]>> {
  const { data, error } = await getDb()
    .from('social_schedule_entries')
    .select(ENTRY_COLUMNS)
    .is('deleted_at', null)
    .gte('scheduled_at', rangeStartIso)
    .lte('scheduled_at', rangeEndIso)
    .order('scheduled_at', { ascending: true })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as ScheduleEntryRow[] }
}

// Existing scheduled times for a channel (pending/publishing) — for conflict checks.
async function channelScheduledTimes(channelId: string, excludeId?: string): Promise<number[]> {
  let q = getDb()
    .from('social_schedule_entries')
    .select('id, scheduled_at')
    .eq('channel_id', channelId)
    .in('status', ['pending', 'publishing'])
    .is('deleted_at', null)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  return (data ?? []).map((r: { scheduled_at: string }) => Date.parse(r.scheduled_at)).filter((n) => Number.isFinite(n))
}

export async function scheduleVersion(
  input: { versionId: string; channelId: string; scheduledAt: string; timezone?: string },
  actor: string,
): Promise<ScheduleResult<ScheduleEntryRow>> {
  const db = getDb()

  // Approval gate (service half; the DB trigger is the other half).
  const { data: version, error: vErr } = await db
    .from('social_content_versions')
    .select('id, content_id, status')
    .eq('id', input.versionId)
    .maybeSingle()
  if (vErr) return { ok: false, kind: 'error', message: vErr.message }
  if (!version) return { ok: false, kind: 'not_found', message: 'Version not found' }
  if (version.status !== 'APPROVED') {
    return { ok: false, kind: 'invalid', message: `Only an APPROVED version may be scheduled (version is ${version.status})` }
  }

  // Channel must exist.
  const { data: channel, error: cErr } = await db
    .from('social_channels')
    .select('id, status')
    .eq('id', input.channelId)
    .is('deleted_at', null)
    .maybeSingle()
  if (cErr) return { ok: false, kind: 'error', message: cErr.message }
  if (!channel) return { ok: false, kind: 'not_found', message: 'Channel not found' }

  const scheduledMs = Date.parse(input.scheduledAt)
  if (!Number.isFinite(scheduledMs)) return { ok: false, kind: 'invalid', message: 'Invalid scheduled time' }

  // Conflict detection is a WARNING (§0.B) — surfaced, not blocking. Connecting the
  // account before the publish time is the other advisory.
  const warnings: string[] = []
  const existing = await channelScheduledTimes(input.channelId)
  if (hasScheduleConflict(existing, scheduledMs)) {
    warnings.push('Another post is scheduled to this account close to this time.')
  }
  if (channel.status !== 'connected') {
    warnings.push('This account is not connected yet — publishing will hold until it is connected.')
  }

  const scheduledIso = new Date(scheduledMs).toISOString()
  const { data, error } = await db
    .from('social_schedule_entries')
    .insert({
      version_id: input.versionId,
      channel_id: input.channelId,
      scheduled_at: scheduledIso,
      timezone: input.timezone || 'America/Chicago',
      status: 'pending',
      idempotency_key: idemKey(input.versionId, input.channelId, scheduledIso),
      created_by: actor,
      updated_by: actor,
    })
    .select(ENTRY_COLUMNS)
    .maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, kind: 'invalid', message: 'This version is already scheduled to that account at that time.' }
    }
    return { ok: false, kind: 'error', message: error.message }
  }

  // Advance the content to SCHEDULED (best-effort; content-level status).
  await db.from('social_content').update({ status: 'SCHEDULED', updated_by: actor }).eq('id', version.content_id)

  return { ok: true, data: data as ScheduleEntryRow, warnings }
}

export async function rescheduleEntry(
  id: string,
  scheduledAt: string,
  actor: string,
): Promise<StoreResult<ScheduleEntryRow>> {
  const db = getDb()
  const { data: entry, error: e1 } = await db
    .from('social_schedule_entries')
    .select('id, channel_id, status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (e1) return { ok: false, kind: 'error', message: e1.message }
  if (!entry) return { ok: false, kind: 'not_found', message: 'Schedule entry not found' }
  if (!canReschedule(entry.status as SocialScheduleStatus)) {
    return { ok: false, kind: 'invalid', message: `Cannot reschedule an entry that is ${entry.status}` }
  }
  const ms = Date.parse(scheduledAt)
  if (!Number.isFinite(ms)) return { ok: false, kind: 'invalid', message: 'Invalid scheduled time' }

  const { data, error } = await db
    .from('social_schedule_entries')
    .update({ scheduled_at: new Date(ms).toISOString(), status: 'pending', next_attempt_at: null, updated_by: actor })
    .eq('id', id)
    .select(ENTRY_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as ScheduleEntryRow }
}

export async function cancelEntry(id: string, actor: string): Promise<StoreResult<{ id: string }>> {
  const db = getDb()
  const { data: entry, error: e1 } = await db
    .from('social_schedule_entries')
    .select('id, status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (e1) return { ok: false, kind: 'error', message: e1.message }
  if (!entry) return { ok: false, kind: 'not_found', message: 'Schedule entry not found' }
  if (!canCancel(entry.status as SocialScheduleStatus)) {
    return { ok: false, kind: 'invalid', message: `Cannot cancel an entry that is ${entry.status}` }
  }
  const { data, error } = await db
    .from('social_schedule_entries')
    .update({ status: 'cancelled', updated_by: actor })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: { id: (data as { id: string }).id } }
}
