import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission } from '@/lib/auth/api'
import { SegmentRuleSchema } from '@/lib/validation/schemas'
import { resolveSegment } from '@/lib/segments/resolve'
import { SEGMENT_PRESETS, type SegmentRule } from '@/lib/segments/rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Slice 5 — the segmentation targeting layer. GET returns the three first-class
// campaign segments (Cross-Sell, Life Conversion, Win-Back), each with a LIVE
// breakdown: total in segment, eligible to enroll, excluded, and the reason counts
// (no household / no contact method / no consent / suppressed / incomplete) so the FSA
// sees exactly who a campaign will reach before enrolling. POST previews any rule.
// Segments are dynamic — resolved on read — so a newly-cleaned contact appears
// automatically. Enrollment flows through the existing engine (resolveAudience →
// dispatchCampaign); this route is read-only.

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  try {
    const db = getDb()
    const presets = Object.values(SEGMENT_PRESETS)
    const segments = await Promise.all(
      presets.map(async (p) => ({
        key: p.key,
        label: p.label,
        rule: p.rule,
        breakdown: await resolveSegment(db, p.rule),
      })),
    )
    return NextResponse.json({ segments })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to resolve segments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SegmentRuleSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid segment rule', issues: v.error.flatten() }, { status: 422 })
  }

  try {
    const db = getDb()
    const breakdown = await resolveSegment(db, v.data as SegmentRule)
    return NextResponse.json({ breakdown })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to resolve segment' }, { status: 500 })
  }
}
