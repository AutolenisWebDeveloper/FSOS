import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Super · AI kill switches. PATCH toggles either the global gateway policy or a
// single agent. The Compliance Guardrail agent (is_guardrail=true) may never be
// disabled here — that path returns 403 (CLAUDE.md §2.2 / §6). Every change is
// audited config.changed with a before/after diff.
const PatchSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), enabled: z.boolean() }),
  z.object({ scope: z.literal('agent'), key: z.string().min(1), enabled: z.boolean() }),
])

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()

    if (v.data.scope === 'global') {
      const before = await db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle()
      const { data, error } = await db
        .from('ai_policies')
        .update({ gateway_enabled: v.data.enabled, updated_at: new Date().toISOString() })
        .eq('id', 'global')
        .select('id, gateway_enabled')
        .maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      await writeAudit({
        actor: actorOf(auth.session),
        action: 'config.changed',
        entity: 'ai_policies',
        entityId: 'global',
        diff: {
          field: 'gateway_enabled',
          before: before.data?.gateway_enabled ?? null,
          after: v.data.enabled,
        },
      })
      return NextResponse.json({ policy: data })
    }

    // scope === 'agent'
    const before = await db
      .from('ai_agents')
      .select('key, enabled, is_guardrail')
      .eq('key', v.data.key)
      .maybeSingle()
    if (before.error) return NextResponse.json({ error: before.error.message }, { status: 500 })
    if (!before.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (before.data.is_guardrail && v.data.enabled === false) {
      return NextResponse.json(
        { error: 'The Compliance Guardrail agent cannot be disabled.' },
        { status: 403 },
      )
    }

    const { data, error } = await db
      .from('ai_agents')
      .update({ enabled: v.data.enabled })
      .eq('key', v.data.key)
      .select('key, name, enabled, is_guardrail')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'config.changed',
      entity: 'ai_agents',
      entityId: v.data.key,
      diff: {
        field: 'enabled',
        before: before.data.enabled,
        after: v.data.enabled,
      },
    })
    return NextResponse.json({ agent: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
