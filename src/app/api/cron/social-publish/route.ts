// src/app/api/cron/social-publish/route.ts
// Dedicated Vercel Cron entry for the Social Content Module publish pipeline
// (ADR-026, Slice 3). STATIC segment → takes precedence over /api/cron/[job], and
// deliberately does NOT use that route's runIdempotent(job:DATE) daily lock (which
// would skip every tick after the first each day — wrong for a minute-cadence
// publisher). Idempotency here is the per-entry conditional claim (pending →
// publishing) inside publishDueEntries, so overlapping ticks publish each queued
// item at most once.
//
// Auth: Bearer CRON_SECRET only (cronAuthorized, src/lib/http.ts).
import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/http'
import { publishDueEntries } from '@/lib/social/publisher'
import { recordRouteRun } from '@/lib/jobs/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'


export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await recordRouteRun('social-publish', () => publishDueEntries())
    return NextResponse.json({ job: 'social-publish', ...result })
  } catch (err) {
    return NextResponse.json(
      { job: 'social-publish', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
