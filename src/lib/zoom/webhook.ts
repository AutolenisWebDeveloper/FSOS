// src/lib/zoom/webhook.ts
// Zoom webhook cryptography — the URL-validation (CRC) challenge response and the per-event
// HMAC signature verification, per Zoom's documented scheme (developers.zoom.us/docs/api/
// webhooks). Kept in its own module (node:crypto only, no DB, no @/ imports) so the test
// harness can compile it standalone and prove reject-unsigned / reject-bad-HMAC / CRC.
//
// Scheme (verified against Zoom docs + reference implementations):
//   CRC:   response.encryptedToken = HMAC_SHA256(secretToken, plainToken) in hex;
//          respond { plainToken, encryptedToken } with 200 within 3s.
//   Event: message = `v0:${x-zm-request-timestamp}:${rawBody}`;
//          signature = `v0=` + HMAC_SHA256(secretToken, message) in hex;
//          compare (constant-time) with the `x-zm-signature` header.
// The RAW request body is used for the HMAC (never a re-serialization), so signatures match
// byte-for-byte what Zoom signed.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** The Zoom "Secret Token" from the app's Feature → Event Subscription config. */
export function zoomWebhookSecret(): string | undefined {
  return process.env.ZOOM_WEBHOOK_SECRET_TOKEN || undefined
}

/**
 * Build the CRC challenge response. `encryptedToken` is an HMAC-SHA256 of the plainToken
 * keyed by the secret token, hex-encoded. Returns null when no secret is configured (the
 * route then rejects — an unconfigured endpoint must not pretend to validate).
 */
export function zoomCrcResponse(
  plainToken: string,
  secret: string | undefined = zoomWebhookSecret(),
): { plainToken: string; encryptedToken: string } | null {
  if (!secret || !plainToken) return null
  const encryptedToken = createHmac('sha256', secret).update(plainToken).digest('hex')
  return { plainToken, encryptedToken }
}

export interface ZoomVerifyInput {
  rawBody: string
  signature: string | null // x-zm-signature header (e.g. "v0=<hex>")
  timestamp: string | null // x-zm-request-timestamp header
  secret?: string | undefined
  /** Reject events whose timestamp is older than this many seconds (replay window). */
  toleranceSeconds?: number
  /** Injected clock (ms) for deterministic tests; defaults to Date.now(). */
  nowMs?: number
}

/**
 * Verify a Zoom webhook event signature. Returns:
 *   - the parsed body's event string is NOT inspected here (caller does that);
 *   - true only when the recomputed `v0=<hmac>` equals the x-zm-signature header
 *     (constant-time) and the timestamp is within tolerance (when provided).
 * When no secret is configured this returns false — the route decides the fail-open/closed
 * policy (fail-closed in production, open only in non-prod for local testing).
 */
export function verifyZoomSignature(inp: ZoomVerifyInput): boolean {
  const secret = inp.secret ?? zoomWebhookSecret()
  if (!secret) return false
  if (!inp.signature || !inp.timestamp) return false

  // Optional replay-window check (Zoom recommends rejecting stale timestamps).
  if (inp.toleranceSeconds && inp.toleranceSeconds > 0) {
    const ts = Number.parseInt(inp.timestamp, 10)
    const now = inp.nowMs ?? Date.now()
    if (!Number.isFinite(ts)) return false
    if (Math.abs(now / 1000 - ts) > inp.toleranceSeconds) return false
  }

  const message = `v0:${inp.timestamp}:${inp.rawBody}`
  const expected = `v0=${createHmac('sha256', secret).update(message).digest('hex')}`

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(inp.signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
