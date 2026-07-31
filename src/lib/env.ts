// src/lib/env.ts
// Single source of truth for environment variables that have MULTIPLE accepted names
// (the Vercel↔Supabase integration injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// alongside the FSOS-native names) or that gate security behavior. Centralizing alias
// resolution here prevents the drift the audit found — e.g. /api/health once reported
// the service key "missing" because it checked only one of the two accepted names while
// getDb() accepted both. Every reader now resolves through the SAME function.
//
// Non-aliased, single-name vars stay read inline at their use site; this module is only
// for the ones where a single authoritative resolution matters.

/** Supabase project URL (native or Vercel-integration alias). */
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
}

/** Supabase service-role key (native or Vercel-integration alias). Server-only. */
export function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
}

/** Supabase anon key (browser/RLS client). */
export function supabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

/** Shared secret for Vercel Cron / manual cron triggers. */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET
}

/**
 * True on any DEPLOYED runtime (production or a Vercel preview, both of which serve
 * real data). The canonical signal for fail-closed decisions — mirrors the logic in
 * lib/auth/config-gate and lib/data/dob-key so they can't drift apart.
 */
export function isDeployed(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
}
