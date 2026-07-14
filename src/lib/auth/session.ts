// src/lib/auth/session.ts
// Server-side session reading for per-portal layout guards (enforcement layer 1,
// defense-in-depth behind middleware) and the scope assertions that back layer 2.
// RSC-safe: degrades to "unauthenticated" when Supabase is unconfigured rather
// than throwing at build/render.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDb } from '@/lib/supabase/client'
import { type Role, type SessionClaims, toRoles, allowedRoles, rolesIntersect, type Portal } from './rbac'

/** Build a cookie adapter from next/headers for RSC/route-handler contexts. */
function cookieAdapter() {
  const store = cookies()
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list: { name: string; value: string; options: Record<string, unknown> }[]) => {
      for (const { name, value, options } of list) {
        store.set(name, value, options)
      }
    },
  }
}

/**
 * Read and normalize the current session. Returns null for anonymous requests
 * (or when Supabase is not configured). Roles come from the JWT app_metadata
 * (`roles` claim) — the authoritative claim set by admin/invite flows; MFA state
 * comes from the authenticator assurance level.
 */
export async function getServerSession(): Promise<SessionClaims | null> {
  const supabase = createServerSupabase(cookieAdapter())
  if (!supabase) return null

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const roles = toRoles((user.app_metadata as Record<string, unknown> | undefined)?.roles)

  let mfaSatisfied = false
  let stepUpFresh = false
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    mfaSatisfied = aal?.currentLevel === 'aal2'
    // Foundation approximation of §7 step-up: treat a satisfied aal2 session as
    // step-up-fresh. A time-boxed re-challenge (re-verify if older than N minutes)
    // is layered in when the /login/mfa step-up flow lands.
    stepUpFresh = mfaSatisfied
  } catch {
    /* MFA not enrolled → aal1 → mfaSatisfied stays false */
  }

  return { userId: user.id, roles, mfaSatisfied, stepUpFresh }
}

/** Redirect to /login if there is no session; otherwise return it. */
export async function requireSession(nextPath = '/app'): Promise<SessionClaims> {
  const session = await getServerSession()
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  return session
}

/**
 * Require one of the portal's roles. 403 (not blank) on a forbidden deep link,
 * per middleware-auth.md §6.3.
 */
export async function requireRole(portal: Portal, nextPath: string): Promise<SessionClaims> {
  const session = await requireSession(nextPath)
  if (!rolesIntersect(session.roles, allowedRoles(portal))) redirect('/403')
  return session
}

export function hasRole(session: SessionClaims, role: Role): boolean {
  return session.roles.includes(role)
}

// ─── Fine-grained scope assertions (layer 2; pair with RLS) ───────────────────
// These back partner/client server actions that run with the service role AFTER
// the scope check (middleware-auth.md §5). RLS remains the primary guarantee.

/** agency_owner may only touch rows for agencies they own. */
export async function assertAgencyScope(session: SessionClaims, agencyId: string): Promise<void> {
  if (session.roles.includes('super_admin')) return
  const { data, error } = await getDb()
    .from('user_agencies')
    .select('agency_partnership_id')
    .eq('user_id', session.userId)
    .eq('agency_partnership_id', agencyId)
    .maybeSingle()
  if (error || !data) redirect('/403')
}

/** client may only touch rows for their own household. */
export async function assertHouseholdScope(session: SessionClaims, householdId: string): Promise<void> {
  if (session.roles.includes('super_admin')) return
  const { data, error } = await getDb()
    .from('user_households')
    .select('household_id')
    .eq('user_id', session.userId)
    .eq('household_id', householdId)
    .maybeSingle()
  if (error || !data) redirect('/403')
}
