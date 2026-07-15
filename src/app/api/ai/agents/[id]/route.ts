import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf, hasRole } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Schema = z.object({ enabled: z.boolean(), step_up_confirmed: z.boolean().optional() })

// PATCH — per-agent kill switch. The Compliance Guardrail agent (is_guardrail=true)
// cannot be disabled without super_admin + a second-factor confirmation (WF-8).
// [id] is the ai_agents.key.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: agent } = await db.from('ai_agents').select('key, is_guardrail, enabled').eq('key', params.id).maybeSingle()
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    // The Compliance Guardrail cannot be disabled without super + 2FA (portals-admin).
    if (agent.is_guardrail && !v.data.enabled) {
      if (!hasRole(auth.session, 'super_admin') || v.data.step_up_confirmed !== true) {
        await writeAudit({ actor, action: 'config.changed', entity: 'ai_agent', entityId: params.id, diff: { blocked: 'guardrail_disable_requires_super_2fa' } })
        return NextResponse.json({ error: 'The Compliance Guardrail can only be disabled by a super admin with a second-factor confirmation.', reason: 'guardrail_protected' }, { status: 403 })
      }
    }

    const { error } = await db.from('ai_agents').update({ enabled: v.data.enabled, updated_at: new Date().toISOString() }).eq('key', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'config.changed', entity: 'ai_agent', entityId: params.id, diff: { enabled: v.data.enabled } })
    return NextResponse.json({ ok: true, enabled: v.data.enabled })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
