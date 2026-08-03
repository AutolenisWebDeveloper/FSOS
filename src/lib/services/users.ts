// src/lib/services/users.ts
// Super-admin user provisioning + roster (thin route → service; CLAUDE.md §3.1.8).
//
// provisionUser() creates an authenticated Supabase Auth user, assigns the requested
// role(s) to BOTH sources the codebase reads — the JWT `app_metadata.roles` claim
// (session.ts) and the `user_roles` table (RLS helpers, migration 010) — and emails
// the new user a SINGLE-USE link to choose their own password. It sets no password
// itself: a strong throwaway is used only to satisfy createUser, and the account is
// activated when the user completes the recovery link on /reset-password/continue
// (the existing, proven flow — src/components/auth/ResetPasswordForm.tsx).
//
// The setup link is credential-equivalent, so it is delivered ONLY by email — never
// returned to the caller or logged. On a role-write failure the just-created auth user
// is rolled back (best-effort) so the operation is retryable and never leaves an
// access-less orphan account.

import { randomBytes } from 'node:crypto'
import { getDb, ConfigError } from '@/lib/supabase/client'
import { siteUrl } from '@/lib/site'
import { sendPasswordSetupEmail } from '@/lib/notifications/account'
import { reconcileRoles, isLastSuperAdmin } from './user-roles'
import type { Role } from '@/lib/auth/rbac'

type Db = ReturnType<typeof getDb>

/**
 * Where the emailed recovery link lands (the existing set-password page).
 *
 * This MUST be a single, STABLE origin: Supabase only honors a recovery link's
 * `redirect_to` when it matches the project's Redirect-URLs allow-list, and
 * otherwise silently falls back to the project's Site URL. A per-deployment Vercel
 * hostname (VERCEL_URL) changes every deploy and can never be reliably allow-listed,
 * so we use the canonical `siteUrl()` (NEXT_PUBLIC_SITE_URL/APP_URL → the production
 * domain) — the same origin the other transactional email links use. Allow-list
 * `<siteUrl>/reset-password/continue` (or `<siteUrl>/**`) in Supabase Auth, and set
 * the project's Site URL to that domain, so the link resolves to this page instead
 * of the local-dev default.
 */
function passwordSetupRedirect(): string {
  return `${siteUrl()}/reset-password/continue`
}

/** A strong, unguessable throwaway password (never shown — the user sets their own). */
function throwawayPassword(): string {
  // base64url gives letters+digits+-_ ; the suffix guarantees mixed classes for any policy.
  return `${randomBytes(24).toString('base64url')}aA1!`
}

/** Whether a createUser error means the address is already registered. */
function isAlreadyRegistered(err: { message?: string; status?: number; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message ?? '').toLowerCase()
  return (
    err.code === 'email_exists' ||
    err.status === 422 ||
    /already.*regist|already.*exist|user.*exist/.test(msg)
  )
}

/** Find an existing auth user by email (paged; this SDK version has no email filter). */
async function findUserByEmail(db: Db, email: string): Promise<{ id: string } | null> {
  const wanted = email.trim().toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(error.message)
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted)
    if (hit) return { id: hit.id }
    if (data.users.length < 1000) return null
  }
  return null
}

export interface ProvisionUserInput {
  email: string
  roles: Role[]
  securitiesScope: boolean
}

export interface ProvisionUserContext {
  /** Auth user id of the super_admin performing the action (audit actor). */
  actor: string
}

export type EmailStatus = 'sent' | 'not_configured' | 'send_failed' | 'link_failed'

export type ProvisionUserResult =
  | { ok: true; userId: string; roles: Role[]; emailStatus: EmailStatus }
  | { ok: false; code: 'exists' | 'auth_error' | 'roles_error' | 'config'; message: string }

