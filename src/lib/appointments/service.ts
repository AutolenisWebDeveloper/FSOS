// src/lib/appointments/service.ts
// Impure appointment lifecycle + no-show recovery service. Delegates the state-machine,
// overdue, funnel, and recovery-planning decisions to the PURE core
// (lib/appointments/recovery.ts) and persists on the existing `appointments` +
// `work_tasks` tables (reusing the additive appointments.opportunity_id, mig 048). No
// parallel scheduler, no fabricated calendar integration.
//
// Green-zone: advancing an appointment's status and creating an internal reschedule
// task is data assembly — it sends nothing. Any outreach that follows still flows
// through the workforce + the 7-step gate.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
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

  const upd = await db.from('appointments').update(patch).eq('id', appointmentId).select('id').maybeSingle()
  if (upd.error) return { error: upd.error.message }

  await writeAudit({
    actor,
    action: 'stage.changed',
    entity: 'appointment',
    entityId: appointmentId,
    diff: { from, to: toStatus, note: opts.note ?? null },
  })

  return { ok: true, id: appointmentId, from, to: toStatus }
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
