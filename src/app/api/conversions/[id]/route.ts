import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { OutreachActionSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-07 Term Conversion action (WF-3). The action set is green-zone ONLY:
// identify · educate · invite · schedule · remind · follow_up · escalate.
// There is NO "recommend product" action — the schema enum cannot express it.
// Securities-flagged policies are excluded from any automated send (firewall).
// [id] is a household_policies id (a term policy with a conversion window).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OutreachActionSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid action', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: policy } = await db.from('household_policies').select('id, household_id, is_security, conversion_deadline').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!policy) return NextResponse.json({ error: 'Policy not found' }, { status: 404 })

    // Firewall: a securities-flagged policy is never enrolled in automated outreach.
    if (policy.is_security && ['educate', 'invite', 'remind', 'follow_up'].includes(v.data.action)) {
      await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'policy', entity_id: params.id, blocked_step: 'is_security', reason: 'Securities policy excluded from automated conversion outreach.' })
      await writeAudit({ actor, action: 'firewall.blocked', entity: 'policy', entityId: params.id, diff: { action: v.data.action } })
      return NextResponse.json({ error: 'Securities-flagged policy is excluded from automated outreach; handled by FFS.', reason: 'is_security' }, { status: 403 })
    }

    if (v.data.action === 'schedule') {
      // Create a term_conversion review (green-zone). Downstream: WF-2.
      const { data: rt } = await db.from('review_types').select('agenda').eq('key', 'term_conversion').maybeSingle()
      const { data: rev } = await db.from('reviews').insert({ household_id: policy.household_id, type: 'term_conversion', stage: 'requested', agenda: rt?.agenda ?? [], owner_scope: actor }).select('id').maybeSingle()
      await db.from('activities').insert({ entity_type: 'policy', entity_id: params.id, kind: 'conversion_schedule', note: 'Review invitation created (educational conversion review)', actor })
      await writeAudit({ actor, action: 'entity.created', entity: 'review', entityId: rev?.id ?? null, diff: { from_conversion: params.id } })
      return NextResponse.json({ ok: true, action: v.data.action, review_id: rev?.id ?? null })
    }

    if (v.data.action === 'escalate') {
      await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'policy', target_id: params.id, reason: 'conversion_advice', note: v.data.note ?? 'Client requested advice on which product to convert to — routed to FSA (red line).' })
      await db.from('compliance_events').insert({ kind: 'agent_escalation', actor, entity_type: 'policy', entity_id: params.id, reason: 'conversion_advice' })
      await writeAudit({ actor, action: 'ai.escalated', entity: 'policy', entityId: params.id, diff: { reason: 'conversion_advice' } })
      return NextResponse.json({ ok: true, action: v.data.action })
    }

    // identify / educate / invite / remind / follow_up — log green-zone activity.
    // Actual client-facing sends go through /api/comms/send (7-step gate at send time).
    await db.from('activities').insert({ entity_type: 'policy', entity_id: params.id, kind: `conversion_${v.data.action}`, note: v.data.note ?? `Green-zone ${v.data.action} (educational conversion outreach)`, actor })
    await writeAudit({ actor, action: 'ai.action', entity: 'policy', entityId: params.id, diff: { action: v.data.action, greenzone: true } })
    return NextResponse.json({ ok: true, action: v.data.action })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
