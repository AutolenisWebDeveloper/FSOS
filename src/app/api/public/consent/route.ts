import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit/log'

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
      if (!conflict) return NextResponse.json({ error: error.message }, { status: 500 })
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
