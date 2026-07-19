// src/lib/http/rate-limit.ts
// A best-effort in-memory fixed-window rate limiter for PUBLIC endpoints
// (client forms, workshop registration). Serverless instances are ephemeral, so
// this is a labeled first line of defense — not a distributed guarantee. It blunts
// naive submission floods without external infra; pair it with the honeypot and
// the readJson size cap. A durable limiter (Upstash/Redis) is the production
// upgrade, wired at /super/integrations when available.

interface Window {
  count: number
  resetAt: number
}

const buckets = new Map<string, Window>()

/**
 * Returns true when the caller is WITHIN the limit (allowed), false when it has
 * exceeded `max` requests in the `windowMs` window for this key.
 */
export function rateLimit(key: string, max = 5, windowMs = 60_000): boolean {
  const now = Date.now()
  const w = buckets.get(key)
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    // Opportunistic cleanup so the map can't grow unbounded on a long-lived instance.
    if (buckets.size > 5000) {
      Array.from(buckets.keys()).forEach((k) => {
        const b = buckets.get(k)
        if (b && now >= b.resetAt) buckets.delete(k)
      })
    }
    return true
  }
  if (w.count >= max) return false
  w.count += 1
  return true
}

/** Extract a best-effort client IP for keying the limiter. */
export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  )
}
