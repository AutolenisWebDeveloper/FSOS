import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { runConsentPopulation } from '@/lib/comms/consent-population-run'
import { readSwitchMode } from '@/lib/ops/automation-switch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// §B — existing-client consent population. Platform-owner only (super portal, mandatory
// MFA step-up): seeding channel-wide `granted` consent for every current client is a
// compliance-sensitive, book-wide write. Business logic lives in the runner service; this
// handler only authorizes → parses → delegates → shapes the report (CLAUDE.md §3.1).
//
// GET  → dry-run preview (plan + counts, writes nothing).
// POST → execute — ONLY while the consent_population_execute switch is 'on' (follow-up R19: off until
//        counsel signs off on the consent basis; the dry run stays available). Idempotent + re-runnable: the DB's unique(member_id,channel) + ON
//        CONFLICT DO NOTHING guarantees no duplicate rows and never overwrites a later
//        opt-out; only ACTUALLY-created rows are audited + written to the CRM timeline.

const BackfillSchema = z
  .object({
    // Preview only (no writes). Defaults to a real run when omitted/false.
    dry_run: z.boolean().optional(),
    // Source label recorded on every seeded consent row + its audit/timeline entry.
    source: z.string().min(2).max(80).optional(),
  })
  .strict()

export async function GET() {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const report = await runConsentPopulation({ actor: actorOf(auth.session), dryRun: true })
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to preview consent population' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = BackfillSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    if (v.data.dry_run !== true && (await readSwitchMode('consent_population_execute')) !== 'on') {
      return NextResponse.json(
        {
          error: 'Consent population is held until counsel signs off on the consent basis. The dry run is still available.',
          reason: 'switch_off',
        },
        { status: 403 },
      )
    }
    const report = await runConsentPopulation({
      actor: actorOf(auth.session),
      dryRun: v.data.dry_run === true,
      source: v.data.source,
    })
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to run consent population' }, { status: 500 })
  }
}
