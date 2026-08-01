// src/lib/life-campaign/inbound.ts
// Appointment-driven exit for the Life Conversion Campaign (§4b yield-to-advisor). When a client
// books an appointment through the native scheduler, the automated conversion cadence must stop:
// the client has engaged and the advisor now owns the relationship. This mirrors the reference
// Cross-Sell engine's exitOnAppointment (spec §11 "Appointment Booked" outcome) so all campaigns
// behave consistently at the booking seam. Called best-effort from the booking service — a failure
// here never fails the booking (the appointment already exists).
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'

const SYSTEM = 'agent:marketing_automation'

// Live states from which a booking should exit the enrollment (anything still receiving or holding
// the cadence). Terminal states (completed/exited/suppressed) are left untouched.
const LIVE_STATES = ['active', 'paused_by_admin', 'paused_for_conversation'] as const

/**
 * Exit every live Life Conversion enrollment for this household (optionally narrowed to a member)
 * with exit_reason='appointment_booked'. Returns how many enrollments were exited. Idempotent: a
 * second booking finds no live enrollment and exits nothing.
 */
export async function exitOnAppointment(input: {
  householdId: string
  memberId?: string
  actor?: string
}): Promise<{ exited: number }> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  let q = db
    .from('life_campaign_enrollments')
    .update({ status: 'exited', exit_reason: 'appointment_booked', completed_at: nowISO, updated_at: nowISO })
    .eq('household_id', input.householdId)
    .in('status', LIVE_STATES as unknown as string[])
  if (input.memberId) q = q.eq('member_id', input.memberId)

  const { data } = await q.select('id')
  const exited = data ?? []
  // Audit each exited enrollment individually so the trail is attributable to the affected record.
  for (const r of exited) {
    await writeAudit({
      actor: input.actor ?? SYSTEM,
      action: 'entity.updated',
      entity: 'life_campaign_enrollment',
      entityId: r.id as string,
      diff: { exit_reason: 'appointment_booked', by: input.actor ?? 'booking' },
    })
  }
  return { exited: exited.length }
}
