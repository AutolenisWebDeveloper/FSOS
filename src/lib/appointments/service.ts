// src/lib/appointments/service.ts
// Impure appointment lifecycle + no-show recovery service. Delegates the state-machine,
// overdue, funnel, and recovery-planning decisions to the PURE core
// (lib/appointments/recovery.ts) and persists on the existing `appointments` +
// `work_tasks` tables (reusing the additive appointments.opportunity_id, mig 048). No
// parallel scheduler, no fabricated calendar integration.
//
// Green-zone: advancing an appointment's status and creating an internal reschedule
// task is data assembly. A terminal transition (no_show / completed) additionally fires the
// corresponding client-facing lifecycle notice (no-show follow-up / recap) — best-effort, fire-once
// via the booking ledger, and routed through the SAME 7-step gate as every other send.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendAppointmentNotice } from '@/lib/booking/notify'
import {
  canTransition,
  planNoShowRecovery,
  type Appointment,
  type AppointmentStatus,
} from './recovery'

export interface SetStatusResult {
  ok: true
  id: string
  from: string
  to: AppointmentStatus
}

/**
 * Transition an appointment to a new lifecycle status (completed / cancelled / no_show,
 * or reschedule back to scheduled). Validates the transition against the pure state
 * machine and audits it. Optionally links the originating opportunity.
 */
export async function setAppointmentStatus(
  actor: string,
  appointmentId: string,
  toStatus: AppointmentStatus,
  opts: { opportunityId?: string; note?: string } = {},
): Promise<SetStatusResult | { error: string; reason?: string; status?: number }> {
  const db = getDb()

  const current = await db
    .from('appointments')
    .select('id, status, household_id, opportunity_id')
    .eq('id', appointmentId)
    .maybeSingle()
  if (current.error) return { error: current.error.message }
  if (!current.data) return { error: 'Appointment not found', status: 404 }

  const from = current.data.status as string
  if (!canTransition(from, toStatus)) {
    return { error: `Cannot move an appointment from ${from} to ${toStatus}.`, reason: 'invalid_transition', status: 409 }
  }

  const patch: Record<string, unknown> = { status: toStatus, updated_at: new Date().toISOString() }
  if (opts.opportunityId) patch.opportunity_id = opts.opportunityId

  // Atomic, conditional write (D1): guard the UPDATE on the SAME `from` status we validated the
  // transition against, closing the TOCTOU window between the SELECT above and this write. If a
  // concurrent action already moved the row (e.g. cancelled/completed between read and write), the
  // guarded update matches zero rows and we FAIL CLOSED with a 409 rather than applying a
  // transition that is no longer valid from the current state.
  const upd = await db
    .from('appointments')
    .update(patch)
    .eq('id', appointmentId)
    .eq('status', from)
    .select('id')
    .maybeSingle()
  if (upd.error) return { error: upd.error.message }
  if (!upd.data) {
    return {
      error: 'This appointment was just changed elsewhere. Please refresh and try again.',
      reason: 'stale_status',
      status: 409,
    }
  }

  await writeAudit({
    actor,
    action: 'stage.changed',
    entity: 'appointment',
    entityId: appointmentId,
    diff: { from, to: toStatus, note: opts.note ?? null },
  })

  // B-5 — fire the client-facing lifecycle notice on a terminal transition. A no-show gets a
  // "sorry we missed you / rebook" note; a completed appointment gets a recap thank-you; a
  // CANCELLED appointment gets the cancellation notice. Cancellation used to be missing here,
  // so an appointment the FSA cancelled from the app told the client NOTHING on either channel —
  // only the attendee's own self-service cancel notified anyone. Emitting it from this shared
  // mover covers every caller; the delivery ledger's fire-once claim means a caller that also
  // asks for the notice cannot produce a second one. Best-effort and routed through the SAME
  // gate + transactional fallback as every other booking notice — the status change has already
  // committed, so a deferred/blocked notice never fails this transition.
  const NOTICE_FOR_STATUS = {
    no_show: 'no_show_followup',
    completed: 'recap',
    cancelled: 'cancellation',
  } as const
  const notice = NOTICE_FOR_STATUS[toStatus as keyof typeof NOTICE_FOR_STATUS]
  if (notice) {
    try {
      await sendAppointmentNotice(appointmentId, notice, { actor })
    } catch {
      /* best-effort — the transition + audit above are the durable record */
    }
  }

  return { ok: true, id: appointmentId, from, to: toStatus }
}

/**
 * Add an internal note to an appointment. Writes BOTH an `activities` row
 * (kind='appointment_note' — the signal the command-center "Missing notes" KPI reads) AND an
 * `audit_log` row (so the note appears in the appointment's unified timeline, its text gated by
 * the viewer's reveal.bodies). Green-zone: an internal record, sends nothing.
 */
export async function addAppointmentNote(
  actor: string,
  appointmentId: string,
  note: string,
): Promise<{ ok: true; id: string } | { error: string; status?: number }> {
  const db = getDb()

  const current = await db.from('appointments').select('id').eq('id', appointmentId).maybeSingle()
  if (current.error) return { error: current.error.message }
  if (!current.data) return { error: 'Appointment not found', status: 404 }

  const ins = await db
    .from('activities')
    .insert({ entity_type: 'appointment', entity_id: appointmentId, kind: 'appointment_note', note, actor })
  if (ins.error) return { error: ins.error.message }

  await writeAudit({ actor, action: 'entity.updated', entity: 'appointment', entityId: appointmentId, diff: { event: 'note_added', note } })

  return { ok: true, id: appointmentId }
}

