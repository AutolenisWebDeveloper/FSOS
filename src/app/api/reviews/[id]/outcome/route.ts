import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ReviewOutcomeSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { assertNotSecuritiesSystemOfRecord, FirewallError } from '@/lib/compliance/firewall'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/reviews/[id]/outcome 🛡 — the WF-2 outcome step.
// Records NEEDS (never a recommendation), originates one opportunity per identified
// need/product family, schedules follow-ups. Securities needs and replacement
// scenarios are firewalled to FFS-supervised follow-up (a pointer + escalation),
// NEVER an FSOS automated sequence. Idempotent: outcome_logged reviews are frozen.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReviewOutcomeSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid outcome', details: v.error.flatten() }, { status: 400 })

  // The outcome payload records needs — never securities substance.
  try {
    assertNotSecuritiesSystemOfRecord(v.data)
  } catch (e) {
    if (e instanceof FirewallError) return NextResponse.json({ error: e.message, reason: 'firewall' }, { status: 422 })
    throw e
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: review } = await db.from('reviews').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Idempotency: an already-logged outcome is frozen (retry does not double-originate).
    if (review.stage === 'outcome_logged') {
      return NextResponse.json({ ok: true, idempotent: true, generated_opp_ids: review.generated_opp_ids ?? [] })
    }

    const householdId = review.household_id as string
    const generatedOppIds: string[] = []

    // Originate one opportunity per identified need. The FSA selected these in the
    // meeting; the system records — it does not recommend. Securities products route
    // to FFS as a pointer and are NOT auto-sequenced.
    for (const need of v.data.originate) {
      let isSecurity = false
      let licenseBasis: string | null = null
      if (need.product_id) {
        const { data: product } = await db.from('products').select('is_security, required_license').eq('id', need.product_id).maybeSingle()
        isSecurity = product?.is_security === true
        licenseBasis = product?.required_license ?? null
      }
      const { data: opp } = await db
        .from('opportunities')
        .insert({
          household_id: householdId,
          referring_agency_id: null,
          engagement: need.engagement,
          product_id: need.product_id ?? null,
          stage: 'prospect',
          is_security: isSecurity,
          license_basis_used: licenseBasis,
          premium: need.expected_premium ?? null,
          // Securities opps carry only a pointer placeholder; suitability lives in FFS.
          ffs_case_ref: isSecurity ? 'pending-ffs' : null,
          stage_history: [{ stage: 'prospect', at: new Date().toISOString(), actor, note: `from review ${params.id}` }],
          owner_scope: actor,
        })
        .select('id')
        .maybeSingle()
      if (opp?.id) {
        generatedOppIds.push(opp.id)
        await writeAudit({ actor, action: 'entity.created', entity: 'opportunity', entityId: opp.id, diff: { from_review: params.id, is_security: isSecurity } })
        if (isSecurity) {
          await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'opportunity', entity_id: opp.id, blocked_step: 'securities', reason: 'Securities need from review routed to FFS-supervised follow-up (pointer only).' })
          await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'opportunity', target_id: opp.id, reason: 'securities', note: 'Securities need discussed in review — route to FFS; no FSOS automated sequence.' })
          await writeAudit({ actor, action: 'ai.escalated', entity: 'opportunity', entityId: opp.id, diff: { reason: 'securities' } })
        }
      }
    }

    // Follow-up tasks.
    for (const f of v.data.follow_ups) {
      await db.from('work_tasks').insert({
        title: f.title,
        entity_type: 'review',
        entity_id: params.id,
        source: 'workflow',
        due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
        owner_scope: actor,
      })
    }

    // Replacement discussion flags the replacement-notice requirement + escalates.
    if (v.data.replacement_discussed) {
      await db.from('compliance_events').insert({ kind: 'replacement', actor, entity_type: 'review', entity_id: params.id, reason: 'Replacement discussed — replacement-notice requirement flagged.' })
      await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'review', target_id: params.id, reason: 'replacement', note: 'Replacement scenario — requires replacement notice + supervisory review.' })
      await writeAudit({ actor, action: 'ai.escalated', entity: 'review', entityId: params.id, diff: { reason: 'replacement' } })
    }
    if (v.data.securities_discussed) {
      await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'review', entity_id: params.id, blocked_step: 'securities', reason: 'Securities discussed in review — routed to FFS-supervised follow-up.' })
    }

    // The outcome record captures NEEDS — there is no "recommendation" field by design.
    const outcome = {
      goals: v.data.goals ?? null,
      coverage_held: v.data.coverage_held ?? null,
      gaps_observed: v.data.gaps_observed ?? null,
      life_events: v.data.life_events ?? null,
      meeting_notes: v.data.meeting_notes ?? null,
      securities_discussed: v.data.securities_discussed,
      replacement_discussed: v.data.replacement_discussed,
      logged_at: new Date().toISOString(),
      logged_by: actor,
    }

    const { error } = await db
      .from('reviews')
      .update({
        stage: 'outcome_logged',
        outcome,
        generated_opp_ids: generatedOppIds,
        replacement_flag: v.data.replacement_discussed,
        securities_routed: v.data.securities_discussed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({ actor, action: 'entity.updated', entity: 'review', entityId: params.id, diff: { stage: 'outcome_logged', generated_opp_ids: generatedOppIds } })
    return NextResponse.json({ ok: true, generated_opp_ids: generatedOppIds })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to log outcome' }, { status: 500 })
  }
}
