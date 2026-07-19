// src/lib/auth/config-gate.ts
// The single decision for how internal auth behaves when NO credential is
// configured (neither FSOS_API_SECRET nor FSOS_ADMIN_PASSWORD).
//
// Historically this "unconfigured" case failed OPEN — the command center and
// internal API routes (which serve client PII) were reachable with no auth on
// any deploy that forgot to set a secret. That is below a regulated-fintech bar.
//
// New posture: fail CLOSED in production. A misconfigured production deploy
// denies rather than exposing PII. Local/dev (NODE_ENV !== 'production') still
// runs without secrets so the developer experience is unchanged, and an explicit
// ALLOW_INSECURE_LOCAL=1 escape hatch exists for the rare intentional case.
//
// Pure and dependency-free so it is unit-testable without next/server.

type EnvLike = Record<string, string | undefined>

/**
 * When no internal-auth credential is configured, may the request be allowed
 * through? True only outside a deployed runtime, or when the operator has
 * explicitly opted out of the fail-closed posture via ALLOW_INSECURE_LOCAL=1.
 *
 * NODE_ENV is the primary production signal (Next forces it to 'production' on
 * `next build`/`next start`). `VERCEL === '1'` is a belt-and-suspenders guard so
 * the gate stays closed on ANY Vercel deployment — preview included, since
 * previews serve real PII — even if NODE_ENV were somehow unset in that runtime.
 */
export function unconfiguredInternalAuthAllowed(env: EnvLike = process.env): boolean {
  if (env.ALLOW_INSECURE_LOCAL === '1') return true
  const deployed = env.NODE_ENV === 'production' || env.VERCEL === '1'
  return !deployed
}
