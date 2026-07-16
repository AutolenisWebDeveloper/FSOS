import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { runGateway, GatewayDisabledError } from '@/lib/ai/gateway'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/app/households/[id]/next-action — the client-360 "next best action"
// helper (ports the legacy client-drawer AI action). Green-zone ONLY: it suggests
// OPERATIONAL next steps for the FSA (schedule a review, request a document, log a
// follow-up, check consent, invite to a workshop). It must NEVER recommend a
// product/policy/investment/replacement.
//
// Firewall (guardrail 1): the context assembled for the model EXCLUDES is_security
// policies, DOB, account numbers, and any securities substantive data. The output
// is screened by the guardrail's recommendation detector; a recommendation is
// hard-blocked, escalated, and NOT returned. Every call is logged to
// agent_runs/agent_actions.
const AGENT_KEY = 'executive_intelligence'

const SYSTEM_PROMPT = `You are the FSOS next-best-action assistant for a Farmers FSA.
Given a compliance-safe household summary, suggest 2-4 concrete OPERATIONAL next steps the FSA could
take to move the relationship forward. Allowed step types ONLY: schedule or prepare a financial review,
request a document, log a follow-up task, confirm/refresh consent, invite to an educational workshop,
update household data. You operate in the GREEN ZONE.
You MUST NEVER recommend that the client buy, convert, replace, allocate, or purchase any specific
product, policy, or investment, and never imply a securities call to action. Frame gaps as
"discussion topics for a review", never as a product to sell. Return a short numbered list.`

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const householdId = params.id
  const actor = actorOf(auth.session)
  const db = getDb()

  // Assemble a firewall-safe context: no DOB, no securities rows, no account data.
  const [hh, members, policies, openReviews, openOpps] = await Promise.all([
    db.from('households').select('primary_name, city, state, do_not_contact').eq('id', householdId).is('deleted_at', null).maybeSingle(),
    db.from('household_members').select('full_name, relationship').eq('household_id', householdId).limit(20),
    db
      .from('household_policies')
      .select('status, is_with_us, x_date, conversion_deadline, expiration_date')
      .eq('household_id', householdId)
      .eq('is_security', false)
      .limit(50),
    db.from('reviews').select('id').eq('household_id', householdId).neq('stage', 'complete').limit(20),
    db.from('opportunities').select('id').eq('household_id', householdId).neq('stage', 'lost').eq('is_security', false).limit(20),
  ])

  if (!hh.data) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

  const context = {
    household: hh.data.primary_name,
    location: [hh.data.city, hh.data.state].filter(Boolean).join(', ') || null,
    do_not_contact: hh.data.do_not_contact,
    members: (members.data ?? []).map((m) => ({ name: m.full_name, relationship: m.relationship })),
    policies: (policies.data ?? []).map((p) => ({
      status: p.status,
      with_us: p.is_with_us,
      x_date: p.x_date,
      conversion_deadline: p.conversion_deadline,
      expiration_date: p.expiration_date,
    })),
    open_reviews: openReviews.data?.length ?? 0,
    open_opportunities: openOpps.data?.length ?? 0,
  }

  let runId: string | null = null
  try {
    const { data } = await db
      .from('agent_runs')
      .insert({ agent_key: AGENT_KEY, actor, input: { household_id: householdId }, status: 'running' })
      .select('id')
      .maybeSingle()
    runId = data?.id ?? null
  } catch {
    runId = null
  }

  let result
  try {
    result = await runGateway({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Household summary (compliance-safe, no securities data):\n${JSON.stringify(context, null, 2)}` }],
      agentKey: AGENT_KEY,
      maxTokens: 700,
    })
  } catch (e) {
    const disabled = e instanceof GatewayDisabledError
    if (runId) {
      await db
        .from('agent_runs')
        .update({ status: 'errored', error: e instanceof Error ? e.message : 'gateway error', finished_at: new Date().toISOString() })
        .eq('id', runId)
    }
    return NextResponse.json(
      { error: disabled ? 'AI is disabled by the kill switch or not yet configured.' : 'AI is temporarily unavailable.' },
      { status: disabled ? 503 : 502 },
    )
  }

  if (containsRecommendationLanguage(result.text)) {
    if (runId) {
      await db
        .from('agent_runs')
        .update({
          status: 'completed',
          model: result.model,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          cost_usd: result.costUsd,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId)
      await db.from('agent_actions').insert({
        run_id: runId,
        kind: 'escalation',
        actor,
        outcome: 'escalated',
        target_type: 'household',
        target_id: householdId,
        blocked_step: 'recommendation',
        reason: 'Next-action output contained individualized recommendation language (red line).',
      })
    }
    await db.from('compliance_events').insert({
      kind: 'agent_escalation',
      actor,
      entity_type: 'household',
      entity_id: householdId,
      blocked_step: 'next_action_guardrail',
      reason: 'Next-action output blocked: recommendation language.',
    })
    await writeAudit({ actor: `agent:${AGENT_KEY}`, action: 'ai.escalated', entity: 'household', entityId: householdId, diff: { blocked_step: 'recommendation' } })
    return NextResponse.json(
      { blocked: true, reason: 'recommendation', message: 'The suggestion was blocked because it read as a product recommendation. It has been escalated for your own review.' },
      { status: 200 },
    )
  }

  if (runId) {
    await db
      .from('agent_runs')
      .update({
        status: 'completed',
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)
    await db.from('agent_actions').insert({ run_id: runId, kind: 'next_action', actor, outcome: 'delivered', target_type: 'household', target_id: householdId })
  }
  await writeAudit({ actor: `agent:${AGENT_KEY}`, action: 'ai.action', entity: 'household', entityId: householdId, diff: { event: 'next_action' } })

  return NextResponse.json({ text: result.text, model: result.model })
}