const FOLLOWUP_DEFAULT_DUE_DAYS = 3

/**
 * Create a single internal follow-up task for an appointment. Deduplicated against an existing
 * OPEN manual task for the same appointment (so a double-click doesn't pile up duplicates), which
 * also keeps the "Follow-ups due" KPI honest. Green-zone: an internal task, contacts no one.
 */
export async function createAppointmentFollowupTask(
  actor: string,
  appointmentId: string,
  opts: { title?: string; dueInDays?: number } = {},
): Promise<{ ok: true; id: string; deduped: boolean } | { error: string; status?: number }> {
  const db = getDb()

  const current = await db.from('appointments').select('id').eq('id', appointmentId).maybeSingle()
  if (current.error) return { error: current.error.message }
  if (!current.data) return { error: 'Appointment not found', status: 404 }

  // Dedup: an OPEN manual task already covering this appointment is returned instead of a second.
  const existing = await db
    .from('work_tasks')
    .select('id')
    .eq('entity_type', 'appointment')
    .eq('entity_id', appointmentId)
    .eq('source', 'manual')
    .eq('completed', false)
    .limit(1)
    .maybeSingle()
  if (existing.error) return { error: existing.error.message }
  if (existing.data) return { ok: true, id: existing.data.id as string, deduped: true }

  const days = Math.min(Math.max(1, Math.round(opts.dueInDays ?? FOLLOWUP_DEFAULT_DUE_DAYS)), 365)
  const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const title = opts.title?.trim() || 'Appointment follow-up'

  const insertRes = await db
    .from('work_tasks')
    .insert({ title, entity_type: 'appointment', entity_id: appointmentId, source: 'manual', due_at: due, owner_scope: actor })
    .select('id')
    .maybeSingle()
  if (insertRes.error) return { error: insertRes.error.message }
  if (!insertRes.data) return { error: 'Could not create the follow-up task' }

  await writeAudit({
    actor,
    action: 'entity.created',
    entity: 'appointment',
    entityId: appointmentId,
    diff: { event: 'task_created', task_id: insertRes.data.id, title, due_at: due },
  })

  return { ok: true, id: insertRes.data.id as string, deduped: false }
}

export interface RecoveryResult {
  created: number
  skippedAlreadyRecovered: number
  createdTaskIds: string[]
  note: string
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
const RECOVERY_DUE_DAYS = 2

/**
 * Sweep no-show appointments and create one internal reschedule follow-up task per
 * un-recovered no-show. Deduplicated against no-shows that already carry an open
 * agent-created appointment task. Green-zone: creates internal tasks only, sends nothing.
 */
export async function runNoShowRecovery(
  actor: string,
  opts: { limit?: number } = {},
): Promise<RecoveryResult | { error: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const db = getDb()

  const noShowRes = await db
    .from('appointments')
    .select('id, household_id, opportunity_id, scheduled_at, status')
    .eq('status', 'no_show')
    .order('scheduled_at', { ascending: false })
    .limit(limit)
  if (noShowRes.error) return { error: noShowRes.error.message }
  const noShows = (noShowRes.data ?? []) as Appointment[]
  if (noShows.length === 0) {
    return { created: 0, skippedAlreadyRecovered: 0, createdTaskIds: [], note: 'No no-show appointments to recover.' }
  }

  // Existing OPEN agent recovery tasks for these appointments (dedup key).
  const ids = noShows.map((a) => a.id)
  const tasksRes = await db
    .from('work_tasks')
    .select('entity_id')
    .eq('entity_type', 'appointment')
    .eq('source', 'agent')
    .eq('completed', false)
    .in('entity_id', ids)
  if (tasksRes.error) return { error: tasksRes.error.message }
  const already = (tasksRes.data ?? []).map((r) => r.entity_id as string)

  const { drafts, skipped } = planNoShowRecovery(noShows, already)
  const skippedAlreadyRecovered = skipped.filter((s) => s.reason === 'already_recovered').length

  if (drafts.length === 0) {
    return {
      created: 0,
      skippedAlreadyRecovered,
      createdTaskIds: [],
      note: `No new recovery tasks — ${skippedAlreadyRecovered} already have one.`,
    }
  }

  const due = new Date(Date.now() + RECOVERY_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const rows = drafts.map((d) => ({
    title: 'Reschedule follow-up — missed appointment (no-show)',
    entity_type: 'appointment',
    entity_id: d.appointment_id,
    source: 'agent' as const,
    due_at: due,
    owner_scope: actor,
  }))

  const insertRes = await db.from('work_tasks').insert(rows).select('id, entity_id')
  if (insertRes.error) return { error: insertRes.error.message }
  const inserted = (insertRes.data ?? []) as { id: string; entity_id: string }[]

  // A logged activity per recovered appointment + a summary audit.
  await Promise.all(
    drafts.map((d) =>
      db.from('activities').insert({
        entity_type: 'appointment',
        entity_id: d.appointment_id,
        kind: 'appointment_recovery',
        note: d.reason,
        actor,
      }),
    ),
  )
  await writeAudit({
    actor,
    action: 'ai.action',
    entity: 'appointment_recovery',
    diff: { created: inserted.length, skippedAlreadyRecovered },
  })

  return {
    created: inserted.length,
    skippedAlreadyRecovered,
    createdTaskIds: inserted.map((t) => t.id),
    note: `${inserted.length} no-show recovery task${inserted.length === 1 ? '' : 's'} created.`,
  }
}
