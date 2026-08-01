// src/lib/cross-sell-life/ownership-core.ts
// PURE advisor-ownership resolution for the Cross-Sell Life advisor-handoff route (§14), no DB.
//
// Security (D7): "An advisor accepts ownership of an escalated conversation" — the advisor taking
// ownership IS the authenticated, licensed operator making the request. The route is role-gated to
// fsa / licensed_staff / control roles, so the SESSION user is a valid owner by construction; there
// is no separate application user directory to validate an arbitrary UUID against. The prior route
// wrote whatever advisor UUID the request body carried straight onto the enrollment and flipped it
// to advisor_owned (which STOPS the AI) — so any authorized caller could assign ownership to an
// unrelated/never-a-user UUID and silently stall automation with no real owner accountable.
//
// This resolver closes that: it DEFAULTS to the session user, and rejects a body-supplied advisor
// that is not the session user (this endpoint takes ownership for yourself; assigning to another
// operator is a distinct, separately-authorized action, not this one). Fails closed on a malformed
// session id.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AdvisorOwnerResolution =
  | { ok: true; advisor: string }
  | { ok: false; error: 'invalid_session_user' | 'advisor_must_be_self' }

/**
 * Resolve the advisor who will own the enrollment.
 * @param sessionUserId the authenticated user id (actorOf(session) — a real, role-gated operator)
 * @param requested     the optional advisor id from the request body
 */
export function resolveAdvisorOwner(sessionUserId: string, requested?: string | null): AdvisorOwnerResolution {
  const self = (sessionUserId || '').trim()
  if (!UUID_RE.test(self)) return { ok: false, error: 'invalid_session_user' }
  const asked = typeof requested === 'string' ? requested.trim() : ''
  // Default to the session user; a body advisor that differs is refused (no assigning ownership to
  // an arbitrary/other UUID through this self-acceptance endpoint).
  if (asked && asked.toLowerCase() !== self.toLowerCase()) return { ok: false, error: 'advisor_must_be_self' }
  return { ok: true, advisor: self }
}
