import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAuth, readJson } from '@/lib/http'
import { loadCustomerProfile, type CustomerProfile } from '@/lib/customerProfile'
import { getAnthropic, FNA_MODEL } from '@/lib/anthropic'
import { FINRA_DISCLAIMER } from '@/lib/compliance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/customers/next-action  (internal)  body: { customer_id }
// Uses Claude to recommend the single best next action for a client, with a
// short rationale and ready-to-send SMS + email drafts. Compliance-aware: the
// prompt forbids product guarantees and returns education-only language.
const ANALYSIS_MAX_TOKENS = 1024

const ResultSchema = z.object({
  priority: z.enum(['high', 'medium', 'low']),
  action: z.string(),
  rationale: z.string(),
  draft_sms: z.string(),
  draft_email_subject: z.string(),
  draft_email_body: z.string(),
})

// Trim the profile to the fields that matter for the recommendation so the
// prompt stays small and no unnecessary PII is sent to the model.
function summarize(p: CustomerProfile) {
  const c = p.customer
  return {
    name: `${c.first_name} ${c.last_name}`.trim(),
    age: c.age ?? null,
    marital_status: c.marital_status ?? null,
    dependents: c.dependents ?? null,
    state: c.state ?? null,
    source: c.source ?? null,
    consent_sms: !!c.consent_sms,
    consent_email: !!c.consent_email,
    policies: p.policies.map((x) => ({
      type: x.policy_type,
      carrier: x.carrier,
      status: x.status,
      annual_premium: x.annual_premium,
      conversion_deadline: x.conversion_deadline,
    })),
    scores: p.scores
      ? {
          priority: p.scores.priority_score,
          primary_pipeline: p.scores.primary_pipeline,
          conversion: p.scores.conversion_score,
          opra: p.scores.opra_score,
          life: p.scores.life_score,
          retirement: p.scores.retirement_score,
        }
      : null,
    ghl_stage: p.ghl.stage,
    ghl_pipeline: p.ghl.pipeline,
    open_cases: p.cases.filter((x) => !['paid', 'cancelled'].includes(x.case_status)).length,
    last_activity: p.activity[0]
      ? { type: p.activity[0].type, subject: p.activity[0].subject, at: p.activity[0].created_at }
      : null,
    recent_activity_types: p.activity.slice(0, 8).map((a) => a.type),
    open_opra: p.opra.filter((o) => !['transferred', 'declined'].includes(o.status)).length,
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI is not configured (set ANTHROPIC_API_KEY).', code: 'not_configured' },
      { status: 503 },
    )
  }

  const parsed = await readJson<{ customer_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const customerId = parsed.data.customer_id
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  const profile = await loadCustomerProfile(customerId)
  if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const prompt = [
    'You are the sales operations co-pilot for a licensed Farmers Financial Services agent.',
    'Given this client snapshot, recommend the SINGLE best next action to move the relationship forward.',
    '',
    'Client snapshot (JSON):',
    JSON.stringify(summarize(profile), null, 2),
    '',
    'Rules:',
    '- Recommend exactly one concrete next action (e.g. "Call to schedule a term-conversion review").',
    '- Respect consent: if consent_sms is false, keep draft_sms empty; if consent_email is false, keep the email fields empty.',
    '- Education-only language. Never guarantee returns, rates, or outcomes. No specific product/return promises.',
    '- Keep the SMS under 320 characters and the email body under 120 words. Warm, professional, concise.',
    '- Prioritize time-sensitive items (term-conversion deadlines, OPRA windows) as high.',
    '',
    'Respond with ONLY a JSON object:',
    '{"priority":"high|medium|low","action":"...","rationale":"...","draft_sms":"...","draft_email_subject":"...","draft_email_body":"..."}',
  ].join('\n')

  try {
    const client = getAnthropic()
    const res = await client.messages.create({
      model: FNA_MODEL,
      max_tokens: ANALYSIS_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: 'AI returned an unparseable response' }, { status: 502 })
    }
    const validated = ResultSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    if (!validated.success) {
      return NextResponse.json({ error: 'AI response failed validation' }, { status: 502 })
    }

    return NextResponse.json({
      customer_id: customerId,
      ...validated.data,
      disclaimer: FINRA_DISCLAIMER,
    })
  } catch (err) {
    console.error('[next-action] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
  }
}
