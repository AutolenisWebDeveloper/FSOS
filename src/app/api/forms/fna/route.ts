import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'
import { generateFNAReport } from '@/lib/fna'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/forms/fna — generate (or return cached) FNA for a submission.
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson<{ submission_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const { submission_id } = parsed.data

  if (!submission_id) {
    return NextResponse.json({ error: 'submission_id required' }, { status: 400 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1' || req.nextUrl.searchParams.has('force')
  const result = await generateFNAReport(submission_id, { force })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true, report: result.report, cached: result.cached ?? false })
}

// GET /api/forms/fna?submission_id=... — retrieve an existing report.
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

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
