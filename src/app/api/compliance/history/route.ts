import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson, parseLimit } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { NigoOutcomeSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — NIGO history (blueprint §3 STEP 9 / Prompt 6).
// GET: list nigo_cases + their issues, filterable by product/carrier/reviewer/
// validity/authority_type/outcome/date + free-text issue search. PATCH: record the
// final outcome + lessons learned once resolved (the memory that sharpens future
// analysis).

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const sp = req.nextUrl.searchParams
  const limit = parseLimit(sp.get('limit'), 100, 300)

  try {
    const db = getDb()
    let cases = db
      .from('nigo_cases')
      .select('id, work_item, client_ref, product, carrier, reviewer, state, outcome, round_number, received_at, resolved_at, lessons_learned, raw_nigo_text')
      .order('received_at', { ascending: false })
      .limit(limit)

    if (sp.get('product')) cases = cases.eq('product', sp.get('product'))
    if (sp.get('carrier')) cases = cases.eq('carrier', sp.get('carrier'))
    if (sp.get('reviewer')) cases = cases.eq('reviewer', sp.get('reviewer'))
    if (sp.get('outcome')) cases = cases.eq('outcome', sp.get('outcome'))
    if (sp.get('from')) cases = cases.gte('received_at', sp.get('from'))
    if (sp.get('to')) cases = cases.lte('received_at', sp.get('to'))

    const { data: caseRows, error } = await cases
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const ids = (caseRows ?? []).map((c) => c.id)
    let issueRows: {
      id: string
      case_id: string
      seq: number
      issue_text: string
      authority_type: string | null
      validity: string | null
      citations: string[] | null
    }[] = []
    if (ids.length) {
      let issuesQ = db
        .from('nigo_issues')
        .select('id, case_id, seq, issue_text, authority_type, validity, citations')
        .in('case_id', ids)
        .order('seq', { ascending: true })
      if (sp.get('validity')) issuesQ = issuesQ.eq('validity', sp.get('validity'))
      if (sp.get('authority_type')) issuesQ = issuesQ.eq('authority_type', sp.get('authority_type'))
      const search = sp.get('q')?.trim()
      if (search) issuesQ = issuesQ.ilike('issue_text', `%${search}%`)
      const { data } = await issuesQ
      issueRows = (data ?? []) as typeof issueRows
    }

    const byCase = new Map<string, typeof issueRows>()
    for (const it of issueRows) {
      const arr = byCase.get(it.case_id) ?? []
      arr.push(it)
      byCase.set(it.case_id, arr)
    }

    // When filtering by issue attributes, only return cases that still have issues.
    const filteringIssues = Boolean(sp.get('validity') || sp.get('authority_type') || sp.get('q'))
    const cases_out = (caseRows ?? [])
      .map((c) => ({ ...c, issues: byCase.get(c.id) ?? [] }))
      .filter((c) => (filteringIssues ? c.issues.length > 0 : true))

    return NextResponse.json({ cases: cases_out })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = NigoOutcomeSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  }
  const d = v.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const patch: Record<string, unknown> = { outcome: d.outcome, updated_by: actor }
    if (d.lessons_learned !== undefined) patch.lessons_learned = d.lessons_learned
    if (d.outcome !== 'open') patch.resolved_at = new Date().toISOString()
    else patch.resolved_at = null

    const { data, error } = await db.from('nigo_cases').update(patch).eq('id', d.case_id).select('id, outcome').single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'nigo_case',
      entityId: d.case_id,
      diff: { outcome: d.outcome },
    })
    return NextResponse.json({ case: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
