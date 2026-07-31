import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { recordConsentChange } from '@/lib/comms/consent-events'
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

    // Update every member of this household on the channel. Read the prior status first so
    // each consent change records its true previous→new transition (audit + CRM timeline).
    const { data: members } = await db
      .from('household_members')
      .select('id, email, phone, consents(channel, status)')
      .eq('household_id', householdId)
    for (const m of members ?? []) {
      const prior = (m as { consents?: { channel: string; status: string }[] }).consents?.find(
        (c) => c.channel === v.data.channel,
      )
      await db.from('consents').upsert({ member_id: m.id, household_id: householdId, channel: v.data.channel, status: v.data.status, source: 'client_portal', captured_at: new Date().toISOString() }, { onConflict: 'member_id,channel' })
      // Revocation → add to DNC so the gate blocks before the next send anywhere.
      if (v.data.status === 'revoked') {
        const contact = v.data.channel === 'email' ? m.email : m.phone
        if (contact) await db.from('dnc_entries').upsert({ contact, channel: v.data.channel === 'call' ? 'call' : v.data.channel, scope: 'internal', reason: 'client opt-out' }, { onConflict: 'contact,channel' })
      }
      // ONE consent-logging path → audit_log AND the CRM timeline (§C).
      await recordConsentChange({
        actor,
        channel: v.data.channel,
        newStatus: v.data.status,
        previousStatus: (prior?.status as 'granted' | 'revoked' | undefined) ?? 'none',
        source: 'client_portal',
        reason: 'client self-service preference change',
        memberId: m.id,
        householdId,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
