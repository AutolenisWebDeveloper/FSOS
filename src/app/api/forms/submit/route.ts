import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, parseLimit } from '@/lib/http'
import { referenceFromToken } from '@/lib/tokens'
import { generateFNAReport } from '@/lib/fna'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/forms/submit — public (client portal). Saves a response by token.
export async function POST(req: NextRequest) {
  try {
    const supabase = getDb()
    const parsed = await readJson<{ token?: string; form_id?: string; response_data?: unknown }>(req)
    if ('error' in parsed) return parsed.error
    const { token, form_id, response_data } = parsed.data

    if (!token || !form_id || !response_data) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: submission, error: findErr } = await supabase
      .from('form_submissions')
      .select('submission_id, form_id, form_title, sent_via, customer_id, agency_id, expires_at, status')
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

    // Atomic guard against a concurrent double-submit: only flip rows that are
    // not already complete, and confirm exactly one row changed.
    const { data: updated, error: updateErr } = await supabase
      .from('form_submissions')
      .update({
        status: 'complete',
        submitted_at: new Date().toISOString(),
        response_data,
        ip_address: ip,
      })
      .eq('submission_id', submission.submission_id)
      .neq('status', 'complete')
      .select('submission_id')

    if (updateErr) {
      console.error('Form submit error:', updateErr)
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Form already submitted' }, { status: 409 })
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

    // Generate the FNA synchronously. Fire-and-forget does not survive a
    // serverless function returning its response, so we await it here.
    if (form_id === 'financial-needs-analysis' && submission.customer_id) {
      try {
        await generateFNAReport(submission.submission_id)
      } catch (err) {
        console.error('FNA generation error:', err)
      }
    }

    return NextResponse.json({ success: true, ref: referenceFromToken(token) })
  } catch (err) {
    console.error('Form submit unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — two modes:
//   ?token=xxx → single form status lookup (PUBLIC, client portal)
//   ?limit=N   → list recent submissions (INTERNAL, command center)
export async function GET(req: NextRequest) {
  const supabase = getDb()
  const token = req.nextUrl.searchParams.get('token')

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

  const limitParam = req.nextUrl.searchParams.get('limit')
  if (limitParam) {
    const unauthorized = requireInternalAuth(req)
    if (unauthorized) return unauthorized

    const limit = parseLimit(limitParam, 50, 200)
    const { data, error } = await supabase
      .from('form_submissions')
      .select(
        'submission_id, form_id, form_title, status, sent_at, submitted_at, customer_id, agency_id, response_data, fna_report, fna_urgency, customers(first_name, last_name)',
      )
      .order('sent_at', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ submissions: data || [] })
  }

  return NextResponse.json({ error: 'token or limit required' }, { status: 400 })
}
