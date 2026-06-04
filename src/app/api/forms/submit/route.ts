import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = getDb()
    const body = await req.json()
    const { token, form_id, response_data } = body

    if (!token || !form_id || !response_data) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: submission, error: findErr } = await supabase
      .from('form_submissions')
      .select('*')
      .eq('token', token)
      .single()

    if (findErr || !submission) {
      return NextResponse.json({ error: 'Form link not found' }, { status: 404 })
    }

    if (submission.form_id !== form_id) {
      return NextResponse.json({ error: 'Form ID mismatch' }, { status: 400 })
    }

    if (new Date(submission.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Form link has expired' }, { status: 410 })
    }

    if (submission.status === 'complete') {
      return NextResponse.json({ error: 'Form already submitted' }, { status: 409 })
    }

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'

    const { error: updateErr } = await supabase
      .from('form_submissions')
      .update({
        status: 'complete',
        submitted_at: new Date().toISOString(),
        response_data,
        ip_address: ip,
      })
      .eq('submission_id', submission.submission_id)

    if (updateErr) {
      console.error('Form submit error:', updateErr)
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 })
    }

    if (submission.customer_id) {
      await supabase.from('activity').insert({
        customer_id: submission.customer_id,
        agency_id: submission.agency_id,
        type: 'form_received',
        subject: `${submission.form_title} submitted`,
        notes: `Submitted via ${submission.sent_via || 'link'}`,
      })
    }

    if (form_id === 'financial-needs-analysis' && submission.customer_id) {
      generateFNAAsync(submission.submission_id, response_data as Record<string, unknown>).catch(
        (err) => console.error('FNA generation error:', err)
      )
    }

    const ref = 'FFS-' + token.slice(-6).toUpperCase()
    return NextResponse.json({ success: true, ref })

  } catch (err) {
    console.error('Form submit unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — two modes:
// 1. ?token=xxx  → single form status lookup (client portal)
// 2. ?limit=N    → list recent submissions (command center)
export async function GET(req: NextRequest) {
  const supabase = getDb()
  const token = req.nextUrl.searchParams.get('token')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '0')

  // Mode 1: token lookup
  if (token) {
    const { data, error } = await supabase
      .from('form_submissions')
      .select('status, form_title, form_id, expires_at, submitted_at')
      .eq('token', token)
      .single()

    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (data.status === 'sent') {
      await supabase
        .from('form_submissions')
        .update({ status: 'opened', opened_at: new Date().toISOString() })
        .eq('token', token)
    }

    return NextResponse.json(data)
  }

  // Mode 2: list submissions for command center
  if (limit > 0) {
    const { data, error } = await supabase
      .from('form_submissions')
      .select('submission_id, form_id, form_title, status, sent_at, submitted_at, customer_id, agency_id, response_data, fna_report, fna_urgency, customers(first_name, last_name)')
      .order('sent_at', { ascending: false })
      .limit(Math.min(limit, 200))

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ submissions: data || [] })
  }

  return NextResponse.json({ error: 'token or limit required' }, { status: 400 })
}

async function generateFNAAsync(submission_id: string, response_data: Record<string, unknown>) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const supabase = getDb()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are a financial advisor at Farmers Financial Solutions, LLC.
Generate a professional Financial Needs Analysis for this client.
Return ONLY valid JSON (no markdown, no preamble):

CLIENT DATA:
${JSON.stringify(response_data, null, 2)}

{
  "executive_summary": "2-3 sentence summary",
  "financial_position": "assessment of income, assets, coverage, retirement readiness",
  "gaps": ["gap1", "gap2", "gap3"],
  "recommendations": [
    {"priority": 1, "title": "...", "description": "...", "product_category": "Life Insurance|Annuities|IRA|Mutual Funds|Planning"}
  ],
  "next_steps": ["step1", "step2", "step3"],
  "risk_profile": "Conservative|Moderate|Aggressive",
  "urgency": "High|Medium|Low",
  "monthly_retirement_gap": 0
}

COMPLIANCE: For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const report = JSON.parse(text.replace(/```json|```/g, '').trim())

  await supabase
    .from('form_submissions')
    .update({
      fna_report: report,
      fna_generated_at: new Date().toISOString(),
      fna_urgency: report.urgency,
    })
    .eq('submission_id', submission_id)
}
