import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { writeAudit } from '@/lib/audit/log'
import { consentContactKey } from '@/lib/comms/contact-consent'

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

    // Upsert into the internal DNC list. If a conflict arises (already listed),
    // ignore it — the opt-out is idempotent from the caller's perspective.
    const { error } = await db
      .from('dnc_entries')
      .upsert(
        { contact: v.data.contact, channel: v.data.channel, scope: 'internal', reason: 'public opt-out' },
        { onConflict: 'contact,channel', ignoreDuplicates: true },
      )
    if (error) {
      // A conflict on a constraint we can't upsert against is not fatal — the goal
      // (contact is on the list) is still met. Other errors surface as 500.
      const conflict = /duplicate|conflict|unique/i.test(error.message)
      if (!conflict) return dbErrorResponse('public/consent', error)
    }

    // Keep the durable per-contact consent store consistent with the opt-out. The ENFORCED
    // revocation is the dnc_entries write above (checked at gate step `dnc` for every send);
    // this appends a matching `revoked` action so comm_contact_consents reflects the latest
    // decision too (latest-wins). SMS/email get a normalized-contact row; 'all' revokes both.
    const revokeChannels =
      v.data.channel === 'all' ? (['sms', 'email'] as const) : v.data.channel === 'call' ? [] : ([v.data.channel] as const)
    if (revokeChannels.length) {
      await db.from('comm_contact_consents').insert(
        revokeChannels.map((ch) => ({
          contact: consentContactKey(ch, v.data.contact),
          channel: ch,
          action: 'revoked',
          consent_text: 'Public opt-out request',
          consent_version: 'opt-out',
          source_url: 'https://www.markistfsa.com/optout',
        })),
      )
    }

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
