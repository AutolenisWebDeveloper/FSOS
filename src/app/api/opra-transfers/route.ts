import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { OpraTrackSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OPRA Transfer Center — start tracking a one-policy household as an OPRA case.
// Rebuilt natively on the household spine (App A parity). Not a securities system:
// a securities-flagged policy is surfaced with is_security carried through, but is
// never enrolled in automated outreach (§2.1); the toggles here are manual.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OpraTrackSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const { data: household } = await db
      .from('households')
      .select('id, referring_agency_id')
      .eq('id', v.data.household_id)
      .maybeSingle()
    if (!household) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

    // Resolve the household's single active policy (or the one passed) for premium
    // + securities flag. The eligibility view guarantees exactly one active policy.
    const policyQuery = db
      .from('household_policies')
      .select('id, premium, effective_date, is_security')
      .eq('household_id', v.data.household_id)
      .eq('status', 'active')
    const { data: policy } = v.data.policy_id
      ? await policyQuery.eq('id', v.data.policy_id).maybeSingle()
      : await policyQuery.order('created_at').limit(1).maybeSingle()

    // Idempotent: one live tracked case per household (enforced by a unique index).
    const { data: existing } = await db
      .from('opra_transfers')
      .select('id')
      .eq('household_id', v.data.household_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, id: existing.id, already: true })

    const { data: row, error } = await db
      .from('opra_transfers')
      .insert({
        household_id: v.data.household_id,
        policy_id: policy?.id ?? null,
        referring_agency_id: household.referring_agency_id ?? null,
        annual_premium: policy?.premium ?? null,
        transfer_date: policy?.effective_date ?? null,
        is_security: policy?.is_security ?? false,
        status: 'identified',
        owner_scope: auth.session.userId ?? null,
      })
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await db.from('activities').insert({
      entity_type: 'household',
      entity_id: v.data.household_id,
      kind: 'opra_identify',
      note: 'Household added to the OPRA Transfer Center for review tracking.',
      actor,
    })
    await writeAudit({ actor, action: 'entity.created', entity: 'opra_transfer', entityId: row?.id ?? null, diff: { household_id: v.data.household_id } })

    return NextResponse.json({ ok: true, id: row?.id ?? null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to track OPRA case' }, { status: 500 })
  }
}