/** Create the auth user, assign roles (both sources), and email the setup link. */
export async function provisionUser(
  input: ProvisionUserInput,
  ctx: ProvisionUserContext,
): Promise<ProvisionUserResult> {
  const email = input.email.trim().toLowerCase()
  let db: Db
  try {
    db = getDb()
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, code: 'config', message: e.message }
    throw e
  }

  // 1 — Reject a duplicate up front (clear 409 instead of an opaque provider error).
  try {
    if (await findUserByEmail(db, email)) {
      return { ok: false, code: 'exists', message: 'A user with this email already exists.' }
    }
  } catch (e) {
    return { ok: false, code: 'auth_error', message: e instanceof Error ? e.message : 'Lookup failed' }
  }

  // 2 — Create the auth user with roles on the JWT claim. email_confirm:true so the
  // account is usable the moment they set a password via the recovery link.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password: throwawayPassword(),
    email_confirm: true,
    app_metadata: { roles: input.roles, securities_scope: input.securitiesScope },
  })
  if (createErr || !created?.user) {
    if (isAlreadyRegistered(createErr)) {
      return { ok: false, code: 'exists', message: 'A user with this email already exists.' }
    }
    return { ok: false, code: 'auth_error', message: createErr?.message ?? 'Failed to create user.' }
  }
  const userId = created.user.id

  // 3 — Mirror the roles into user_roles (RLS source of truth). Roll back the auth
  // user on failure so we never strand an access-less account and a retry can succeed.
  try {
    await syncUserRoles(db, userId, input.roles)
  } catch (e) {
    // Best-effort rollback; ignore cleanup errors (the primary failure is what matters).
    await db.auth.admin.deleteUser(userId).catch(() => {})
    return { ok: false, code: 'roles_error', message: e instanceof Error ? e.message : 'Failed to assign roles.' }
  }

  // 4 — Generate the single-use setup link and email it. A link/email failure does
  // NOT fail provisioning (the user + roles are committed) — we report the email
  // status so the operator can follow up (e.g. tell the user to use "Forgot password").
  let emailStatus: EmailStatus
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: passwordSetupRedirect() },
  })
  const actionLink = link?.properties?.action_link
  if (linkErr || !actionLink) {
    emailStatus = 'link_failed'
  } else {
    const send = await sendPasswordSetupEmail({ email, setupUrl: actionLink, roles: input.roles })
    emailStatus = send.ok ? 'sent' : send.skipped ? 'not_configured' : 'send_failed'
  }

  return { ok: true, userId, roles: input.roles, emailStatus }
}

// ─── Roster (read model for the Super · Users page) ──────────────────────────

export interface PortalUser {
  id: string
  email: string | null
  roles: string[]
  securitiesScope: boolean
  status: 'active' | 'pending'
  createdAt: string | null
  lastSignInAt: string | null
}

export type ListPortalUsersResult =
  | { ok: true; users: PortalUser[] }
  | { ok: false; kind: 'not_configured' | 'error'; message: string }

/** List provisioned users, joining Supabase Auth (email/status) with user_roles. */
export async function listPortalUsers(): Promise<ListPortalUsersResult> {
  let db: Db
  try {
    db = getDb()
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: 'Failed to load users.' }
  }

  try {
    // Roles from the table (RLS source of truth), grouped by user.
    const { data: roleRows, error: roleErr } = await db.from('user_roles').select('user_id, role')
    if (roleErr) throw new Error(roleErr.message)
    const rolesByUser = new Map<string, string[]>()
    for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
      const list = rolesByUser.get(r.user_id) ?? []
      if (!list.includes(r.role)) list.push(r.role)
      rolesByUser.set(r.user_id, list)
    }

    // Auth users (email + status), paged.
    const users: PortalUser[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(error.message)
      for (const u of data.users) {
        const metaRoles = Array.isArray((u.app_metadata as Record<string, unknown> | undefined)?.roles)
          ? ((u.app_metadata as Record<string, unknown>).roles as string[])
          : []
        const roles = rolesByUser.get(u.id) ?? metaRoles
        seen.add(u.id)
        users.push({
          id: u.id,
          email: u.email ?? null,
          roles,
          securitiesScope: (u.app_metadata as Record<string, unknown> | undefined)?.securities_scope === true,
          status: u.email_confirmed_at ? 'active' : 'pending',
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
        })
      }
      if (data.users.length < 1000) break
    }

    // Surface any role rows whose auth user wasn't returned (never hide a grant).
    for (const [userId, roles] of rolesByUser) {
      if (seen.has(userId)) continue
      users.push({ id: userId, email: null, roles, securitiesScope: false, status: 'pending', createdAt: null, lastSignInAt: null })
    }

    users.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return { ok: true, users }
  } catch {
    // Never leak provider/DB internals to the page (§16.1) — the page shows a generic error.
    return { ok: false, kind: 'error', message: 'Failed to load users.' }
  }
}

// ─── Edit / delete a provisioned user ────────────────────────────────────────

