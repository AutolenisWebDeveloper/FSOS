// src/lib/cross-sell-life/control-contract.ts
// PURE input + authorization contract for the Cross-Sell Life operational-control route
// (POST /api/cross-sell-life/[id]/control). No DB, no Next, no @/ imports — only zod — so this is
// the SINGLE source of truth for (a) which roles may operate campaign controls and (b) the accepted
// request shape (action + optional reason + resume-strategy overrides), and it is verifiable OFFLINE
// (tests/cross-sell-life-control-contract.test.mjs) the same way states.ts's transition tables are.
//
// Before this module the request schema was declared inline in the route and the role set lived in
// controls.ts — two scattered definitions. Consolidating them here (§6 — one definition, not two)
// lets the route import ControlInputSchema and lets controls.ts derive CONTROL_ROLES from
// CONTROL_ROLE_NAMES, while the route-level authz gate + input contract get a real test.
import { z } from 'zod'

// The seven operational-control actions (§ Operational Controls). Mirrors the ControlAction union in
// ./states.ts (controlTargetState is exhaustive over exactly this set).
export const CONTROL_ACTIONS = ['submit', 'enable', 'pause', 'resume', 'disable', 'emergency_stop', 'archive'] as const
export type ControlActionName = (typeof CONTROL_ACTIONS)[number]

// Resume strategy (§ Resume Behavior). The behavior selects WHICH paused enrollments proceed; the
// replay policy decides whether touches that came due while paused are skipped (no catch-up burst)
// or the next due touch fires immediately. applyControl() consumes these as per-action overrides of
// the campaign's stored defaults.
export const RESUME_BEHAVIORS = ['all_active', 'only_admin_paused', 'restart_day_1', 'only_new'] as const
export type ResumeBehaviorName = (typeof RESUME_BEHAVIORS)[number]
export const REPLAY_POLICIES = ['skip', 'replay'] as const
export type ReplayPolicyName = (typeof REPLAY_POLICIES)[number]

export const ControlInputSchema = z.object({
  action: z.enum(CONTROL_ACTIONS),
  reason: z.string().trim().max(300).optional(),
  resumeBehavior: z.enum(RESUME_BEHAVIORS).optional(),
  replayPolicy: z.enum(REPLAY_POLICIES).optional(),
})
export type ControlInput = z.infer<typeof ControlInputSchema>

// Roles permitted to operate campaign controls (§ Permissions). Kept as plain strings so this
// contract stays framework-free and offline-testable; controls.ts casts these to the RBAC Role[]
// for the typed requirePermission() call. Must remain a subset of rbac.ts ROLES.
export const CONTROL_ROLE_NAMES = ['admin', 'ops', 'super_admin', 'fsa'] as const
export type ControlRoleName = (typeof CONTROL_ROLE_NAMES)[number]

/**
 * PURE authorization predicate for the control route — true iff the user holds at least one
 * control-capable role. Mirrors rbac.rolesIntersect(userRoles, CONTROL_ROLE_NAMES) exactly so the
 * route's requirePermission(CONTROL_ROLES) gate can be proven without spinning up the Next/Supabase
 * middleware. Fail-closed: an empty or unknown role set returns false.
 */
export function isAuthorizedForControl(userRoles: readonly string[]): boolean {
  const allowed = CONTROL_ROLE_NAMES as readonly string[]
  return userRoles.some((r) => allowed.includes(r))
}
