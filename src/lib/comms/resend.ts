// src/lib/comms/resend.ts
// Resend webhook signature verification. Resend delivers events (email.sent,
// email.delivered, email.opened, email.clicked, email.bounced, email.complained)
// signed with the Svix scheme: headers svix-id, svix-timestamp, svix-signature,
// and secret RESEND_WEBHOOK_SECRET ("whsec_<base64>"). The signature is
// base64( HMAC-SHA256( secretBytes, `${id}.${timestamp}.${body}` ) ), and the
// svix-signature header may carry several space-separated "v1,<sig>" values.
//
// Unset secret → fail OPEN only in non-production (local testing); production
// rejects unverifiable requests.

import { createHmac, timingSafeEqual } from 'crypto'

export function verifyResendSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET || process.env.SVIX_WEBHOOK_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'

  const id = headers.get('svix-id') || headers.get('webhook-id')
  const timestamp = headers.get('svix-timestamp') || headers.get('webhook-timestamp')
  const sigHeader = headers.get('svix-signature') || headers.get('webhook-signature')
  if (!id || !timestamp || !sigHeader) return false

  const key = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let keyBytes: Buffer
  try {
    keyBytes = Buffer.from(key, 'base64')
  } catch {
    keyBytes = Buffer.from(key, 'utf8')
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = createHmac('sha256', keyBytes).update(signedContent, 'utf8').digest('base64')

  // Header form: "v1,<sig1> v1,<sig2>". Compare against each candidate.
  for (const part of sigHeader.split(' ')) {
    const sig = part.includes(',') ? part.split(',')[1] : part
    const a = Buffer.from(expected)
    const b = Buffer.from(sig)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}
