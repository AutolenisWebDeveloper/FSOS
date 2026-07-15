import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { ReferralCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { agencyIdsFor } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-4 Submit Referral. Creates a referral attributed to THIS owner's agency, with
// consent capture; notifies the FSA; starts the SLA clock. source=partner_portal.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('partner')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReferralCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid referral', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const agencyIds = await agencyIdsFor(auth.session)
    const agencyId = agencyIds[0] ?? null // attribute to the owner's agency
    if (!agencyId) return NextResponse.json({ error: 'No agency scope for this account.' }, { status: 403 })

    const slaDue = new Date(Date.now() + 24 * 3600 * 1000).toISOString() // 24h SLA floor
    const { data, error } = await db
      .from('referrals')
      .insert({ referring_agency_id: agencyId, referred_name: v.data.referred_name, referred_email: v.data.referred_email ?? null, referred_phone: v.data.referred_phone ?? null, engagement: v.data.engagement, status: 'received', received_at: new Date().toISOString(), sla_due_at: slaDue })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    // Consent capture at intake (source = partner_portal). No member yet → household-less consent note.
    if (v.data.consent_sms || v.data.consent_email) {
      await db.from('activities').insert({ entity_type: 'referral', entity_id: data.id, kind: 'consent_capture', note: `Consent at intake: ${[v.data.consent_sms && 'sms', v.data.consent_email && 'email'].filter(Boolean).join(', ')} (source=partner_portal)`, actor })
      await writeAudit({ actor, action: 'consent.captured', entity: 'referral', entityId: data.id, diff: { source: 'partner_portal', sms: v.data.consent_sms, email: v.data.consent_email } })
    }
    await writeAudit({ actor, action: 'entity.created', entity: 'referral', entityId: data.id, diff: { source: 'partner_portal', agency_id: agencyId } })
    return NextResponse.json({ referral: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
