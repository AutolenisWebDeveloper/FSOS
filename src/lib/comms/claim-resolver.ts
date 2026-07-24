// src/lib/comms/claim-resolver.ts
// Slice 8 (§18) — Data-confidence claim resolver (DB, READ-ONLY).
//
// Resolves the verification state of a campaign's declared claim fields for ONE recipient
// household from stored data, producing the ClaimField[] the pure buildDataConfidence
// (claims.ts) turns into the gate input. Fail-CLOSED: a lookup error or a missing/ambiguous
// value marks the field UNVERIFIED (or conflicting), so the send is excluded + a verification
// task raised rather than sent on a guess (§13). No writes, no provider calls.
import { getDb } from '@/lib/supabase/client'
import type { ClaimField } from './data-confidence'
import { campaignClaimKeys, type ClaimFieldKey } from './claims'

export interface ClaimResolveContext {
  householdId: string | null
}

/** conversion_deadline: verified when EXACTLY ONE non-null deadline is on the household's
 *  policies; conflicting when policies disagree; unverified when none/unknown. */
async function resolveConversionDeadline(householdId: string): Promise<ClaimField> {
  try {
    const { data, error } = await getDb()
      .from('household_policies')
      .select('conversion_deadline')
      .eq('household_id', householdId)
      .not('conversion_deadline', 'is', null)
    if (error) throw error
    const deadlines = Array.from(new Set((data ?? []).map((r) => r.conversion_deadline).filter(Boolean)))
    if (deadlines.length === 0) return { key: 'conversion_deadline', verified: false }
    if (deadlines.length > 1) return { key: 'conversion_deadline', verified: true, conflicting: true }
    return { key: 'conversion_deadline', verified: true }
  } catch {
    return { key: 'conversion_deadline', verified: false } // fail closed
  }
}

/** policy_status: verified when the household has at least one policy with a known status
 *  and they do not disagree on the actionable lapse/active axis. */
async function resolvePolicyStatus(householdId: string): Promise<ClaimField> {
  try {
    const { data, error } = await getDb()
      .from('household_policies')
      .select('status')
      .eq('household_id', householdId)
    if (error) throw error
    const statuses = (data ?? []).map((r) => r.status).filter(Boolean)
    if (statuses.length === 0) return { key: 'policy_status', verified: false }
    const lapsed = statuses.some((s) => s === 'lapsed' || s === 'cancelled' || s === 'non_renewed')
    const active = statuses.some((s) => s === 'active' || s === 'bound' || s === 'renewed')
    // A household that is BOTH lapsed and active on different policies is conflicting for a
    // status-specific claim (which policy is the message about?).
    if (lapsed && active) return { key: 'policy_status', verified: true, conflicting: true }
    return { key: 'policy_status', verified: true }
  } catch {
    return { key: 'policy_status', verified: false }
  }
}

/** appointment_at: verified when EXACTLY ONE upcoming scheduled appointment exists. */
async function resolveAppointmentAt(householdId: string): Promise<ClaimField> {
  try {
    const { data, error } = await getDb()
      .from('appointments')
      .select('scheduled_at, status')
      .eq('household_id', householdId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
    if (error) throw error
    const upcoming = (data ?? []).filter((r) => r.scheduled_at)
    if (upcoming.length === 0) return { key: 'appointment_at', verified: false }
    if (upcoming.length > 1) return { key: 'appointment_at', verified: true, conflicting: true }
    return { key: 'appointment_at', verified: true }
  } catch {
    return { key: 'appointment_at', verified: false }
  }
}

const RESOLVERS: Record<ClaimFieldKey, (householdId: string) => Promise<ClaimField>> = {
  conversion_deadline: resolveConversionDeadline,
  policy_status: resolvePolicyStatus,
  appointment_at: resolveAppointmentAt,
}

/**
 * Resolve the declared claim fields for one recipient. Unknown keys are dropped
 * (campaignClaimKeys). A null household → every declared field is unverified (fail closed).
 */
export async function resolveClaimFields(declared: unknown, ctx: ClaimResolveContext): Promise<ClaimField[]> {
  const keys = campaignClaimKeys(declared)
  if (keys.length === 0) return []
  if (!ctx.householdId) return keys.map((key) => ({ key, verified: false }))
  return Promise.all(keys.map((key) => RESOLVERS[key](ctx.householdId as string)))
}
