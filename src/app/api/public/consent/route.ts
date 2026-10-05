import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { writeAudit } from '@/lib/audit/log'
import { consentContactKey } from '@/lib/comms/contact-consent'
import { armDncEntry } from '@/lib/comms/opt-out'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC, UNAUTHENTICATED do-not-contact / opt-out endpoint. Honors a request to
// stop contact by adding the contact to the internal DNC list (comms dispatcher §7).
const ConsentOptOutSchema = z.object({
  contact: z.string().trim().min(3, 'Enter a valid email or phone').max(200),
  channel: z.enum(['call', 'sms', 'email', 'all']),
  action: z.literal('opt_out'),
})

export async function POST(req: NextRequest) {
  // Blunt floods without blocking a genuine opt-out: a generous per-IP cap (opt-out
  // is a consumer-protection action, so the limit is looser than other public forms).
  if (!rateLimit(`consent:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  const v = ConsentOptOutSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = 'public'

    // Evidence FIRST, then the DNC re-arm — armDncEntry's own order (follow-up R5), so a START that
    // runs between the two writes already sees this opt-out's evidence and cannot lift the row.
    // Keep the durable per-contact consent store consistent with the opt-out. The ENFORCED
    // revocation is the dnc_entries write below (checked at gate step `dnc` for every send);
    // this appends a matching `revoked` action so comm_contact_consents reflects the latest
    // decision too (latest-wins). SMS/email get a normalized-contact row; 'all' revokes both.
    const revokeChannels =
      v.data.channel === 'all' ? (['sms', 'email'] as const) : v.data.channel === 'call' ? [] : ([v.data.channel] as const)
    if (revokeChannels.length) {
      // CHECKED: this evidence row is what keeps a later bare START from lifting a STOP-labelled row
      // this opt-out re-armed (inbound.ts applyOptIn). A lost row must fail the request, not succeed.
      const { error: evidenceError } = await db.from('comm_contact_consents').insert(
        revokeChannels.map((ch) => ({
          contact: consentContactKey(ch, v.data.contact),
          channel: ch,
          action: 'revoked',
          consent_text: 'Public opt-out request',
          consent_version: 'opt-out',
          source_url: 'https://www.markistfsa.com/optout',
        })),
      )
      if (evidenceError) return dbErrorResponse('public/consent evidence', evidenceError)
    }

    // The internal DNC list, through the shared writer: an existing row keeps its first reason (never
    // relabelled) and is RE-ARMED if a bare START had lifted it. The key is normalized exactly as the
    // gate reads it — a mixed-case email or a punctuated phone stored raw never matched the send.
    // This route writes its own contact-level evidence rows below, so the writer adds none.
    const dncKey = consentContactKey(v.data.contact.includes('@') ? 'email' : 'sms', v.data.contact)
    const dnc = await armDncEntry({ contact: dncKey, channel: v.data.channel, reason: 'public opt-out', evidence: false })
    if (!dnc.ok) return dbErrorResponse('public/consent', { message: dnc.error ?? 'DNC write failed' })

    await writeAudit({
      actor,
      action: 'consent.revoked',
      entity: 'dnc',
      diff: { contact_masked: v.data.contact.slice(0, 3) + '***', channel: v.data.channel },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
