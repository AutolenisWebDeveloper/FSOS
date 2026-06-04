import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'submission_id required' }, { status: 400 })
    }

    // 1. Fetch submission + customer data
    const { data: sub, error: subErr } = await getDb()
      .from('form_submissions')
      .select(`
        *,
        customers (
          first_name, last_name, dob, age, email, phone,
          marital_status, dependents, employer, has_life, has_auto, has_home,
          city, state
        )
      `)
      .eq('submission_id', submission_id)
      .single()

    if (subErr || !sub) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    if (!sub.response_data) {
      return NextResponse.json({ error: 'No form data to analyze' }, { status: 400 })
    }

    // 2. Check if FNA already generated (prevent duplicate API calls)
    if (sub.fna_report && !req.nextUrl.searchParams.get('force')) {
      return NextResponse.json({
        success: true,
        report: sub.fna_report,
        cached: true,
      })
    }

    // 3. Build the Claude prompt
    const clientData = {
      ...sub.response_data as Record<string, unknown>,
      // Merge in customer record data
      ...(sub.customers ? {
        _customer_age: (sub.customers as { age?: number }).age,
        _customer_state: (sub.customers as { state?: string }).state,
        _existing_life: (sub.customers as { has_life?: boolean }).has_life,
        _existing_auto: (sub.customers as { has_auto?: boolean }).has_auto,
        _existing_home: (sub.customers as { has_home?: boolean }).has_home,
      } : {}),
    }

    const prompt = `You are preparing a Financial Needs Analysis for a Farmers Financial Solutions, LLC review.

IMPORTANT COMPLIANCE REQUIREMENTS:
- This analysis is for EDUCATIONAL and INFORMATIONAL purposes ONLY
- Not a product recommendation or suitability determination
- Do NOT recommend any specific product by name
- Do NOT make investment, securities, or insurance suitability determinations
- All actual recommendations require a licensed FSA meeting and FINRA Reg BI review
- Product categories are acceptable; specific carriers/products are NOT

CLIENT DATA:
${JSON.stringify(clientData, null, 2)}

Generate a complete FNA. Return ONLY valid JSON (no markdown fences, no preamble, no explanation):

{
  "executive_summary": "2-3 sentences summarizing the client's financial situation and primary needs",
  "financial_position": "Paragraph assessing income, assets, coverage, and retirement readiness based on the data provided",
  "gaps": [
    "Specific gap 1 — be concrete (e.g. 'Life coverage gap: current coverage is below the 10x income benchmark')",
    "Specific gap 2",
    "Specific gap 3",
    "Specific gap 4 (add more as warranted)"
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

    // 4. Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    let report: Record<string, unknown>

    try {
      report = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      console.error('FNA JSON parse error. Raw output:', text.slice(0, 500))
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    // 5. Store report
    const { error: updateErr } = await getDb()
      .from('form_submissions')
      .update({
        fna_report: report,
        fna_generated_at: new Date().toISOString(),
        fna_urgency: (report.urgency as string) || 'Medium',
      })
      .eq('submission_id', submission_id)

    if (updateErr) {
      console.error('FNA store error:', updateErr)
    }

    // 6. Link to commission case if exists
    if (sub.customer_id) {
      await getDb()
        .from('commission_cases')
        .update({
          fna_submission_id: submission_id,
          fna_urgency: (report.urgency as string) || null,
        })
        .eq('customer_id', sub.customer_id)
        .eq('case_status', 'pending')
        .is('fna_submission_id', null)
    }

    return NextResponse.json({ success: true, report })

  } catch (err) {
    console.error('FNA generation error:', err)
    return NextResponse.json({ error: 'Failed to generate FNA report' }, { status: 500 })
  }
}

// GET — retrieve existing FNA report by submission_id
export async function GET(req: NextRequest) {
  const submission_id = req.nextUrl.searchParams.get('submission_id')
  if (!submission_id) return NextResponse.json({ error: 'submission_id required' }, { status: 400 })

  const { data, error } = await getDb()
    .from('form_submissions')
    .select('fna_report, fna_generated_at, fna_urgency, form_id, customer_id')
    .eq('submission_id', submission_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.fna_report) return NextResponse.json({ error: 'FNA not yet generated' }, { status: 404 })

  return NextResponse.json({
    report: data.fna_report,
    generated_at: data.fna_generated_at,
    urgency: data.fna_urgency,
  })
}
