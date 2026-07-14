import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf, hasSecuritiesScope } from '@/lib/auth/api'
import { ReferralConvertSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { assertNotSecuritiesSystemOfRecord, FirewallError } from '@/lib/compliance/firewall'
import { dobKey } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/referrals/[id]/convert 🛡 — the WF-1 spine step:
//   Referral → Household (match/create) → Opportunity, with audit at each step.
// Guards: securities firewall (no substantive securities data may be written; a
// securities product requires FSA securities scope, else block + escalate) and
// idempotency (retry must not create a duplicate household/opportunity).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReferralConvertSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid conversion', details: v.error.flatten() }, { status: 400 })

  try {
    assertNotSecuritiesSystemOfRecord(v.data)
  } catch (e) {
    if (e instanceof FirewallError) return NextResponse.json({ error: e.message, reason: 'firewall' }, { status: 422 })
    throw e
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const { data: referral } = await db
      .from('referrals')
      .select('*')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!referral) return NextResponse.json({ error: 'Referral not found' }, { status: 404 })

    // ── Idempotency: an already-converted referral returns its existing opportunity.
    if (referral.status === 'converted') {
      const { data: existing } = await db
        .from('opportunities')
        .select('id, household_id')
        .eq('referral_id', params.id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ opportunity_id: existing.id, household_id: existing.household_id, idempotent: true })
      }
    }

    // ── Securities scope gate (rbac override, evaluated before the write).
    let isSecurity = false
    let licenseBasis: string | null = null
    if (v.data.product_id) {
      const { data: product } = await db
        .from('products')
        .select('is_security, required_license')
        .eq('id', v.data.product_id)
        .maybeSingle()
      isSecurity = product?.is_security === true
      licenseBasis = product?.required_license ?? null
    }
    if (isSecurity && !hasSecuritiesScope(auth.session)) {
      // Block + escalate to the human FSA queue (never silently drop).
      await db.from('compliance_events').insert({
        kind: 'firewall',
        actor,
        entity_type: 'referral',
        entity_id: params.id,
        blocked_step: 'securities_scope',
        reason: 'Actor lacks securities registration to create a securities opportunity.',
      })
      await db.from('agent_actions').insert({
        kind: 'escalation',
        actor,
        outcome: 'escalated',
        target_type: 'referral',
        target_id: params.id,
        reason: 'securities scope',
        note: 'Securities opportunity requires an FFS-approved channel; routed to human FSA.',
      })
      await writeAudit({ actor, action: 'firewall.blocked', entity: 'referral', entityId: params.id, diff: { step: 'securities_scope' } })
      return NextResponse.json(
        { error: 'Securities product requires securities scope. Escalated to the FSA.', reason: 'securities_scope' },
        { status: 403 },
      )
    }

    // ── Step 1: match or create household (dedupe on member email/phone).
    let householdId = v.data.household_id ?? null
    let createdHousehold = false
    if (!householdId && (v.data.member_email || v.data.member_phone)) {
      const or = [
        v.data.member_email ? `email.eq.${v.data.member_email}` : null,
        v.data.member_phone ? `phone.eq.${v.data.member_phone}` : null,
      ]
        .filter(Boolean)
        .join(',')
      const { data: match } = await db
        .from('household_members')
        .select('household_id')
        .is('deleted_at', null)
        .or(or)
        .limit(1)
        .maybeSingle()
      if (match?.household_id) householdId = match.household_id
    }
    if (!householdId) {
      const { data: hh, error: hhErr } = await db
        .from('households')
        .insert({ primary_name: v.data.primary_name, referring_agency_id: referral.referring_agency_id, owner_scope: actor })
        .select('id')
        .single()
      if (hhErr || !hh) return NextResponse.json({ error: hhErr?.message ?? 'Household create failed' }, { status: 500 })
      householdId = hh.id
      createdHousehold = true
      await writeAudit({ actor, action: 'entity.created', entity: 'household', entityId: householdId, diff: { primary_name: v.data.primary_name, from_referral: params.id } })
    }

    // ── Step 2: member (encrypted DOB via RPC) + consent rows for granted channels.
    const { data: memberId, error: memErr } = await db.rpc('member_create', {
      p_household_id: householdId,
      p_full_name: v.data.member_full_name,
      p_relationship: 'primary',
      p_dob: v.data.member_dob ?? null,
      p_email: v.data.member_email ?? null,
      p_phone: v.data.member_phone ?? null,
      p_key: dobKey(),
    })
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'household_member', entityId: (memberId as string) ?? null, diff: { household_id: householdId } })

    const consentChannels: string[] = []
    if (v.data.member_consent_sms) consentChannels.push('sms')
    if (v.data.member_consent_email) consentChannels.push('email')
    for (const channel of consentChannels) {
      await db
        .from('consents')
        .upsert(
          { member_id: memberId as string, household_id: householdId, channel, status: 'granted', source: 'referral_convert' },
          { onConflict: 'member_id,channel' },
        )
    }
    if (consentChannels.length) {
      await writeAudit({ actor, action: 'consent.captured', entity: 'household_member', entityId: (memberId as string) ?? null, diff: { channels: consentChannels } })
    }

    // ── Step 3: opportunity with full attribution (agency/referral/household).
    const initialStage = 'prospect'
    const { data: opp, error: oppErr } = await db
      .from('opportunities')
      .insert({
        referring_agency_id: referral.referring_agency_id,
        referral_id: params.id,
        household_id: householdId,
        product_id: v.data.product_id ?? null,
        engagement: v.data.engagement,
        stage: initialStage,
        is_security: isSecurity,
        license_basis_used: licenseBasis,
        premium: v.data.expected_premium ?? null,
        aum: v.data.expected_aum ?? null,
        stage_history: [{ stage: initialStage, at: new Date().toISOString(), actor }],
        owner_scope: actor,
      })
      .select('id')
      .single()
    if (oppErr || !opp) return NextResponse.json({ error: oppErr?.message ?? 'Opportunity create failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'opportunity', entityId: opp.id, diff: { from_referral: params.id, household_id: householdId, is_security: isSecurity } })
    await writeAudit({ actor, action: 'stage.changed', entity: 'opportunity', entityId: opp.id, diff: { from: null, to: initialStage } })

    // ── Close the loop: referral → converted (+ linkage), rollups.
    await db
      .from('referrals')
      .update({ status: 'converted', household_id: householdId, updated_at: new Date().toISOString() })
      .eq('id', params.id)
    if (referral.referring_agency_id) {
      const { data: agency } = await db.from('agency_partnerships').select('ytd_referrals').eq('id', referral.referring_agency_id).maybeSingle()
      await db
        .from('agency_partnerships')
        .update({ ytd_referrals: Number(agency?.ytd_referrals ?? 0) + 1 })
        .eq('id', referral.referring_agency_id)
    }
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'referral',
      entityId: params.id,
      diff: { status: 'converted', household_id: householdId, opportunity_id: opp.id, created_household: createdHousehold },
    })

    return NextResponse.json({ opportunity_id: opp.id, household_id: householdId }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}
