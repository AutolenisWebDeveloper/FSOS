// src/lib/portal/scope.ts
// Server helpers to resolve the current partner/client's scope for RLS-aligned
// server-side reads (the service-role client bypasses RLS, so these scope filters
// are the app-layer enforcement that pairs with the DB policies).
import { getDb } from '@/lib/supabase/client'
import type { SessionClaims } from '@/lib/auth/rbac'

/** The agency partnership ids this owner is scoped to. Empty if none. */
export async function agencyIdsFor(session: SessionClaims): Promise<string[]> {
  try {
    const { data } = await getDb().from('user_agencies').select('agency_partnership_id').eq('user_id', session.userId)
    return (data ?? []).map((r: { agency_partnership_id: string }) => r.agency_partnership_id)
  } catch {
    return []
  }
}

/** The single household id this client is scoped to (or null). */
export async function householdIdFor(session: SessionClaims): Promise<string | null> {
  try {
    const { data } = await getDb().from('user_households').select('household_id').eq('user_id', session.userId).maybeSingle()
    return data?.household_id ?? null
  } catch {
    return null
  }
}

/** Whether comp disclosure is enabled for any of the owner's agencies (comp-gate). */
export async function compDisclosureEnabled(agencyIds: string[]): Promise<boolean> {
  if (agencyIds.length === 0) return false
  try {
    const { data } = await getDb().from('agency_partnerships').select('comp_disclosure').in('id', agencyIds)
    return (data ?? []).some((r: { comp_disclosure: boolean }) => r.comp_disclosure === true)
  } catch {
    return false
  }
}
