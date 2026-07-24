// src/lib/comms/tracking.ts
// Email open + click tracking. For an outbound email tied to a comm_messages row
// we (1) append a 1×1 tracking pixel that hits /api/track/open/<id>, and (2)
// rewrite each <a href> to route through /api/track/click/<id> so the click is
// recorded before redirecting to the real destination. Both endpoints append a
// comm_message_events row (opened/clicked) and advance the message lifecycle.
//
// Tracking is best-effort telemetry, never a gate: it does not alter deliverability
// and adds only the pixel + link wrapper to already-approved, gate-passed content.

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC secret for signing click-redirect targets so the redirector cannot be abused
 * as an open redirect (§13.8): only a URL FSOS itself embedded (and signed) will be
 * redirected to. Reuses the internal API secret; a dedicated secret can override it.
 */
function signingSecret(): string | null {
  return process.env.FSOS_TRACKING_SECRET || process.env.FSOS_API_SECRET || null
}

/** Signature binding a redirect target to its message id (empty when no secret configured). */
export function signRedirect(messageId: string, url: string): string {
  const secret = signingSecret()
  if (!secret) return ''
  return createHmac('sha256', secret).update(`${messageId}\n${url}`).digest('hex')
}

function signaturesMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/** Absolute app base URL for building tracking links (env-configurable). */
export function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    ''
  return raw.replace(/\/$/, '')
}

/** The 1×1 transparent GIF served by the open-tracking pixel endpoint. */
export const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

function pixelTag(base: string, messageId: string): string {
  return `<img src="${base}/api/track/open/${messageId}" alt="" width="1" height="1" style="display:none" />`
}

/**
 * Instrument an outbound email HTML body with open + click tracking for a message.
 * No base URL configured → returns the body unchanged (tracking simply off).
 */
export function instrumentEmailHtml(html: string, messageId: string): string {
  const base = appBaseUrl()
  if (!base || !messageId) return html

  // Rewrite absolute http(s) links to route through the click tracker. The target is
  // HMAC-signed and bound to this messageId so the redirector accepts only URLs FSOS
  // itself embedded — never an attacker-supplied destination (open-redirect defense).
  const rewritten = html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m, url: string) => {
    // Never wrap the tracking/unsubscribe endpoints themselves.
    if (url.includes('/api/track/')) return `href="${url}"`
    const sig = signRedirect(messageId, url)
    const wrapped = `${base}/api/track/click/${messageId}?u=${encodeURIComponent(url)}${sig ? `&s=${sig}` : ''}`
    return `href="${wrapped}"`
  })

  const pixel = pixelTag(base, messageId)
  // Insert the pixel just before </body> if present, else append.
  return /<\/body>/i.test(rewritten)
    ? rewritten.replace(/<\/body>/i, `${pixel}</body>`)
    : rewritten + pixel
}

/**
 * Validate a click-tracking target so the redirector can't be an open proxy (§13.8).
 * Rejects non-http(s) schemes AND, when a signing secret is configured, requires the
 * HMAC signature bound to this messageId to match — so only a URL FSOS itself embedded
 * is honored. When no secret is configured (local/dev), falls back to scheme-only.
 */
export function safeRedirectTarget(
  raw: string | null,
  verify?: { messageId: string; sig: string | null },
): string | null {
  if (!raw) return null
  let normalized: string
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    normalized = u.toString()
  } catch {
    return null
  }
  // Signature enforcement (open-redirect defense). Only enforced when a secret exists;
  // the signature is computed over the ORIGINAL param value the link carried.
  if (signingSecret()) {
    if (!verify) return null
    const expected = signRedirect(verify.messageId, raw)
    if (!signaturesMatch(expected, verify.sig ?? '')) return null
  }
  return normalized
}
