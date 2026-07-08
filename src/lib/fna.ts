// src/lib/fna.ts
// Single source of truth for Financial Needs Analysis generation.
// Both POST /api/forms/fna and the post-submit hook call generateFNAReport()
// so the compliance prompt, FINRA disclaimer, model, and storage stay identical.

import { getDb } from '@/lib/supabase/client'
import { getAnthropic, FNA_MODEL, FNA_MAX_TOKENS } from '@/lib/anthropic'
import { FINRA_DISCLAIMER } from '@/lib/compliance'

export type FnaResult =
  | { ok: true; report: Record<string, unknown>; cached?: boolean }
  | { ok: false; status: number; error: string }

interface GenerateOpts {
  force?: boolean
}

export async function generateFNAReport(
  submission_id: string,
  opts: GenerateOpts = {},
): Promise<FnaResult> {
  const db = getDb()

  const { data: sub, error: subErr } = await db
    .from('form_submissions')
    .select(`
      submission_id, customer_id, response_data, fna_report,
      customers (
        first_name, last_name, dob, age, email, phone,
        marital_status, dependents, employer, has_life, has_auto, has_home,
        city, state
      )
    `)
    .eq('submission_id', submission_id)
    .single()

  if (subErr || !sub) return { ok: false, status: 404, error: 'Submission not found' }
  if (!sub.response_data) return { ok: false, status: 400, error: 'No form data to analyze' }

  if (sub.fna_report && !opts.force) {
    return { ok: true, report: sub.fna_report as Record<string, unknown>, cached: true }
  }

  const rawCustomer = Array.isArray(sub.customers) ? sub.customers[0] : sub.customers
  const customer = (rawCustomer ?? null) as unknown as Record<string, unknown> | null
  const clientData = {
    ...(sub.response_data as Record<string, unknown>),
    ...(customer
      ? {
          _customer_age: customer.age,
          _customer_state: customer.state,
          _existing_life: customer.has_life,
          _existing_auto: customer.has_auto,
          _existing_home: customer.has_home,
        }
      : {}),
  }

  const prompt = `You are preparing a Financial Needs Analysis for a Farmers Financial Solutions, LLC review.

IMPORTANT COMPLIANCE REQUIREMENTS:
- This analysis is for EDUCATIONAL and INFORMATIONAL purposes ONLY
- Not a product recommendation or suitability determination
- Do NOT recommend any specific product by name
- Do NOT make investment, securities, or insurance suitability determinations
- All actual recommendations require a licensed FSA meeting and FINRA Reg BI review
- Product categories are acceptable; specific carriers/products are NOT
- Every report MUST carry this exact disclaimer verbatim: "${FINRA_DISCLAIMER}"

CLIENT DATA:
${JSON.stringify(clientData, null, 2)}

Generate a complete FNA. Return ONLY valid JSON (no markdown fences, no preamble, no explanation):

{
  "executive_summary": "2-3 sentences summarizing the client's financial situation and primary needs",
  "financial_position": "Paragraph assessing income, assets, coverage, and retirement readiness based on the data provided",
  "gaps": [
    "Specific gap 1 — be concrete (e.g. 'Life coverage gap: current coverage is below the 10x income benchmark')",
    "Specific gap 2",
    "Specific gap 3"
  ],
  "recommendations": [
    {
      "priority": 1,
      "title": "Short title (e.g. 'Life Insurance Gap Review')",
      "description": "1-2 sentences describing the educational recommendation without naming specific products",
      "product_category": "Life Insurance|Annuities / Retirement|IRA / Mutual Funds|Financial Planning|Business Planning|Estate Planning"
    }
  ],
  "next_steps": [
    "Concrete next step 1 for the FSA meeting",
    "Concrete next step 2",
    "Concrete next step 3"
  ],
  "risk_profile": "Conservative|Moderate|Aggressive|Unknown",
  "urgency": "High|Medium|Low",
  "monthly_retirement_gap": 0,
  "key_metrics": {
    "annual_income": 0,
    "life_coverage_gap": 0,
    "retirement_shortfall_monthly": 0
  }
}`

  let text: string
  try {
    const message = await getAnthropic().messages.create({
      model: FNA_MODEL,
      max_tokens: FNA_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = message.content[0]
    text = block && block.type === 'text' ? block.text : ''
  } catch (err) {
    console.error('[fna] model call failed:', err)
    return { ok: false, status: 502, error: 'AI generation failed' }
  }

  let report: Record<string, unknown>
  try {
    report = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    console.error('[fna] JSON parse error. Raw output:', text.slice(0, 500))
    return { ok: false, status: 502, error: 'Failed to parse AI response' }
  }

  // Guarantee the FINRA disclaimer is present on every report, always.
  report.compliance_disclaimer = FINRA_DISCLAIMER

  const { error: updateErr } = await db
    .from('form_submissions')
    .update({
      fna_report: report,
      fna_generated_at: new Date().toISOString(),
      fna_urgency: (report.urgency as string) || 'Medium',
    })
    .eq('submission_id', submission_id)

  if (updateErr) console.error('[fna] store error:', updateErr)

  if (sub.customer_id) {
    await db
      .from('commission_cases')
      .update({
        fna_submission_id: submission_id,
        fna_urgency: (report.urgency as string) || null,
      })
      .eq('customer_id', sub.customer_id)
      .eq('case_status', 'pending')
      .is('fna_submission_id', null)
  }

  return { ok: true, report }
}
