// src/lib/pipeline-winback/inbound.ts
// Appointment-driven exit for the Pipeline Win-Back Campaign (ADR-031). When a client books a
// review through the native scheduler, the win-back cadence must stop: the client has engaged
// and the advisor now owns the relationship (advisor-ownership precedence, ADR-031 §4).
//
// WHY THIS FILE EXISTS. Cross-Sell Life and Life Conversion both had this seam and Win-Back did
// not, so `booking/book.ts` exited two of the three campaigns on a booking. A stalled-pipeline
// contact who booked a review kept receiving re-engagement touches — the one gap in this area a
// client would actually notice. The exit primitive already existed (`removeEnrollment` in
// enroll.ts) with zero callers; this wires the booking seam to it in the shape the other two
// campaigns already use, rather than inventing a third pattern (§6).
//
// Called best-effort from the booking service: a failure here never fails the booking, because
// the appointment already exists by then.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'

const SYSTEM = 'agent:marketing_automation'

// Live states a booking should exit — anything still receiving or holding the cadence.
// Terminal states (completed/exited/suppressed) are left untouched, which is what makes a
// second booking a no-op rather than a duplicate exit.
const LIVE_STATES = ['active', 'paused_by_admin', 'paused_for_conversation'] as const

/**
 * Exit every live Pipeline Win-Back enrollment for this household (optionally narrowed to a
 * member) with `exit_reason='appointment_booked'`. Returns how many were exited. Idempotent: a
 * second booking finds no live enrollment and exits nothing.
 *
 * Mirrors life-campaign/inbound.ts exactly — same signature, same states, same exit reason —
 * so all three campaigns behave identically at the booking seam.
 */
export async function exitOnAppointment(input: {
  householdId: string
  memberId?: string
  actor?: string
}): Promise<{ exited: number }> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  let q = db
    .from('pipeline_winback_enrollments')
    .update({ status: 'exited', exit_reason: 'appointment_booked', completed_at: nowISO, updated_at: nowISO })
    .eq('household_id', input.householdId)
    .in('status', LIVE_STATES as unknown as string[])
  if (input.memberId) q = q.eq('member_id', input.memberId)

  const { data } = await q.select('id')
  const exited = data ?? []
  // Audit each exited enrollment individually so the trail is attributable to the affected
  // record rather than to the household.
  for (const r of exited) {
    await writeAudit({
      actor: input.actor ?? SYSTEM,
      action: 'entity.updated',
      entity: 'pipeline_winback_enrollment',
      entityId: r.id as string,
      diff: { exit_reason: 'appointment_booked', by: input.actor ?? 'booking' },
    })
  }
  return { exited: exited.length }
}
