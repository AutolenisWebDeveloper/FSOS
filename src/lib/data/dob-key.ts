// src/lib/data/dob-key.ts
// The fail-closed decision for the DOB encryption key (CLAUDE.md §4/§10 — PII at
// rest). This key is passed to the pgcrypto RPCs that encrypt the aggregate-root
// spine's `household_members.dob` (real client PII). Historically dobKey() fell
// back to a committed development default when neither env name was set — meaning a
// misconfigured production deploy would silently encrypt client DOB with a
// publicly-known key (effectively no encryption). That is a fail-OPEN posture below
// a regulated-fintech bar.
//
// New posture mirrors auth/config-gate.ts: fail CLOSED in a deployed runtime. If no
// key is configured on a deployed environment, refuse to hand back the shared dev
// default — the caller surfaces a clear "not configured" (503) instead of writing
// PII under a known key. Local/dev is unchanged, with an explicit ALLOW_INSECURE_LOCAL
// escape hatch for the rare intentional case.
//
// Pure + dependency-free so it is unit-testable without a Supabase/Next runtime
// (tests/dob-key-fail-closed.test.mjs), matching the config-gate.ts style.

type EnvLike = Record<string, string | undefined>

/** The development-only default. NEVER used in a deployed runtime (fail-closed). */
export const DEV_DOB_KEY_DEFAULT = 'fsos-dev-dob-key-change-me'

export type DobKeyResult =
  | { ok: true; key: string }
  | { ok: false; reason: string }

/**
 * Resolve the DOB encryption key, failing closed on a deployed runtime when unset.
 *
 * NODE_ENV==='production' (Next forces it on build/start) is the primary deploy
 * signal; VERCEL==='1' is a belt-and-suspenders guard so previews (which serve real
 * PII) stay closed too. ALLOW_INSECURE_LOCAL=1 is the explicit dev opt-out.
 */
export function resolveDobKey(env: EnvLike = process.env): DobKeyResult {
  const explicit = env.DOB_ENCRYPTION_KEY || env.FSOS_DOB_KEY
  if (explicit) return { ok: true, key: explicit }

  const deployed = env.NODE_ENV === 'production' || env.VERCEL === '1'
  if (deployed && env.ALLOW_INSECURE_LOCAL !== '1') {
    return {
      ok: false,
      reason:
        'DOB_ENCRYPTION_KEY (or FSOS_DOB_KEY) is not set. Refusing to encrypt client ' +
        'date-of-birth with the shared development default in a deployed environment. ' +
        'Set the key in your deployment configuration.',
    }
  }
  return { ok: true, key: DEV_DOB_KEY_DEFAULT }
}
