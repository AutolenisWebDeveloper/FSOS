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
  // CodeRabbit review of R2: every matching row is read (paged), never the first 50 — a booking on
  // a later contact would otherwise read as "no appointment" and prospecting would continue.
  const householdContacts = await allRows<{ id: string }>((from, to) =>
    db.from('contacts').select('id').eq('household_id', householdId).is('deleted_at', null).order('id', { ascending: true }).range(from, to),
  )
  if (householdContacts === null) return 'unknown'
  const ids = new Set(householdContacts.map((c) => c.id))
  // Follow-up R2: a public booking's contact is often not linked to the household — it matches a
  // MEMBER by email or phone. Count those contacts too, so a booking by any member stops prospecting.
  const members = await allRows<{ email?: string | null; phone?: string | null }>((from, to) =>
    db.from('household_members').select('id, email, phone').eq('household_id', householdId).order('id', { ascending: true }).range(from, to),
  )
  if (members === null) return 'unknown'
  const emails = [...new Set(members.map((m) => (m.email ?? '').trim().toLowerCase()).filter(Boolean))]
  // phone_digits is digits-only as entered (normalize.ts), so match the 10-digit form and its +1 form.
  const tails = [...new Set(members.map((m) => (m.phone ?? '').replace(/\D/g, '').slice(-10)).filter((d) => d.length === 10))]
  const digits = tails.flatMap((d) => [d, `1${d}`])
  for (const [col, vals] of [['email_lc', emails], ['phone_digits', digits]] as const) {
    if (vals.length === 0) continue
    const byAddr = await allRows<{ id: string }>((from, to) =>
      db.from('contacts').select('id').in(col, vals).is('deleted_at', null).order('id', { ascending: true }).range(from, to),
    )
    if (byAddr === null) return 'unknown'
    for (const c of byAddr) ids.add(c.id)
  }
  if (ids.size === 0) return 'no'
  const all = [...ids]
  for (let i = 0; i < all.length; i += ID_CHUNK) {
    const viaContact = await db
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('contact_id', all.slice(i, i + ID_CHUNK))
      .eq('status', 'scheduled')
      .or(upcoming)
    if (viaContact.error) return 'unknown'
    if ((viaContact.count ?? 0) > 0) return 'yes'
  }
  return 'no'
}

const PAGE = 500
const ID_CHUNK = 200

/** Every row of a paged query (stable order required), or null on any read error. */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[] | null> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}
