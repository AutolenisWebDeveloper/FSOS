import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { writeAudit } from '@/lib/audit/log'
import { householdIdFor } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Schema = z.object({ channel: z.enum(['call', 'sms', 'email']), status: z.enum(['granted', 'revoked']) })

// P-5 client consent management. A client may only manage THEIR OWN household's
// consent (RLS-aligned). Revocation is instant + global — it updates consents AND
// adds a DNC entry so it is authoritative over every campaign/agent before the next
// send (WF-9 invariant: re-checked at send time).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('client')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const householdId = await householdIdFor(auth.session)
    if (!householdId) return NextResponse.json({ error: 'No household scope.' }, { status: 403 })

    // Update every member of this household on the channel.
    const { data: members } = await db.from('household_members').select('id, email, phone').eq('household_id', householdId)
    for (const m of members ?? []) {
      await db.from('consents').upsert({ member_id: m.id, household_id: householdId, channel: v.data.channel, status: v.data.status, source: 'client_portal', captured_at: new Date().toISOString() }, { onConflict: 'member_id,channel' })
      // Revocation → add to DNC so the gate blocks before the next send anywhere.
      if (v.data.status === 'revoked') {
        const contact = v.data.channel === 'email' ? m.email : m.phone
        if (contact) await db.from('dnc_entries').upsert({ contact, channel: v.data.channel === 'call' ? 'call' : v.data.channel, scope: 'internal', reason: 'client opt-out' }, { onConflict: 'contact,channel' })
      }
    }
    await writeAudit({ actor, action: v.data.status === 'revoked' ? 'consent.revoked' : 'consent.captured', entity: 'household', entityId: householdId, diff: { channel: v.data.channel, source: 'client_portal' } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
