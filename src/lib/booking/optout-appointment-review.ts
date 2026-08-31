// src/lib/booking/optout-appointment-review.ts
// Raise a human review when an SMS opt-out arrives from someone who has an upcoming appointment.
//
// WHY. "CANCEL", "END" and "QUIT" are carrier-mandated STOP keywords (keywords.ts STOP_WORDS) —
// FSOS must and does treat them as opt-outs. But the appointment texts this feature sends say
// "Reschedule or cancel: <link>", so the single most natural reply to one of them is the word
// CANCEL. What then happens is entirely correct and entirely wrong at the same time: the number
// is suppressed, and the appointment stays on the calendar. The client believes they cancelled;
// the FSA gets a no-show; nobody is told.
//
// The opt-out itself is never softened — carrier rules are absolute and applyOptOut has already
// run by the time this is called. This only makes a PERSON aware of the ambiguity, because
// deciding what the client actually meant is exactly the kind of judgement that must not be
// automated (CLAUDE.md §9): FSOS never cancels an appointment on an inferred intention.
//
// Best-effort and silent on failure — a review that cannot be raised must never fail the
// opt-out that has already been applied.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { smsTail } from '@/lib/comms/contact-consent'

/** Carrier STOP keywords a person could plausibly be aiming at their appointment, not at us. */
const APPOINTMENT_AMBIGUOUS_KEYWORDS = new Set(['cancel', 'end', 'quit'])

/** True when the inbound body's keyword could have meant "cancel my appointment". */
export function isAppointmentAmbiguousOptOut(body: string): boolean {
  const first = (body || '').trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') || ''
  return APPOINTMENT_AMBIGUOUS_KEYWORDS.has(first)
}

/**
 * After an SMS opt-out has been applied, flag any upcoming appointment for the number so the FSA
 * can confirm what the client meant. No-op when the keyword was unambiguous (a plain STOP), when
 * the channel is not SMS, or when the number has nothing scheduled.
 */
export async function reviewOptOutAgainstUpcomingAppointment(args: {
  channel: string
  /** Normalized contact key (the phone the opt-out arrived from). */
  contact: string
  /** The inbound body, so an unambiguous STOP does not create noise. */
  body: string
  nowIso: string
}): Promise<{ flagged: boolean }> {
  if (args.channel !== 'sms' || !isAppointmentAmbiguousOptOut(args.body)) return { flagged: false }
  const tail = smsTail(args.contact)
  if (tail.length < 10) return { flagged: false }

  try {
    const db = getDb()
    // Resolve the number to a spine contact, then to its next scheduled appointment. Suffix
    // matching mirrors the consent/DNC reads, so carrier +1 drift cannot miss the match.
    const { data: contacts } = await db
      .from('contacts')
      .select('id')
      .is('deleted_at', null)
      .ilike('phone_digits', `%${tail}`)
      .limit(5)
    const contactIds = (contacts ?? []).map((c) => c.id as string)
    if (contactIds.length === 0) return { flagged: false }

    const { data: appts } = await db
      .from('appointments')
      .select('id, starts_at')
      .in('contact_id', contactIds)
      .eq('status', 'scheduled')
      .gt('starts_at', args.nowIso)
      .order('starts_at', { ascending: true })
      .limit(1)
    const appt = (appts ?? [])[0] as { id: string; starts_at: string | null } | undefined
    if (!appt) return { flagged: false }

    const reason =
      'SMS opt-out keyword that may have meant "cancel my appointment" — the number is now ' +
      'suppressed and the appointment is STILL SCHEDULED. Confirm with the client before the meeting.'

    await db.from('agent_actions').insert({
      kind: 'escalation',
      actor: 'system',
      outcome: 'escalated',
      target_type: 'appointment',
      target_id: appt.id,
      reason,
      blocked_step: 'dnc',
      note: `Inbound "${args.body.trim().slice(0, 40)}" from …${tail.slice(-4)}`,
    })
    await db.from('activities').insert({
      entity_type: 'appointment',
      entity_id: appt.id,
      kind: 'note',
      note: reason,
      actor: 'system',
    })
    await writeAudit({
      actor: 'system',
      action: 'comms.blocked',
      entity: 'appointment',
      entityId: appt.id,
      diff: { event: 'optout_with_upcoming_appointment', channel: 'sms', phone_tail: tail.slice(-4), starts_at: appt.starts_at },
    })
    return { flagged: true }
  } catch {
    return { flagged: false } // best-effort: never fail an opt-out that already applied
  }
}
