// src/lib/comms/recipient-timezone-db.ts
// The thin DB-backed wrapper over the PURE resolver (recipient-timezone.ts): read the
// recipient's phone (member) and ZIP (household) from the spine, then resolve.
//
// TWO CONSUMERS, TWO CONTRACTS:
//
//   • The dispatch chokepoint resolves FRESH on every send (dispatch-policy.ts has its own
//     reader) — that path is authoritative and fail-closed.
//   • Enrollment (this module's main caller) stamps `*_enrollments.timezone` as an
//     AUDIT/REPORTING value at the moment of enrollment. It is NOT the dispatch source of
//     truth — dispatch never reads it — so a stale stamp can mislabel a report but can
//     never mis-time a send. Best-effort by design: an unresolvable recipient keeps the
//     column's default rather than blocking the enrollment (the send-time fail-closed
//     behavior is the chokepoint's job, not enrollment's).

import { getDb } from '../supabase/client'
import { resolveRecipientTimeZone } from './recipient-timezone'

/**
 * Resolve the recipient's IANA zone from the spine for ENROLLMENT STAMPING. Returns null
 * when it cannot be resolved — callers then leave the column at its default rather than
 * writing a guess.
 */
export async function enrollmentTimezoneFor(
  memberId: string | null | undefined,
  householdId: string | null | undefined,
): Promise<string | null> {
  try {
    const db = getDb()
    let phone: string | null = null
    let zip: string | null = null
    if (memberId) {
      const { data } = await db.from('household_members').select('phone').eq('id', memberId).maybeSingle()
      phone = data?.phone ?? null
    }
    if (householdId) {
      const { data } = await db.from('households').select('zip').eq('id', householdId).maybeSingle()
      zip = data?.zip ?? null
    }
    const r = resolveRecipientTimeZone({ phone, zip })
    return r.resolved ? r.timeZone : null
  } catch {
    return null // best-effort: never block an enrollment on a reporting stamp
  }
}
