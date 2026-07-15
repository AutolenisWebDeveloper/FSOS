import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { OutreachActionSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-08 Cross-Sell action (WF-4). Identify & invite — never recommend. The action
// set is green-zone ONLY (schema enum). [id] is a household id. Output is framed
// as a coverage gap / review opportunity, never a product recommendation. DNC/
// consent-invalid households are excluded from sends at send time (the gate).
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
    const { data: hh } = await db.from('households').select('id, do_not_contact').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!hh) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

    if (hh.do_not_contact && ['educate', 'invite', 'remind', 'follow_up'].includes(v.data.action)) {
      await db.from('compliance_events').insert({ kind: 'comms_blocked', actor, entity_type: 'household', entity_id: params.id, blocked_step: 'dnc', reason: 'Household on do-not-contact — excluded from cross-sell outreach.' })
      await writeAudit({ actor, action: 'comms.blocked', entity: 'household', entityId: params.id, diff: { action: v.data.action } })
      return NextResponse.json({ error: 'Household is on do-not-contact; excluded from outreach.', reason: 'dnc' }, { status: 403 })
    }

    if (v.data.action === 'schedule') {
      const { data: rt } = await db.from('review_types').select('agenda').eq('key', 'coverage').maybeSingle()
      const { data: rev } = await db.from('reviews').insert({ household_id: params.id, type: 'coverage', stage: 'requested', agenda: rt?.agenda ?? [], owner_scope: actor }).select('id').maybeSingle()
      await db.from('activities').insert({ entity_type: 'household', entity_id: params.id, kind: 'crosssell_schedule', note: 'Coverage review invitation created', actor })
      await writeAudit({ actor, action: 'entity.created', entity: 'review', entityId: rev?.id ?? null, diff: { from_crosssell: params.id } })
      return NextResponse.json({ ok: true, action: v.data.action, review_id: rev?.id ?? null })
    }

    if (v.data.action === 'escalate') {
      await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'household', target_id: params.id, reason: 'crosssell_advice', note: v.data.note ?? 'Advice/securities request — routed to FSA/FFS.' })
      await writeAudit({ actor, action: 'ai.escalated', entity: 'household', entityId: params.id, diff: { reason: 'crosssell_advice' } })
      return NextResponse.json({ ok: true, action: v.data.action })
    }

    await db.from('activities').insert({ entity_type: 'household', entity_id: params.id, kind: `crosssell_${v.data.action}`, note: v.data.note ?? `Green-zone ${v.data.action} (coverage-gap review invitation)`, actor })
    await writeAudit({ actor, action: 'ai.action', entity: 'household', entityId: params.id, diff: { action: v.data.action, greenzone: true } })
    return NextResponse.json({ ok: true, action: v.data.action })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
