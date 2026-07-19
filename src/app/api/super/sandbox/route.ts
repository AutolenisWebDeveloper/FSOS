import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { SandboxRunSchema } from '@/lib/validation/schemas'
import { validateAIClientMessage } from '@/lib/compliance/guardrail'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-2 Super — AI guardrail sandbox. Proves the green-zone / red-line boundary:
// a draft that carries recommendation (or otherwise fails the guardrail) is
// HARD-BLOCKED and escalated to the human FSA — never sent. No live model call.
export async function GET() {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('ai_sandbox_runs')
      .select('id, agent_key, prompt, output, model, tokens, guardrail_pass, guardrail_reason, blocked, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ runs: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SandboxRunSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Offline guardrail evaluation only — never call a live model here.
    const result = validateAIClientMessage(v.data.prompt, {
      isSecurity: false,
      hasConsent: true,
      recipientLocalHour: 12,
      onDNC: false,
      usesApprovedTemplateOrPolicy: true,
    })
    const blocked = !result.allow
    const guardrailReason = result.reasons.join(',')
    const note = blocked
      ? `HARD-BLOCKED — would be escalated to the human FSA, never sent. Reasons: ${result.reasons.join(', ')}`
      : 'Passed guardrail (green-zone). A real run would still pass the full send-time dispatcher gate.'

    const { data, error } = await db
      .from('ai_sandbox_runs')
      .insert({
        agent_key: v.data.agent_key ?? null,
        prompt: v.data.prompt,
        input: { agent_key: v.data.agent_key ?? null },
        output: note,
        model: 'none (offline guardrail)',
        tokens: 0,
        guardrail_pass: result.allow,
        guardrail_reason: guardrailReason,
        blocked,
        created_by: actor,
      })
      .select('id, agent_key, prompt, output, model, tokens, guardrail_pass, guardrail_reason, blocked, created_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({ actor, action: 'ai.run', entity: 'ai_sandbox_run', entityId: data.id, diff: { blocked, reasons: result.reasons } })
    if (blocked) {
      await writeAudit({ actor, action: 'ai.escalated', entity: 'ai_sandbox_run', entityId: data.id, diff: { blocked, reasons: result.reasons } })
    }

    return NextResponse.json({ run: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
