// src/lib/comms/twilio.ts
// Twilio inbound-webhook signature verification. Twilio signs each request with
// X-Twilio-Signature = base64( HMAC-SHA1( authToken, url + sortedParamsConcat ) ),
// where the params are the POST body fields sorted by key and concatenated as
// key+value. We reconstruct that string and compare in constant time.
//
// When TWILIO_AUTH_TOKEN is unset we fail OPEN only in non-production (local
// testing); in production an unverifiable request is rejected.

import { createHmac, timingSafeEqual } from 'crypto'

export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token) return process.env.NODE_ENV !== 'production'
  if (!signature) return false

  // url + each sorted (key + value), no separators — the documented scheme.
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)

  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** TwiML that replies with one message — used ONLY for the carrier-required HELP
 *  auto-response (WS-033). A TwiML reply is the standards-compliant mechanism: it is a
 *  direct response to the inbound message, delivered regardless of opt-out state, and
 *  it is not an outbound API send (so it is not a second send path). */
export function messageTwiml(body: string): string {
  const esc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`
}

/** Minimal empty TwiML response body (we reply asynchronously, not inline). */
export function emptyTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
}

/** Build the public URL Twilio signed against (respecting the forwarded host). */
export function requestUrl(req: { url: string; headers: Headers }): string {
  try {
    const u = new URL(req.url)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '')
    if (host) return `${proto}://${host}${u.pathname}${u.search}`
    return req.url
  } catch {
    return req.url
  }
}
