// src/lib/auth/rbac.ts
// Role model + the PURE access-decision logic that both src/middleware.ts (coarse
// portal gate) and the per-portal layout guards share. Keeping the decision pure
// and dependency-free is what makes the middleware-auth.md §8 authorization matrix
// unit-testable (tests/auth-matrix.test.mjs) without a live Supabase or Next runtime.
//
// This is enforcement layer (1) — coarse portal/route gating only. Fine-grained
// row authorization is RLS + the assert* helpers below (layer 2). Never rely on
// this file alone.

export const ROLES = [
  'super_admin',
  'fsa',
  'licensed_staff',
  'admin',
  'ops',
  'case_manager',
  'compliance',
  'supervisor',
  'agency_owner',
  'client',
] as const

export type Role = (typeof ROLES)[number]

export type Portal = 'public' | 'fsa' | 'admin' | 'compliance' | 'partner' | 'client' | 'super'

export type MfaLevel = 'none' | 'optional' | 'required' | 'mandatory_stepup'

interface PortalRule {
  prefix: string
  roles: Role[]
  mfa: MfaLevel
}

// middleware-auth.md §2 — Portal → allowed roles + MFA. Order matters: longest /
// most-specific prefix wins (all are distinct top-level prefixes here).
export const PORTAL_RULES: Record<Exclude<Portal, 'public'>, PortalRule> = {
  fsa: { prefix: '/app', roles: ['fsa', 'licensed_staff', 'super_admin'], mfa: 'required' },
  admin: { prefix: '/admin', roles: ['admin', 'ops', 'case_manager', 'super_admin'], mfa: 'required' },
  compliance: {
    prefix: '/compliance',
    roles: ['compliance', 'supervisor', 'super_admin'],
    mfa: 'required',
  },
  partner: { prefix: '/partner', roles: ['agency_owner'], mfa: 'optional' },
  client: { prefix: '/client', roles: ['client'], mfa: 'optional' },
  super: { prefix: '/super', roles: ['super_admin'], mfa: 'mandatory_stepup' },
}

// middleware-auth.md §3 — public allowlist, NEVER redirected to login. Includes
// the pre-existing FSOS public routes (/[slug], /upload/[slug], /forms/[formId]).
const PUBLIC_EXACT = new Set<string>([
  '/',
  '/about',
  '/education',
  '/refer',
  '/refer/success',
  '/schedule',
  '/schedule/success',
  '/events',
  '/consent',
  '/consent/preferences',
  '/privacy',
  '/terms',
  '/disclosures',
  '/support',
  '/login',
  '/login/mfa',
  '/forgot-password',
  '/403',
  '/404',
  '/500',
  '/maintenance',
  '/offline',
  '/unsubscribe',
])

// Prefixes whose entire subtree is public.
const PUBLIC_PREFIXES = [
  '/education/',
  '/events/',
  '/reset-password/',
  '/invite/',
  '/verify/',
  '/upload/',
  '/forms/',
]

/** True if the path is on the public allowlist (§3). */
export function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true
  for (const p of PUBLIC_PREFIXES) if (path.startsWith(p)) return true
  // Bare top-level slug (/[slug]) is a public agency referral page. Anything with
  // a further path segment is NOT a bare slug and must fall through to portal
  // gating (the portal prefixes are matched separately in portalOf).
  if (/^\/[^/]+$/.test(path) && !isPortalPrefixed(path)) return true
  return false
}

function isPortalPrefixed(path: string): boolean {
  return Object.values(PORTAL_RULES).some(
    (r) => path === r.prefix || path.startsWith(r.prefix + '/'),
  )
}

/** Which portal a path belongs to (by URL prefix). 'public' if none. */
export function portalOf(path: string): Portal {
  for (const [key, rule] of Object.entries(PORTAL_RULES) as [Exclude<Portal, 'public'>, PortalRule][]) {
    if (path === rule.prefix || path.startsWith(rule.prefix + '/')) return key
  }
  return 'public'
}

export function allowedRoles(portal: Portal): Role[] {
  if (portal === 'public') return [...ROLES]
  return PORTAL_RULES[portal].roles
}

export function mfaLevel(portal: Portal): MfaLevel {
  if (portal === 'public') return 'none'
  return PORTAL_RULES[portal].mfa
}

export function rolesIntersect(userRoles: readonly Role[], allowed: readonly Role[]): boolean {
  return userRoles.some((r) => allowed.includes(r))
}

// ─── Pure access decision (shared by middleware + tests) ──────────────────────

export interface SessionClaims {
  userId: string
  roles: Role[]
  /** MFA satisfied for this session (aal2). */
  mfaSatisfied: boolean
  /** Recent step-up re-challenge (for /super). */
  stepUpFresh: boolean
}

export type AccessDecision =
  | { action: 'allow' }
  | { action: 'redirect'; to: string; reason: 'unauthenticated' | 'mfa' | 'stepup' }
  | { action: 'forbid'; reason: 'wrong_role' } // → rewrite to /403

/**
 * The coarse gate, as a pure function. `session` is null for anonymous requests.
 * Mirrors middleware-auth.md §4 pseudocode exactly.
 */
export function evaluateAccess(path: string, session: SessionClaims | null): AccessDecision {
  if (isPublicPath(path)) return { action: 'allow' }

  if (!session) {
    return { action: 'redirect', to: `/login?next=${encodeURIComponent(path)}`, reason: 'unauthenticated' }
  }

  const portal = portalOf(path)
  if (portal === 'public') {
    // Authenticated user on a non-public, non-portal path: allow (e.g. a future
    // shared authenticated route). Portal gating handles the enumerated portals.
    return { action: 'allow' }
  }

  if (!rolesIntersect(session.roles, allowedRoles(portal))) {
    return { action: 'forbid', reason: 'wrong_role' }
  }

  const mfa = mfaLevel(portal)
  if ((mfa === 'required' || mfa === 'mandatory_stepup') && !session.mfaSatisfied) {
    return { action: 'redirect', to: `/login/mfa?next=${encodeURIComponent(path)}`, reason: 'mfa' }
  }
  if (mfa === 'mandatory_stepup' && !session.stepUpFresh) {
    return {
      action: 'redirect',
      to: `/login/mfa?step_up=1&next=${encodeURIComponent(path)}`,
      reason: 'stepup',
    }
  }

  return { action: 'allow' }
}

/** Coerce an arbitrary claim array into known roles. */
export function toRoles(input: unknown): Role[] {
  if (!Array.isArray(input)) return []
  return input.filter((r): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r))
}
