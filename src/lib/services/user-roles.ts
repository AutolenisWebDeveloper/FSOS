// src/lib/services/user-roles.ts
// Pure helper backing the user-provisioning service (src/lib/services/users.ts).
//
// FSOS reads a user's roles from TWO sources that must stay in sync (see the header
// of scripts/create-user.mjs): the Supabase JWT `app_metadata.roles` claim (read by
// src/lib/auth/session.ts) AND the `user_roles` table (read by the RLS helpers in
// migration 010). When we set a user's full role set we replace it: prune rows no
// longer granted, then upsert the current set. Keeping that diff PURE makes it unit-
// testable without a live Supabase (tests/super-user-provision.test.mjs).

/** The prune/upsert plan to make `current` equal `requested`, deduped + order-stable. */
export interface RoleReconcile {
  /** Roles present now but no longer granted — DELETE these. */
  stale: string[]
  /** The full desired set — UPSERT these (idempotent on the (user_id, role) key). */
  toUpsert: string[]
}

/**
 * Diff the roles a user currently holds against the requested set.
 * Inputs are treated as sets (deduped); output arrays are stable-ordered by first
 * appearance so audit diffs and tests are deterministic.
 */
export function reconcileRoles(current: readonly string[], requested: readonly string[]): RoleReconcile {
  const want = dedupe(requested)
  const wantSet = new Set(want)
  const stale = dedupe(current).filter((r) => !wantSet.has(r))
  return { stale, toUpsert: want }
}

/**
 * Lockout guard (pure): true when the target holds super_admin AND is the only one,
 * so removing or deleting them would leave the platform with no Super Admin. Used by
 * both updateUser (role removal) and deleteUser in src/lib/services/users.ts.
 */
export function isLastSuperAdmin(targetIsSuperAdmin: boolean, superAdminCount: number): boolean {
  return targetIsSuperAdmin && superAdminCount <= 1
}

function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const r = raw?.trim?.() ?? raw
    if (!r || seen.has(r)) continue
    seen.add(r)
    out.push(r)
  }
  return out
}
