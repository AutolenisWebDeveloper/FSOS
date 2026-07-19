// src/lib/auth/api.ts
// API-route authorization (enforcement layer 1 for route handlers) + fine-grained
// action checks (layer 2). Pairs with lib/auth/rbac.ts (pure decision) and
// lib/auth/session.ts (RSC/layout guards). Route handlers call requireApiRole to
// gate by portal, then applyPermission for the specific action verb per the RBAC
// matrix (docs/specs/rbac-matrix.md). Reads run with the service role (getDb)
// AFTER these checks — RLS remains the primary row guarantee.

import { NextResponse } from 'next/server'
import { getServerSession } from './session'
import {
  allowedRoles,
  rolesIntersect,
  type Portal,
  type Role,
  type SessionClaims,
} from './rbac'

export type ApiAuth = { ok: true; session: SessionClaims } | { ok: false; response: NextResponse }

/** 401 if unauthenticated, 403 if the role is wrong for the portal, else the session. */
export async function requireApiRole(portal: Portal): Promise<ApiAuth> {
  const session = await getServerSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!rolesIntersect(session.roles, allowedRoles(portal))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, session }
}

export function hasRole(session: SessionClaims, ...roles: Role[]): boolean {
  return session.roles.some((r) => roles.includes(r))
}

/** True if the actor holds an active securities registration (securities-scope gate). */
export function hasSecuritiesScope(session: SessionClaims): boolean {
  // super_admin and fsa carry securities scope by default in FSOS; licensed_staff
  // only when explicitly granted (a per-user flag surfaced in a later phase). The
  // conservative default here keeps the firewall closed for staff.
  return hasRole(session, 'super_admin', 'fsa')
}

/**
 * Guard a specific action verb against the RBAC matrix. Returns null when allowed,
 * or a 403 NextResponse (with a reason) when not — so a route can `return denied`.
 */
export function requirePermission(session: SessionClaims, allowed: Role[]): NextResponse | null {
  if (rolesIntersect(session.roles, allowed)) return null
  return NextResponse.json({ error: 'Forbidden', reason: 'insufficient_permission' }, { status: 403 })
}

/** A stable actor label for audit rows. */
export function actorOf(session: SessionClaims): string {
  return session.userId
}
