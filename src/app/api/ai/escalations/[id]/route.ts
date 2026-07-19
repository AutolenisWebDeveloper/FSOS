import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Resolution decisions for an escalation. 'handled'/'dismissed' are human
// acknowledgements; 'reassigned' hands it to another operator. Note: NONE of
// these SEND anything — FSOS never dispatches from the escalations queue.
const PatchSchema = z.object({
  decision: z.enum(['handled', 'dismissed', 'reassigned']),
  note: z.string().max(2000).optional(),
})

// A row is securities-flagged when its firewall context says so. Securities items
// route to FFS and are NEVER sendable from FSOS (guardrail §2.1).
function isSecurities(reason: string | null, blockedStep: string | null): boolean {
  return (
    (reason ?? '').toLowerCase().includes('securities') ||
    blockedStep === 'is_security' ||
    blockedStep === 'securities_scope'
  )
}

// PATCH — record a human resolution on an escalation. Marks agent_actions.outcome
// and writes an approval.decided audit row. Never sends any client-facing message.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()

    const { data: row, error: readErr } = await db
      .from('agent_actions')
      .select('id, kind, reason, blocked_step, outcome')
      .eq('id', params.id)
      .eq('kind', 'escalation')
      .maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const securities = isSecurities(row.reason as string | null, row.blocked_step as string | null)

    const { data, error } = await db
      .from('agent_actions')
      .update({ outcome: v.data.decision })
      .eq('id', params.id)
      .eq('kind', 'escalation')
      .select('id, run_id, kind, actor, outcome, target_type, target_id, reason, blocked_step, note, drafted_content, created_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'approval.decided',
      entity: 'agent_action',
      entityId: params.id,
      diff: {
        decision: v.data.decision,
        note: v.data.note ?? null,
        securities,
        sent: false,
      },
    })

    return NextResponse.json({ escalation: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
