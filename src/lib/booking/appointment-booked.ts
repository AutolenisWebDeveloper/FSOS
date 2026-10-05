// src/lib/booking/appointment-booked.ts
// ONE stand-down for "an appointment now exists for this household", called by EVERY path that
// creates one — the public scheduler (book.ts) AND FSA review scheduling (api/reviews). Before
// this, the exit was inline in book.ts only, so an FSA-scheduled review kept Life Conversion,
// Win-Back and Cross-Sell Life sending "book a review" touches to a client who was already
// booked (audit D-02 / I-02 / G-01).
//
// Also the shared READ the campaign rechecks use: native bookings carry contact_id with a NULL
// household_id, and review-created appointments carry scheduled_at with a NULL starts_at, so a
// lookup keyed on appointments.household_id + starts_at missed both (audit G-02).
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'

/**
 * Exit every live prospecting enrollment for the household and retire today's queued workforce
 * outreach for it. Best-effort and observable — never throws (the appointment already exists).
 */
export async function onAppointmentBooked(input: { householdId: string | null; actor: string; appointmentId?: string | null }): Promise<void> {
  if (!input.householdId) return
  const householdId = input.householdId
  try {
    const [xsell, life, winback] = await Promise.all([
      import('@/lib/cross-sell-life/inbound'),
      import('@/lib/life-campaign/inbound'),
      import('@/lib/pipeline-winback/inbound'),
    ])
    const results = await Promise.allSettled([
      exitAllCrossSell(xsell.exitOnAppointment, householdId, input.actor),
      life.exitOnAppointment({ householdId, actor: input.actor }),
      winback.exitOnAppointment({ householdId, actor: input.actor }),
    ])
    for (const r of results) {
      if (r.status === 'rejected') console.error('[booking] appointment stand-down failed', { householdId, error: String(r.reason) })
    }
    const nowISO = new Date().toISOString()
    await getDb()
      .from('outreach_queue')
      .update({ status: 'skipped', block_reason: 'appointment_booked', updated_at: nowISO })
      .eq('household_id', householdId)
      .eq('status', 'queued')
    await writeAudit({
      actor: input.actor,
      action: 'entity.updated',
      entity: 'household',
      entityId: householdId,
      diff: { appointment_booked: input.appointmentId ?? true, prospecting_stood_down: true },
    })
  } catch (err) {
    console.error('[booking] appointment stand-down threw', { householdId, error: err instanceof Error ? err.message : String(err) })
  }
}

/** Cross-Sell's exit closes ONE open enrollment per call (G-03) — repeat until none remains. */
async function exitAllCrossSell(
  exit: (i: { householdId: string; actor?: string }) => Promise<{ exited: boolean }>,
  householdId: string,
  actor: string,
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const r = await exit({ householdId, actor })
    if (!r.exited) return
  }
}

/**
 * Whether the household has an upcoming SCHEDULED appointment, counting native bookings linked
 * only through contact_id — by a contact on the household, or one matching a member's email or phone
 * (follow-up R2) — and review appointments that carry only scheduled_at. Fails CLOSED
 * (true) on a read error: the caller stops the touch rather than sending to a possibly-booked
 * client.
 */
export async function householdHasUpcomingAppointment(householdId: string, nowISO: string = new Date().toISOString()): Promise<boolean> {
  return (await upcomingAppointmentState(householdId, nowISO)) !== 'no'
}

/**
 * The same lookup, three-valued: 'unknown' when a read failed. A caller whose consequence is
 * TERMINAL (exiting an enrollment) defers on 'unknown' instead of exiting on a transient error.
 */
export async function upcomingAppointmentState(householdId: string, nowISO: string = new Date().toISOString()): Promise<'yes' | 'no' | 'unknown'> {
  const db = getDb()
  const upcoming = `starts_at.gt.${nowISO},scheduled_at.gt.${nowISO}`
  const direct = await db
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .eq('status', 'scheduled')
    .or(upcoming)
  if (direct.error) return 'unknown'
  if ((direct.count ?? 0) > 0) return 'yes'
  const contacts = await db.from('contacts').select('id').eq('household_id', householdId).is('deleted_at', null).limit(50)
  if (contacts.error) return 'unknown'
  const ids = new Set((contacts.data ?? []).map((c: { id: string }) => c.id))
  // Follow-up R2: a public booking's contact is often not linked to the household — it matches a
  // MEMBER by email or phone. Count those contacts too, so a booking by any member stops prospecting.
  const members = await db.from('household_members').select('email, phone').eq('household_id', householdId).limit(50)
  if (members.error) return 'unknown'
  const emails = [...new Set((members.data ?? []).map((m: { email?: string | null }) => (m.email ?? '').trim().toLowerCase()).filter(Boolean))]
  // phone_digits is digits-only as entered (normalize.ts), so match the 10-digit form and its +1 form.
  const tails = [...new Set((members.data ?? []).map((m: { phone?: string | null }) => (m.phone ?? '').replace(/\D/g, '').slice(-10)).filter((d) => d.length === 10))]
  const digits = tails.flatMap((d) => [d, `1${d}`])
  for (const [col, vals] of [['email_lc', emails], ['phone_digits', digits]] as const) {
    if (vals.length === 0) continue
    const byAddr = await db.from('contacts').select('id').in(col, vals).is('deleted_at', null).limit(50)
    if (byAddr.error) return 'unknown'
    for (const c of (byAddr.data ?? []) as { id: string }[]) ids.add(c.id)
  }
  if (ids.size === 0) return 'no'
  const viaContact = await db
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .in('contact_id', [...ids])
    .eq('status', 'scheduled')
    .or(upcoming)
  if (viaContact.error) return 'unknown'
  return (viaContact.count ?? 0) > 0 ? 'yes' : 'no'
}
