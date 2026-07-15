import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { generateHouseholdFna } from '@/lib/fna/household-fna'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Legacy-port FNA Generator (docs/legacy-port.md §2.1). Generate an FNA for a
// household through the AI gateway, screen it, and return it for review. Nothing
// is persisted here — save is a separate, explicit step (generate → review → save).
// Roles: fsa, licensed_staff (+ super_admin). Audits fna.generated / fna.blocked.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ household_id?: string; notes?: string }>(req)
  if ('error' in parsed) return parsed.error
  const householdId = parsed.data.household_id
  if (!householdId) return NextResponse.json({ error: 'household_id required' }, { status: 400 })

  const actor = actorOf(auth.session)

  try {
    const result = await generateHouseholdFna(householdId, { notes: parsed.data.notes })

    if (result.ok) {
      await writeAudit({
        actor,
        action: 'ai.action',
        entity: 'fna',
        entityId: householdId,
        diff: { event: 'fna.generated', hasSecurities: result.hasSecurities },
      })
      return NextResponse.json({ report: result.report, hasSecurities: result.hasSecurities })
    }

    if (result.kind === 'blocked') {
      // HARD BLOCK → escalate to the human FSA. Never returned as saveable.
      await writeAudit({
        actor,
        action: 'ai.escalated',
        entity: 'fna',
        entityId: householdId,
        diff: { event: 'fna.blocked', reasons: result.reasons },
      })
      await getDb()
        .from('compliance_events')
        .insert({
          kind: 'agent_escalation',
          actor,
          entity_type: 'household',
          entity_id: householdId,
          blocked_step: 'fna_guardrail',
          reason: `FNA blocked: ${result.reasons.join(', ')}`,
        })
      return NextResponse.json({ blocked: true, reasons: result.reasons }, { status: 200 })
    }

    const status = result.kind === 'not_found' ? 404 : result.kind === 'no_data' ? 422 : 502
    return NextResponse.json({ error: result.message }, { status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'FNA generation failed' }, { status: 500 })
  }
}
