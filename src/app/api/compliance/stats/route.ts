import { NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — pattern analytics (blueprint §3 / Prompt 6).
// The key metric: of the NIGO issues a reviewer FRAMED as required, what authority
// tier ACTUALLY supported them — i.e. the rate of NIGOs NOT backed by a real
// FINRA/SEC/state rule (firm policy or unsupported/preference). That distribution,
// tracked over time, is the FSA's evidence base.

interface CaseRow {
  id: string
  outcome: string
  round_number: number | null
  received_at: string
  resolved_at: string | null
}
interface IssueRow {
  case_id: string
  authority_type: string | null
  validity: string | null
  issue_text: string
}

const LAW_TIERS = new Set(['FINRA_RULE', 'SEC_RULE', 'STATE_REQUIREMENT'])

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const [{ data: caseData }, { data: issueData }] = await Promise.all([
      db.from('nigo_cases').select('id, outcome, round_number, received_at, resolved_at').limit(5000),
      db.from('nigo_issues').select('case_id, authority_type, validity, issue_text').limit(20000),
    ])
    const cases = (caseData ?? []) as CaseRow[]
    const issues = (issueData ?? []) as IssueRow[]

    const validityBreakdown: Record<string, number> = {}
    const authorityBreakdown: Record<string, number> = {}
    let lawBacked = 0
    let notLawBacked = 0
    for (const it of issues) {
      const val = it.validity ?? 'unknown'
      validityBreakdown[val] = (validityBreakdown[val] ?? 0) + 1
      const tier = it.authority_type ?? 'unsupported'
      authorityBreakdown[tier] = (authorityBreakdown[tier] ?? 0) + 1
      if (it.authority_type && LAW_TIERS.has(it.authority_type)) lawBacked++
      else notLawBacked++
    }
    const totalIssues = issues.length

    // Average rounds + days open (resolved cases).
    const rounds = cases.map((c) => c.round_number ?? 1)
    const avgRounds = rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : 0
    const resolved = cases.filter((c) => c.resolved_at)
    const avgDaysOpen = resolved.length
      ? resolved.reduce((sum, c) => {
          const days = (new Date(c.resolved_at as string).getTime() - new Date(c.received_at).getTime()) / 86_400_000
          return sum + Math.max(0, days)
        }, 0) / resolved.length
      : 0

    // Top issue patterns by a coarse keyword signature.
    const patternCounts: Record<string, number> = {}
    for (const it of issues) {
      const sig = it.issue_text
        .toLowerCase()
        .replace(/[^a-z ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 3)
        .join(' ')
      if (sig) patternCounts[sig] = (patternCounts[sig] ?? 0) + 1
    }
    const topPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }))

    return NextResponse.json({
      total_cases: cases.length,
      total_issues: totalIssues,
      outcome_breakdown: cases.reduce((acc, c) => {
        acc[c.outcome] = (acc[c.outcome] ?? 0) + 1
        return acc
      }, {} as Record<string, number>),
      validity_breakdown: validityBreakdown,
      authority_breakdown: authorityBreakdown,
      // The headline: how many reviewer-required issues were NOT backed by law.
      law_backed: lawBacked,
      not_law_backed: notLawBacked,
      not_law_backed_pct: totalIssues ? Math.round((notLawBacked / totalIssues) * 100) : 0,
      avg_rounds: Math.round(avgRounds * 10) / 10,
      avg_days_open: Math.round(avgDaysOpen * 10) / 10,
      top_patterns: topPatterns,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
