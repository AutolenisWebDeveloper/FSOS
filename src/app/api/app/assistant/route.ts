import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { runGateway, GatewayDisabledError, type GatewayMessage } from '@/lib/ai/gateway'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/app/assistant — internal FSA operating assistant (ports the legacy
// AI Assistant chat). ALL AI goes through lib/ai/gateway.ts (never the SDK), the
// per-agent kill switch gates it, every turn is logged to agent_runs/agent_actions,
// and the output is screened by the guardrail's recommendation detector before it
// is returned. Green-zone only: it explains FSOS, assembles data, and drafts
// internal notes. It must NEVER give an individualized product / policy /
// investment / replacement recommendation — such output is hard-blocked and
// escalated to the human FSA, exactly like a client-facing message.
const AGENT_KEY = 'executive_intelligence'

const SYSTEM_PROMPT = `You are the FSOS internal operating assistant for a Farmers Financial Services Agent (FSA).
You help the FSA navigate FSOS, understand their book, summarize records, and draft INTERNAL notes.
You operate strictly in the compliance GREEN ZONE. You MAY: identify, educate, explain, summarize,
assemble data, remind, and draft internal materials.
You MUST NEVER make an individualized product, policy, investment, replacement, allocation, or
transaction recommendation, or anything that reads as a securities "call to action". If the user asks
for a recommendation of what a specific client should buy/convert/replace/allocate, decline and tell
them to escalate to the licensed FSA's own judgment or to FFS. Never state account numbers, order
details, or suitability determinations. Keep answers concise and operational.`

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(6000),
      }),
    )
    .min(1)
    .max(20),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const actor = actorOf(auth.session)
  const messages: GatewayMessage[] = parsed.data.messages
  const db = getDb()

  // Open a run row (best-effort — a logging hiccup must not swallow the request).
  let runId: string | null = null
  try {
    const { data } = await db
      .from('agent_runs')
      .insert({ agent_key: AGENT_KEY, actor, input: { turns: messages.length }, status: 'running' })
      .select('id')
      .maybeSingle()
    runId = data?.id ?? null
  } catch {
    runId = null
  }

  let result
  try {
    result = await runGateway({ system: SYSTEM_PROMPT, messages, agentKey: AGENT_KEY, maxTokens: 1024 })
  } catch (e) {
    const disabled = e instanceof GatewayDisabledError
    if (runId) {
      await db
        .from('agent_runs')
        .update({ status: 'errored', error: e instanceof Error ? e.message : 'gateway error', finished_at: new Date().toISOString() })
        .eq('id', runId)
    }
    return NextResponse.json(
      { error: disabled ? 'The AI assistant is currently disabled by the kill switch or not yet configured.' : 'AI assistant is temporarily unavailable.' },
      { status: disabled ? 503 : 502 },
    )
  }

  // Red-line screen: individualized recommendation language is hard-blocked and
  // escalated — the drafted text is NOT returned to the caller.
  if (containsRecommendationLanguage(result.text)) {
    if (runId) {
      await db
        .from('agent_runs')
        .update({
          status: 'completed',
          model: result.model,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          cost_usd: result.costUsd,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId)
      await db.from('agent_actions').insert({
        run_id: runId,
        kind: 'escalation',
        actor,
        outcome: 'escalated',
        blocked_step: 'recommendation',
        reason: 'Assistant output contained individualized recommendation language (red line).',
      })
    }
    await writeAudit({
      actor: `agent:${AGENT_KEY}`,
      action: 'ai.escalated',
      entity: 'agent_run',
      entityId: runId,
      diff: { blocked_step: 'recommendation' },
    })
    return NextResponse.json(
      {
        blocked: true,
        reason: 'recommendation',
        message:
          'That response was blocked because it would have made an individualized recommendation. Use your own licensed judgment or escalate to FFS.',
      },
      { status: 200 },
    )
  }

  if (runId) {
    await db
      .from('agent_runs')
      .update({
        status: 'completed',
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)
    await db.from('agent_actions').insert({
      run_id: runId,
      kind: 'assistant_reply',
      actor,
      outcome: 'delivered',
      note: 'internal assistant turn',
    })
  }
  await writeAudit({ actor: `agent:${AGENT_KEY}`, action: 'ai.run', entity: 'agent_run', entityId: runId })

  return NextResponse.json({ text: result.text, model: result.model })
}
