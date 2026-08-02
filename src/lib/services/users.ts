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
import { EMAIL_ORIGIN } from '@/lib/email/brand'
import { sendPasswordSetupEmail } from '@/lib/notifications/account'
import { reconcileRoles } from './user-roles'
import type { Role } from '@/lib/auth/rbac'

type Db = ReturnType<typeof getDb>

/** Where the emailed recovery link lands (the existing set-password page). */
function passwordSetupRedirect(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    EMAIL_ORIGIN
  return `${raw.replace(/\/$/, '')}/reset-password/continue`
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
    const { data: current, error: readErr } = await db.from('user_roles').select('role').eq('user_id', userId)
    if (readErr) throw new Error(readErr.message)
    const { stale, toUpsert } = reconcileRoles((current ?? []).map((r: { role: string }) => r.role), input.roles)
    if (stale.length > 0) {
      const { error: delErr } = await db.from('user_roles').delete().eq('user_id', userId).in('role', stale)
      if (delErr) throw new Error(delErr.message)
    }
    const { error: upErr } = await db
      .from('user_roles')
      .upsert(toUpsert.map((role) => ({ user_id: userId, role })), { onConflict: 'user_id,role' })
    if (upErr) throw new Error(upErr.message)
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
      users.push({ id: userId, email: null, roles, status: 'pending', createdAt: null, lastSignInAt: null })
    }

    users.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return { ok: true, users }
  } catch {
    // Never leak provider/DB internals to the page (§16.1) — the page shows a generic error.
    return { ok: false, kind: 'error', message: 'Failed to load users.' }
  }
}
