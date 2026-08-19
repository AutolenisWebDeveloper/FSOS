// Native booking — Google busy loader (Slice 7). The degrade-safe entry point the public
// availability assembler (slots.ts) calls to fetch the host's external busy windows.
//
// GUARANTEE: this function NEVER throws and NEVER blocks availability. Every failure mode —
// Google not configured, no connection, revoked, token expired + refresh failed, freeBusy
// error, network timeout — degrades to "no external busy data" (skipped=true, busy=[]),
// a WARNING not an ERROR (ADR-027 §7). The booker still sees native availability. It is
// also ONE-WAY/READ-ONLY: it only ever reads freeBusy; it never writes to Google.

import {
  googleCalendarConfigured,
  credentialNeedsRefresh,
  serializeCredential,
  type BusyInterval,
} from './oauth'
import {
  resolveBusyConnectionRef,
  readConnectionCredential,
  storeConnectionSecret,
  markConnectionStatus,
} from './connection'
import { fetchFreeBusy, refreshCalendarCredential } from './exchange'

export interface GoogleBusyResult {
  busy: BusyInterval[]
  /** True when Google was not consulted or degraded — a clean no-op, not a failure. */
  skipped: boolean
  /** Non-sensitive reason for skip/degradation (for logs + the FSA status surface). */
  reason?: string
}

const SKIP = (reason: string): GoogleBusyResult => ({ busy: [], skipped: true, reason })

/**
 * Load the host's external busy windows over [timeMinIso, timeMaxIso] (UTC ISO). Callers
 * should pass a padded window (±1 day) so blocks straddling the edge aren't missed. `now`
 * is injectable for deterministic refresh decisions.
 */
export async function loadGoogleBusy(args: {
  hostUserId: string | null
  timeMinIso: string
  timeMaxIso: string
  now?: string
}): Promise<GoogleBusyResult> {
  try {
    if (!googleCalendarConfigured()) return SKIP('not_configured')

    const ref = await resolveBusyConnectionRef(args.hostUserId)
    if (!ref.ok) return SKIP('lookup_failed')
    if (!ref.data || ref.data.status === 'revoked') return SKIP('not_connected')

    let cred = await readConnectionCredential(ref.data.id)
    if (!cred) {
      await markConnectionStatus(ref.data.id, 'error', { lastError: 'missing_credential' })
      return SKIP('missing_credential')
    }

    const nowMs = args.now ? Date.parse(args.now) : Date.now()
    if (credentialNeedsRefresh(cred, Number.isFinite(nowMs) ? nowMs : Date.now())) {
      const refreshed = await refreshCalendarCredential(cred)
      if (!refreshed) {
        // Refresh failed — no refresh_token, or the grant was revoked (invalid_grant). Either way it
        // cannot recover without a fresh consent, so mark it 'revoked' (not the transient 'error')
        // so the settings surface prompts the FSA to reconnect instead of looking merely degraded.
        await markConnectionStatus(ref.data.id, 'revoked', { lastError: 'token_refresh_failed' })
        return SKIP('token_refresh_failed')
      }
      await storeConnectionSecret(ref.data.id, serializeCredential(refreshed))
      await markConnectionStatus(ref.data.id, 'connected', { tokenExpiresAt: refreshed.expiresAt ?? null })
      cred = refreshed
    }

    const res = await fetchFreeBusy({
      accessToken: cred.accessToken,
      calendarId: ref.data.calendarId,
      timeMinIso: args.timeMinIso,
      timeMaxIso: args.timeMaxIso,
    })
    if (!res.ok) {
      // 401/403 → the token/grant is no longer valid (revoked access / insufficient scope): mark
      // 'revoked' so the FSA is prompted to reconnect. Any other status (5xx, network, rate limit)
      // is transient → 'error', which self-heals on the next read without a manual reconnect.
      const status = res.status === 401 || res.status === 403 ? 'revoked' : 'error'
      await markConnectionStatus(ref.data.id, status, { lastError: `freebusy_${res.status}` })
      return SKIP(`freebusy_${res.status}`)
    }

    await markConnectionStatus(ref.data.id, 'connected', {
      lastError: null,
      lastSyncedAt: new Date().toISOString(),
    })
    return { busy: res.busy, skipped: false }
  } catch {
    // Any unexpected failure degrades silently to native availability (never an ERROR).
    return SKIP('exception')
  }
}