/** Replace a user's user_roles rows to exactly `nextRoles` (prune + upsert). Throws on error. */
async function syncUserRoles(db: Db, userId: string, nextRoles: readonly string[]): Promise<void> {
  const { data: current, error: readErr } = await db.from('user_roles').select('role').eq('user_id', userId)
  if (readErr) throw new Error(readErr.message)
  const { stale, toUpsert } = reconcileRoles((current ?? []).map((r: { role: string }) => r.role), nextRoles)
  if (stale.length > 0) {
    const { error: delErr } = await db.from('user_roles').delete().eq('user_id', userId).in('role', stale)
    if (delErr) throw new Error(delErr.message)
  }
  const { error: upErr } = await db
    .from('user_roles')
    .upsert(toUpsert.map((role) => ({ user_id: userId, role })), { onConflict: 'user_id,role' })
  if (upErr) throw new Error(upErr.message)
}

/** User ids currently holding super_admin (RLS source of truth) — for the last-admin guard. */
async function superAdminIds(db: Db): Promise<Set<string>> {
  const { data, error } = await db.from('user_roles').select('user_id').eq('role', 'super_admin')
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id))
}

export interface UpdateUserInput {
  roles?: Role[]
  securitiesScope?: boolean
}

export type MutateUserResult =
  | { ok: true; userId: string; email: string | null; roles: string[]; securitiesScope: boolean }
  | { ok: false; code: 'not_found' | 'last_super_admin' | 'self' | 'auth_error' | 'config'; message: string }

/**
 * Update a user's roles and/or securities-scope flag. Writes BOTH sources the app
 * reads (the JWT `app_metadata` claim and the `user_roles` table). Refuses to remove
 * super_admin from the last remaining Super Admin so the platform can't be locked out.
 */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<MutateUserResult> {
  let db: Db
  try {
    db = getDb()
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, code: 'config', message: e.message }
    throw e
  }

  try {
    const { data: got, error: getErr } = await db.auth.admin.getUserById(userId)
    if (getErr || !got?.user) return { ok: false, code: 'not_found', message: 'User not found.' }
    const user = got.user
    const existingMeta = (user.app_metadata ?? {}) as Record<string, unknown>

    const { data: currentRows, error: cErr } = await db.from('user_roles').select('role').eq('user_id', userId)
    if (cErr) throw new Error(cErr.message)
    const currentRoles = (currentRows ?? []).map((r: { role: string }) => r.role)

    const nextRoles = (input.roles ?? currentRoles) as string[]
    const nextScope = input.securitiesScope ?? existingMeta.securities_scope === true

    // Guard: never remove super_admin from the LAST super_admin (avoids lockout).
    if (currentRoles.includes('super_admin') && !nextRoles.includes('super_admin')) {
      const admins = await superAdminIds(db)
      if (isLastSuperAdmin(admins.has(userId), admins.size)) {
        return {
          ok: false,
          code: 'last_super_admin',
          message: 'You can’t remove the last Super Admin. Grant Super Admin to another user first.',
        }
      }
    }

    const { error: updErr } = await db.auth.admin.updateUserById(userId, {
      app_metadata: { ...existingMeta, roles: nextRoles, securities_scope: nextScope },
    })
    if (updErr) return { ok: false, code: 'auth_error', message: updErr.message }

    await syncUserRoles(db, userId, nextRoles)

    return { ok: true, userId, email: user.email ?? null, roles: nextRoles, securitiesScope: nextScope }
  } catch (e) {
    return { ok: false, code: 'auth_error', message: e instanceof Error ? e.message : 'Update failed.' }
  }
}

/**
 * Delete a user (auth account + role mapping). Refuses to delete your own account
 * (`ctx.actor`) or the last remaining Super Admin.
 */
export async function deleteUser(userId: string, ctx: { actor: string }): Promise<MutateUserResult> {
  let db: Db
  try {
    db = getDb()
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, code: 'config', message: e.message }
    throw e
  }

  if (userId === ctx.actor) {
    return { ok: false, code: 'self', message: 'You can’t delete your own account.' }
  }

  try {
    const { data: got, error: getErr } = await db.auth.admin.getUserById(userId)
    if (getErr || !got?.user) return { ok: false, code: 'not_found', message: 'User not found.' }
    const email = got.user.email ?? null

    const admins = await superAdminIds(db)
    if (isLastSuperAdmin(admins.has(userId), admins.size)) {
      return { ok: false, code: 'last_super_admin', message: 'You can’t delete the last Super Admin.' }
    }

    const { error: delErr } = await db.auth.admin.deleteUser(userId)
    if (delErr) return { ok: false, code: 'auth_error', message: delErr.message }

    // Clean up the app role mapping (no FK cascade from auth.users to user_roles).
    await db.from('user_roles').delete().eq('user_id', userId)

    return { ok: true, userId, email, roles: [], securitiesScope: false }
  } catch (e) {
    return { ok: false, code: 'auth_error', message: e instanceof Error ? e.message : 'Delete failed.' }
  }
}
