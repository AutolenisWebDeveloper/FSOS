import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ReferralCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SLA floor for speed-to-lead (config default). Referral is "breached" if untouched
// after this window. Editable in a later phase; conservative default here.
const SLA_HOURS = 24

// GET /api/referrals — inbox rows. POST — staff-entered referral (public intake
// uses /api/public/refer). RBAC: create = fsa/licensed_staff/super.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('referrals')
      .select('*')
      .is('deleted_at', null)
      .order('sla_due_at', { ascending: true, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ referrals: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReferralCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid referral', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const now = new Date()
    const slaDue = new Date(now.getTime() + SLA_HOURS * 3600000)

    const { data: referral, error } = await db
      .from('referrals')
      .insert({
        referred_name: v.data.referred_name,
        referred_email: v.data.referred_email ?? null,
        referred_phone: v.data.referred_phone ?? null,
        referring_agency_id: v.data.referring_agency_id ?? null,
        engagement: v.data.engagement,
        status: 'received',
        received_at: now.toISOString(),
        sla_due_at: slaDue.toISOString(),
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !referral) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    // Consent intent captured at intake (materialized as real consents rows on
    // convert, once a member exists). Logged now for the compliance trail.
    if (v.data.consent_sms || v.data.consent_email) {
      const channels = [v.data.consent_sms ? 'sms' : null, v.data.consent_email ? 'email' : null].filter(Boolean)
      await db.from('activities').insert({
        entity_type: 'referral',
        entity_id: referral.id,
        kind: 'consent_intent',
        note: `Consent captured at intake: ${channels.join(', ')}`,
        actor,
      })
      await writeAudit({ actor, action: 'consent.captured', entity: 'referral', entityId: referral.id, diff: { channels } })
    }

    // SLA task + FSA notification (speed-to-lead).
    await db.from('work_tasks').insert({
      title: `First touch: ${referral.referred_name ?? 'referral'}`,
      entity_type: 'referral',
      entity_id: referral.id,
      source: 'workflow',
      due_at: slaDue.toISOString(),
      owner_scope: actor,
    })
    await db.from('notifications').insert({
      user_id: actor,
      kind: 'referral_new',
      title: 'New referral received',
      body: referral.referred_name ?? 'A new referral is awaiting first touch.',
      link: `/app/referrals/${referral.id}`,
    })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'referral',
      entityId: referral.id,
      diff: { referred_name: referral.referred_name, engagement: referral.engagement },
    })
    return NextResponse.json({ referral }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create referral' }, { status: 500 })
  }
}
