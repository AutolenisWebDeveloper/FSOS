// src/app/api/comms/unsubscribe/route.ts
// PUBLIC one-click unsubscribe (RFC 8058) — the target of the List-Unsubscribe /
// List-Unsubscribe-Post header and the emailed per-recipient opt-out link.
//
//   • POST → the mail client's one-click opt-out (List-Unsubscribe=One-Click). Verifies
//     the signed token, suppresses via the enforced DNC store, returns 200. No body/JS.
//   • GET  → a human clicking the footer link: suppress, then redirect to the friendly
//     /unsubscribe confirmation page (still token-gated when a secret is configured).
//
// Suppression flows through the single shared path (suppressContact → dnc_entries), so an
// opt-out here actually blocks future sends at gate step 3 — not just a cosmetic flag.
// Responds success-shaped whether or not the contact exists, so the endpoint can't enumerate the
// book — but an opt-out whose enforced write FAILED answers 503 (follow-up R5): the mail client or
// the person retries, instead of being told it worked.

import { NextRequest, NextResponse } from 'next/server'
import { suppressContact, verifyOneClick, type UnsubChannel } from '@/lib/comms/unsubscribe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parse(req: NextRequest): { contact: string; channel: UnsubChannel; token: string | null } {
  const sp = req.nextUrl.searchParams
  const contact = (sp.get('c') || '').trim()
  const chRaw = (sp.get('ch') || 'all').toLowerCase()
  const channel: UnsubChannel = chRaw === 'email' ? 'email' : chRaw === 'sms' ? 'sms' : 'all'
  return { contact, channel, token: sp.get('t') }
}

export async function POST(req: NextRequest) {
  const { contact, channel, token } = parse(req)
  // One-click is header-driven (no human step) → require a valid signed token when a
  // secret is configured, so the endpoint can't be abused to suppress arbitrary contacts.
  if (contact && verifyOneClick(contact, channel, token)) {
    const res = await suppressContact(contact, channel)
    if (!res.ok) return NextResponse.json({ error: 'Could not record the opt-out. Please try again.' }, { status: 503 })
  }
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const { contact, channel, token } = parse(req)
  if (contact && verifyOneClick(contact, channel, token)) {
    const res = await suppressContact(contact, channel)
    if (!res.ok) {
      return new NextResponse(
        '<!doctype html><meta charset="utf-8"><title>Unsubscribe not completed</title>' +
          '<p>We could not record your unsubscribe just now. Please use the link again in a few minutes.</p>',
        { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '60' } },
      )
    }
  }
  // Land on the friendly confirmation page (prefilled) regardless, so a human always sees
  // a clear outcome and can adjust channels.
  const url = new URL('/unsubscribe', req.nextUrl.origin)
  if (contact) url.searchParams.set('c', contact)
  url.searchParams.set('ch', channel)
  url.searchParams.set('done', '1')
  return NextResponse.redirect(url, 303)
}
