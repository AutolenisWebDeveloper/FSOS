import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAuth, readJson } from '@/lib/http'
import { loadCustomerProfile, type CustomerProfile } from '@/lib/customerProfile'
import { FNA_MODEL } from '@/lib/anthropic'
import { runGateway } from '@/lib/ai/gateway'
import { FINRA_DISCLAIMER } from '@/lib/compliance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/customers/meeting-prep  (internal)  body: { customer_id }
// Generates a pre-appointment one-pager: summary, key facts, coverage gaps,
// talking points, suggested education topics, and questions to ask. Compliance-
// aware (education-only, no product/return guarantees). Guarded + zod-validated.
const Schema = z.object({
  summary: z.string(),
  key_facts: z.array(z.string()),
  coverage_gaps: z.array(z.string()),
  talking_points: z.array(z.string()),
  suggested_topics: z.array(z.string()),
  questions_to_ask: z.array(z.string()),
})

function summarize(p: CustomerProfile) {
  const c = p.customer
  return {
    name: `${c.first_name} ${c.last_name}`.trim(),
    age: c.age ?? null,
    marital_status: c.marital_status ?? null,
    dependents: c.dependents ?? null,
    occupation: c.occupation ?? null,
    employer: c.employer ?? null,
    state: c.state ?? null,
    has: { auto: !!c.has_auto, home: !!c.has_home, life: !!c.has_life, umbrella: !!c.has_umbrella },
    policies: p.policies.map((x) => ({ type: x.policy_type, carrier: x.carrier, status: x.status, annual_premium: x.annual_premium, face_amount: x.face_amount, conversion_deadline: x.conversion_deadline })),
    scores: p.scores ? { primary_pipeline: p.scores.primary_pipeline, priority: p.scores.priority_score, risk_label: p.scores.risk_label } : null,
    recent_activity: p.activity.slice(0, 8).map((a) => ({ type: a.type, subject: a.subject, at: a.created_at })),
    open_cases: p.cases.filter((x) => !['paid', 'cancelled'].includes(x.case_status)).map((k) => k.product_name),
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI not configured (ANTHROPIC_API_KEY).', code: 'not_configured' }, { status: 503 })
  }

  const parsed = await readJson<{ customer_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const customerId = parsed.data.customer_id
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  const profile = await loadCustomerProfile(customerId)
  if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const prompt = [
    'You are prepping a licensed Farmers Financial Services agent for a client meeting.',
    'From the client snapshot, produce a concise pre-meeting one-pager.',
    '',
    'Client snapshot (JSON):',
    JSON.stringify(summarize(profile), null, 2),
    '',
    'Rules: education-only; never guarantee returns/rates/outcomes; frame products as topics to explore, not recommendations to buy. Be specific and brief (short bullet phrases).',
    '',
    'Respond with ONLY JSON:',
    '{"summary":"1-2 sentences","key_facts":["..."],"coverage_gaps":["..."],"talking_points":["..."],"suggested_topics":["..."],"questions_to_ask":["..."]}',
  ].join('\n')

  try {
    const { text: rawText } = await runGateway({ model: FNA_MODEL, maxTokens: 1200, messages: [{ role: 'user', content: prompt }] })
    const text = rawText.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return NextResponse.json({ error: 'AI returned an unparseable response' }, { status: 502 })
    const v = Schema.safeParse(JSON.parse(text.slice(start, end + 1)))
    if (!v.success) return NextResponse.json({ error: 'AI response failed validation' }, { status: 502 })
    return NextResponse.json({ customer_id: customerId, ...v.data, disclaimer: FINRA_DISCLAIMER })
  } catch (err) {
    console.error('[meeting-prep] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
  }
}
