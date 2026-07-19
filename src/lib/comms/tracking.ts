// src/lib/comms/tracking.ts
// Email open + click tracking. For an outbound email tied to a comm_messages row
// we (1) append a 1×1 tracking pixel that hits /api/track/open/<id>, and (2)
// rewrite each <a href> to route through /api/track/click/<id> so the click is
// recorded before redirecting to the real destination. Both endpoints append a
// comm_message_events row (opened/clicked) and advance the message lifecycle.
//
// Tracking is best-effort telemetry, never a gate: it does not alter deliverability
// and adds only the pixel + link wrapper to already-approved, gate-passed content.

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

  // Rewrite absolute http(s) links to route through the click tracker.
  const rewritten = html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m, url: string) => {
    // Never wrap the tracking/unsubscribe endpoints themselves.
    if (url.includes('/api/track/')) return `href="${url}"`
    const wrapped = `${base}/api/track/click/${messageId}?u=${encodeURIComponent(url)}`
    return `href="${wrapped}"`
  })

  const pixel = pixelTag(base, messageId)
  // Insert the pixel just before </body> if present, else append.
  return /<\/body>/i.test(rewritten)
    ? rewritten.replace(/<\/body>/i, `${pixel}</body>`)
    : rewritten + pixel
}

/** Validate a click-tracking target so the redirector can't be an open proxy. */
export function safeRedirectTarget(raw: string | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}
