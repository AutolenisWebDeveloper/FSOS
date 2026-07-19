// src/jobs/agent-runner.ts
// The durable, event-driven agent runner (CLAUDE.md §6, WF-8). Agents run here —
// NOT as open chat sessions. Every run:
//   1. checks the kill switch (global + per-agent) at start,
//   2. persists agent_runs (inputs, model, tokens, cost, confidence),
//   3. routes every client-facing action through the Compliance Guardrail — pass →
//      act (green-zone) and write agent_actions; fail/low-confidence/judgment →
//      escalate to /app/ai/escalations,
//   4. is idempotent (dedupe key) and retries transient failures with backoff.

import { runGateway, assertKillSwitch, GatewayDisabledError, type GatewayRequest, type GatewayResult } from '@/lib/ai/gateway'
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { retry, runIdempotent } from '@/lib/jobs/runtime'
import { dispatch, type DispatchRequest } from '@/lib/comms/dispatcher'

export interface AgentRunContext {
  runId: string
  agentKey: string
  actor: string
  /** Call the AI gateway; usage/cost are accumulated onto this run. */
  gateway(req: Omit<GatewayRequest, 'agentKey'>): Promise<GatewayResult>
  /** Log a completed green-zone action. */
  recordAction(action: { kind: string; targetType?: string; targetId?: string; outcome: string; note?: string }): Promise<void>
  /** Route a client-facing message through the guardrail/dispatcher (auto-escalates on block). */
  send(req: DispatchRequest): Promise<void>
  /** Escalate to the human FSA (judgment required / blocked / low confidence). */
  escalate(reason: string, detail?: { targetType?: string; targetId?: string; draftedContent?: string }): Promise<void>
  /** Report the run's confidence [0,1]; low confidence should escalate, not act. */
  setConfidence(c: number): void
}

export interface RunAgentArgs {
  agentKey: string
  actor?: string
  input?: Record<string, unknown>
  /** When set, the run executes at most once for this key (idempotency). */
  dedupeKey?: string
  work: (ctx: AgentRunContext) => Promise<void>
}

export type RunAgentStatus = 'completed' | 'errored' | 'skipped'

export interface RunAgentResult {
  status: RunAgentStatus
  runId?: string
  reason?: string
}

async function execute(args: RunAgentArgs): Promise<RunAgentResult> {
  const actor = args.actor ?? `agent:${args.agentKey}`

  // (1) Kill switch at run start.
  try {
    await assertKillSwitch(args.agentKey)
  } catch (err) {
    if (err instanceof GatewayDisabledError) return { status: 'skipped', reason: err.message }
    throw err
  }

  const db = getDb()

  // (2) Open the run.
  const { data: runRow, error: runErr } = await db
    .from('agent_runs')
    .insert({
      agent_key: args.agentKey,
      actor,
      input: args.input ?? {},
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (runErr || !runRow) {
    return { status: 'errored', reason: runErr?.message ?? 'could not open agent_run' }
  }
  const runId = runRow.id as string

  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let model = ''
  let confidence: number | null = null

  const ctx: AgentRunContext = {
    runId,
    agentKey: args.agentKey,
    actor,
    async gateway(req) {
      const res = await runGateway({ ...req, agentKey: args.agentKey })
      inputTokens += res.usage.inputTokens
      outputTokens += res.usage.outputTokens
      costUsd += res.costUsd
      model = res.model
      return res
    },
    async recordAction(action) {
      await db.from('agent_actions').insert({
        run_id: runId,
        kind: action.kind,
        actor,
        outcome: action.outcome,
        target_type: action.targetType ?? null,
        target_id: action.targetId ?? null,
        note: action.note ?? null,
      })
      await writeAudit({ actor, action: 'ai.action', entity: action.targetType ?? 'agent_action', entityId: action.targetId ?? runId, diff: { kind: action.kind, outcome: action.outcome } })
    },
    async send(req) {
      // The dispatcher runs the 7-step gate and escalates on block; a blocked
      // message is never sent. We just record the run linkage in the note.
      await dispatch({ ...req, actor, escalationNote: `agent:${args.agentKey} run:${runId}` })
    },
    async escalate(reason, detail) {
      await db.from('agent_actions').insert({
        run_id: runId,
        kind: 'escalation',
        actor,
        outcome: 'escalated',
        reason,
        target_type: detail?.targetType ?? null,
        target_id: detail?.targetId ?? null,
        drafted_content: detail?.draftedContent ?? null,
      })
      await db.from('compliance_events').insert({
        kind: 'agent_escalation',
        actor,
        reason,
        entity_type: detail?.targetType ?? null,
        entity_id: detail?.targetId ?? null,
      })
      await writeAudit({ actor, action: 'ai.escalated', entity: detail?.targetType ?? 'agent_run', entityId: detail?.targetId ?? runId, diff: { reason } })
    },
    setConfidence(c) {
      confidence = c
    },
  }

  // (3)+(4) Run the agent's work with retry on transient failures.
  try {
    await retry(() => args.work(ctx), { retries: 2, baseMs: 300 })
    await db
      .from('agent_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        confidence,
      })
      .eq('id', runId)
    await writeAudit({ actor, action: 'ai.run', entity: 'agent_run', entityId: runId, diff: { agentKey: args.agentKey, model, inputTokens, outputTokens, costUsd } })
    return { status: 'completed', runId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .from('agent_runs')
      .update({ status: 'errored', finished_at: new Date().toISOString(), error: message, model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd })
      .eq('id', runId)
    await writeAudit({ actor, action: 'ai.run', entity: 'agent_run', entityId: runId, diff: { agentKey: args.agentKey, error: message } })
    return { status: 'errored', runId, reason: message }
  }
}

/** Public entry: durable, idempotent agent run. */
export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  if (args.dedupeKey) {
    const outcome = await runIdempotent(args.dedupeKey, `agent:${args.agentKey}`, () => execute(args))
    if (outcome.skipped) return { status: 'skipped', reason: 'duplicate (idempotency key already ran)' }
    return outcome.result as RunAgentResult
  }
  return execute(args)
}
