#!/usr/bin/env node
// FSOS — bootstrap / provision an authenticated portal user.
//
// GAP this closes: roles are read from the Supabase JWT `app_metadata.roles`
// claim (src/lib/auth/session.ts) AND from the `user_roles` table (RLS helpers in
// migration 010). A user created in the Supabase dashboard has neither, so they
// cannot reach any portal. This script sets BOTH, keeping the JWT claim and the
// table in sync — the two sources of truth the codebase actually reads.
//
// Usage:
//   npm run create-user -- --email you@example.com --password 'S3cret!' --roles super_admin
//   npm run create-user -- --email fsa@example.com --password 'S3cret!' --roles fsa,licensed_staff --securities-scope
//
// Args:
//   --email               (required) login email
//   --password            (required to CREATE; optional when updating an existing user)
//   --roles               (required) comma-separated, validated against the Role type in
//                         src/lib/auth/rbac.ts (single source of truth — parsed at runtime)
//   --securities-scope    (optional boolean flag) sets app_metadata.securities_scope=true;
//                         omit to default false on create / preserve existing on update
//
// If the user already exists, their roles (and securities scope / password when
// provided) are UPDATED instead of failing.
//
// Env (never hard-coded, never logged):
//   NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL
//   SUPABASE_SERVICE_KEY     | SUPABASE_SERVICE_ROLE_KEY   (service-role key)
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── Minimal .env.local loader (dev DX; real env always wins) ──────────────────
function loadEnvLocal() {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

// ── Parse the Role union from src/lib/auth/rbac.ts (keeps validation in sync) ──
function knownRoles() {
  const src = readFileSync(join(root, 'src', 'lib', 'auth', 'rbac.ts'), 'utf8')
  const block = src.match(/export const ROLES = \[([\s\S]*?)\] as const/)
  if (!block) {
    console.error('Could not parse ROLES from src/lib/auth/rbac.ts')
    process.exit(1)
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

async function main() {
  loadEnvLocal()

  let parsed
  try {
    parsed = parseArgs({
      options: {
        email: { type: 'string' },
        password: { type: 'string' },
        roles: { type: 'string' },
        'securities-scope': { type: 'boolean' },
      },
    })
  } catch (err) {
    fail(`Invalid arguments: ${err.message}`)
  }
  const { values } = parsed

  const email = values.email?.trim()
  const password = values.password
  const rolesArg = values.roles?.trim()
  const securitiesScopeProvided = values['securities-scope'] !== undefined
  const securitiesScope = values['securities-scope'] === true

  if (!email) fail('--email is required')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`--email "${email}" is not a valid email address`)
  if (!rolesArg) fail('--roles is required (comma-separated)')

  const requested = [...new Set(rolesArg.split(',').map((r) => r.trim()).filter(Boolean))]
  if (requested.length === 0) fail('--roles must contain at least one role')

  const allowed = knownRoles()
  const invalid = requested.filter((r) => !allowed.includes(r))
  if (invalid.length > 0) {
    fail(`Unknown role(s): ${invalid.join(', ')}\n  Allowed roles: ${allowed.join(', ')}`)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your environment / .env.local.',
    )
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Find existing user by email (paged; no email-filter API in this SDK ver) ──
  async function findUserByEmail(target) {
    const wanted = target.toLowerCase()
    for (let page = 1; ; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(`listUsers failed: ${error.message}`)
      const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted)
      if (hit) return hit
      if (data.users.length < 1000) return null
    }
  }

  let user
  let effectiveScope
  const existing = await findUserByEmail(email)

  if (existing) {
    // Preserve securities_scope on update unless the flag was explicitly passed.
    const priorScope = existing.app_metadata?.securities_scope === true
    const nextScope = securitiesScopeProvided ? securitiesScope : priorScope
    effectiveScope = nextScope
    const attrs = {
      email_confirm: true,
      app_metadata: { ...existing.app_metadata, roles: requested, securities_scope: nextScope },
    }
    if (password) attrs.password = password
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, attrs)
    if (error) fail(`Failed to update user: ${error.message}`)
    user = data.user
    console.log(`\n↻ Updated existing user ${email}`)
  } else {
    if (!password) fail('--password is required to create a new user')
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { roles: requested, securities_scope: securitiesScope },
    })
    if (error) fail(`Failed to create user: ${error.message}`)
    user = data.user
    effectiveScope = securitiesScope
    console.log(`\n＋ Created user ${email}`)
  }

  // ── Keep the user_roles table in sync with the JWT claim (RLS reads this) ─────
  // Replace the full set: prune rows no longer granted, then upsert the current set.
  const { data: current, error: readErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
  if (readErr) fail(`User auth updated, but reading user_roles failed: ${readErr.message}`)

  const stale = (current ?? []).map((r) => r.role).filter((r) => !requested.includes(r))
  if (stale.length > 0) {
    const { error: delErr } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', user.id)
      .in('role', stale)
    if (delErr) fail(`User auth updated, but pruning user_roles failed: ${delErr.message}`)
  }

  const { error: upErr } = await supabase
    .from('user_roles')
    .upsert(requested.map((role) => ({ user_id: user.id, role })), { onConflict: 'user_id,role' })
  if (upErr) fail(`User auth updated, but writing user_roles failed: ${upErr.message}`)

  console.log('  user id         :', user.id)
  console.log('  roles           :', requested.join(', '))
  console.log('  securities scope:', effectiveScope)
  console.log('  email confirmed :', true)
  console.log('\n✓ Done. JWT app_metadata.roles and the user_roles table are in sync.\n')
}

main().catch((err) => {
  // Never surface the password or service-role key in an error path.
  console.error('\n✗ Unexpected error:', err?.message ?? err, '\n')
  process.exit(1)
})
