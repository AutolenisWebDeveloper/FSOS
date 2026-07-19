import { NextRequest, NextResponse } from 'next/server'
import { verifyResendSignature } from '@/lib/comms/resend'
import { processInbound } from '@/lib/comms/inbound'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/email/inbound
// ─────────────────────────────────────────────────────────────────────────
// Inbound EMAIL replies. Provider-flexible so it works with Resend inbound, a
// mail worker, or SendGrid Inbound Parse: authorize by EITHER the Resend/Svix
// signature OR a shared bearer secret (EMAIL_INBOUND_SECRET). The payload is
// normalized to { from, subject, text }, then threaded into the contact's
// conversation (auto-associated), recorded in full history, and — if the thread
// has AI auto-reply enabled and is not securities-flagged — answered via the gate.
// ─────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>

function authorized(raw: string, req: NextRequest): boolean {
  const secret = process.env.EMAIL_INBOUND_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const headerSecret = req.headers.get('x-inbound-secret') || ''
    if (auth === `Bearer ${secret}` || headerSecret === secret) return true
  }
  // Fall back to the Resend/Svix signature (Resend inbound uses the same scheme).
  if (verifyResendSignature(raw, req.headers)) return true
  // Non-prod with nothing configured → allow for local testing.
  return !secret && process.env.NODE_ENV !== 'production'
}

function pick(obj: Any, ...keys: string[]): string | null {
  for (const k of keys) {
    let cur: unknown = obj
    for (const part of k.split('.')) {
      cur = cur && typeof cur === 'object' ? (cur as Any)[part] : undefined
    }
    if (typeof cur === 'string' && cur.trim()) return cur
  }
  return null
}

// Extract a bare email address from a possibly-formatted "Name <a@b.com>" header.
function bareEmail(input: string | null): string | null {
  if (!input) return null
  const m = input.match(/<([^>]+)>/)
  const addr = (m ? m[1] : input).trim().toLowerCase()
  return /.+@.+\..+/.test(addr) ? addr : null
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!authorized(raw, req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Any
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resend inbound nests under `data`; flat providers post at the top level.
  const d: Any = payload.data ?? payload
  const from = bareEmail(pick(d, 'from', 'from.email', 'sender', 'envelope.from'))
  const subject = pick(d, 'subject') ?? null
  const body = pick(d, 'text', 'text_body', 'plain', 'stripped-text', 'html') ?? ''
  const providerId = pick(d, 'email_id', 'message_id', 'id', 'MessageID')

  if (!from) {
    return NextResponse.json({ received: true, skipped: 'no sender' })
  }

  try {
    const r = await processInbound({ channel: 'email', from, body, subject, provider: 'resend', providerId })
    return NextResponse.json({ received: true, conversation_id: r.conversationId })
  } catch (err) {
    console.error('[email:inbound] handler error:', err)
    return NextResponse.json({ received: true, error: 'handler error logged' })
  }
}
