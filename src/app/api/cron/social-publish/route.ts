// src/app/api/cron/social-publish/route.ts
// Dedicated Vercel Cron entry for the Social Content Module publish pipeline
// (ADR-026, Slice 3). STATIC segment → takes precedence over /api/cron/[job], and
// deliberately does NOT use that route's runIdempotent(job:DATE) daily lock (which
// would skip every tick after the first each day — wrong for a minute-cadence
// publisher). Idempotency here is the per-entry conditional claim (pending →
// publishing) inside publishDueEntries, so overlapping ticks publish each queued
// item at most once.
//
// Auth mirrors /api/cron/[job]: Vercel Cron header OR a Bearer CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { publishDueEntries } from '@/lib/social/publisher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await publishDueEntries()
    return NextResponse.json({ job: 'social-publish', ...result })
  } catch (err) {
    return NextResponse.json(
      { job: 'social-publish', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
