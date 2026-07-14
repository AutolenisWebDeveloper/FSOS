import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { ReferralCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC, UNAUTHENTICATED referral intake (the agency/self-referral surface).
// Staff-entered referrals use the auth-gated /api/referrals. This endpoint never
// leaks the created referral id back to the caller and never collects securities data.
const SLA_HOURS = 24

export async function POST(req: NextRequest) {
  const parsed = await readJson<Record<string, unknown>>(req)
  if ('error' in parsed) return parsed.error

  // Honeypot: bots fill the hidden `company` field. Silently accept without writing.
  if (typeof parsed.data.company === 'string' && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const v = ReferralCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid referral', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = 'public'
    const now = new Date()
    const slaDue = new Date(now.getTime() + SLA_HOURS * 3600000)

    const { data: referral, error } = await db
      .from('referrals')
      .insert({
        referred_name: v.data.referred_name,
        referring_agency_id: v.data.referring_agency_id ?? null,
        engagement: v.data.engagement,
        referred_email: v.data.referred_email ?? null,
        referred_phone: v.data.referred_phone ?? null,
        status: 'received',
        received_at: now.toISOString(),
        sla_due_at: slaDue.toISOString(),
        owner_scope: actor,
      })
      .select('id')
      .single()
    if (error || !referral) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    // Consent intent captured at intake (materialized as consents rows on convert,
    // once a member exists). Logged now for the compliance trail.
    if (v.data.consent_sms || v.data.consent_email) {
      const channels = [v.data.consent_sms ? 'sms' : null, v.data.consent_email ? 'email' : null].filter(Boolean)
      await db.from('activities').insert({
        entity_type: 'referral',
        entity_id: referral.id,
        kind: 'consent_intent',
        note: `Consent captured at public intake: ${channels.join(', ')}`,
        actor,
      })
      await writeAudit({ actor, action: 'consent.captured', entity: 'referral', entityId: referral.id, diff: { channels } })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'referral',
      entityId: referral.id,
      diff: { source: 'public', engagement: v.data.engagement },
    })

    // Do NOT leak the referral id to the public caller.
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to submit referral' }, { status: 500 })
  }
}
