import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { RegistrationPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SLA_HOURS = 24

// PATCH /api/workshops/registrations/[id] — mark attendance and/or convert an
// attendee into a referral (docs/legacy-port.md §2.5: "convert attendee to
// referral/household"). Converting seeds the referral spine and starts the SLA
// clock. Roles: fsa, licensed_staff, admin.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = RegistrationPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: reg, error: rErr } = await db
      .from('workshop_registrations')
      .select('reg_id, workshop_id, name, email, phone, consent_channels, referral_id, status, attended')
      .eq('reg_id', params.id)
      .maybeSingle()
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
    if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

    const update: Record<string, unknown> = {}
    if (typeof v.data.attended === 'boolean') update.attended = v.data.attended

    let referralId: string | null = reg.referral_id ?? null
    if (v.data.convert_to_referral && !referralId) {
      const now = new Date()
      const { data: ref, error: refErr } = await db
        .from('referrals')
        .insert({
          referred_name: reg.name ?? 'Workshop attendee',
          referred_email: reg.email ?? null,
          referred_phone: reg.phone ?? null,
          engagement: 'direct',
          status: 'received',
          received_at: now.toISOString(),
          sla_due_at: new Date(now.getTime() + SLA_HOURS * 3600000).toISOString(),
          owner_scope: actor,
        })
        .select('id')
        .single()
      if (refErr || !ref) return NextResponse.json({ error: refErr?.message ?? 'Convert failed' }, { status: 500 })
      referralId = ref.id
      update.referral_id = referralId
      update.status = 'converted'

      // Carry the captured consent forward as a compliance-trail activity on the referral.
      const channels = Array.isArray(reg.consent_channels) ? (reg.consent_channels as string[]) : []
      if (channels.length > 0) {
        await db.from('activities').insert({
          entity_type: 'referral',
          entity_id: referralId,
          kind: 'consent_intent',
          note: `Consent captured at workshop registration: ${channels.join(', ')}`,
          actor,
        })
        await writeAudit({ actor, action: 'consent.captured', entity: 'referral', entityId: referralId, diff: { source: 'workshop', channels } })
      }
      await writeAudit({ actor, action: 'entity.created', entity: 'referral', entityId: referralId, diff: { source: 'workshop', registration_id: reg.reg_id } })
    }

    if (Object.keys(update).length > 0) {
      const { error: uErr } = await db.from('workshop_registrations').update(update).eq('reg_id', reg.reg_id)
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
      await writeAudit({ actor, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: update })
    }

    return NextResponse.json({ ok: true, referral_id: referralId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update registration' }, { status: 500 })
  }
}
