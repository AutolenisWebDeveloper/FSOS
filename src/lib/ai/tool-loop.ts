// src/lib/ai/tool-loop.ts
// Pure, transport-agnostic driver for a GOVERNED agent tool-calling loop
// (CLAUDE.md §6, §11.1; ADR-002, ADR-007, ADR-028). This is the compliant,
// in-repo alternative to a third-party orchestration platform (ADR-002 rejected
// that explicitly). It owns the loop mechanics — allowlist enforcement, per-tool
// input validation, the authority ceiling, the iteration cap, and a per-turn guard
// (the kill switch) — with NO knowledge of any provider SDK, no DB, and no side
// effects of its own. All model I/O is injected via `callModel`; all tool effects
// happen inside caller-supplied `handler`s. Extracted as a pure core so the
// governance logic is unit-tested without a network or Supabase (mirrors the
// gatewayEnabledFrom / evaluateGate pattern).
//
// Governance invariants enforced here (proven in tests/ai-tool-loop.test.mjs):
//   1. Authority ceiling — a tool whose `effect` is outside `allowedEffects` is
//      rejected before the loop starts (never executed). §11.1 "no autonomous
//      mutation": the v1 caller grants only 'read'.
//   2. Allowlist — the model can only invoke a tool that was granted; an unknown
//      name is recorded and returned to the model as an error, never executed.
//   3. Fail-safe validation — a tool_use whose input fails the tool's validator is
//      NEVER handed to the handler; it fails closed and the model is told why.
//   4. Bounded — the loop stops at `maxIterations` (runaway / cost guard, §11.1).
//   5. Interruptible — `beforeTurn` runs before every model turn; if it throws
//      (kill switch disabled mid-run) the loop halts immediately.

/** The tool's authority classification. v1 grants only 'read' (§11.1). */
export type ToolEffect = 'read' | 'send' | 'write'

/** A neutral content block. The gateway adapter maps these to/from provider blocks. */
export type LoopBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface LoopMessage {
  role: 'user' | 'assistant'
  content: LoopBlock[]
}

export interface ToolUseRequest {
  id: string
  name: string
  input: unknown
}

/** One model turn, already normalized by the transport adapter. */
export interface ModelTurn {
  /** The assistant message to append verbatim (text + tool_use blocks). */
  assistant: LoopMessage
  /** Extracted tool_use requests from this turn (empty → the model is done). */
  toolUses: ToolUseRequest[]
  /** Concatenated assistant text for this turn. */
  text: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface ValidationOk {
  ok: true
  value: unknown
}
export interface ValidationErr {
  ok: false
  error: string
}
export type ValidationResult = ValidationOk | ValidationErr

/** A model-invokable tool. `validate` fails closed; `handler` runs only on valid input. */
export interface LoopTool {
  name: string
  description: string
  effect: ToolEffect
  /** JSON Schema advertised to the model as the tool's input_schema. */
  jsonSchema: Record<string, unknown>
  /** Runtime validator (built from a Zod schema by tools.ts). */
  validate: (input: unknown) => ValidationResult
  /** Side-effecting execution. Returns the tool_result string handed back to the model. */
  handler: (input: unknown) => Promise<string>
}

export type ToolCallStatus = 'ok' | 'rejected' | 'invalid' | 'error'

/** An auditable record of one tool invocation the model attempted. */
export interface ToolCallRecord {
  name: string
  input: unknown
  status: ToolCallStatus
  /** Human-readable reason for rejected/invalid/error; undefined on ok. */
  detail?: string
  /** The handler's returned string on ok. */
  output?: string
}

export type LoopStopReason = 'stop' | 'max_iterations'

export interface ToolLoopOptions {
  initialMessages: LoopMessage[]
  allowedEffects: Set<ToolEffect>
  maxIterations?: number
  /** Runs before every model turn; throw to halt the loop (kill switch). */
  beforeTurn?: () => Promise<void>
}

export interface ToolLoopResult {
  text: string
  calls: ToolCallRecord[]
  iterations: number
  usage: { inputTokens: number; outputTokens: number }
  stopped: LoopStopReason
  messages: LoopMessage[]
}

/** Thrown when a tool's authority exceeds what the caller granted (never executed). */
export class ToolAuthorityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolAuthorityError'
  }
}

function resultBlock(toolUseId: string, content: string, isError = false): LoopBlock {
  return { type: 'tool_result', toolUseId, content, isError }
}

/**
 * Drive the governed tool-calling loop. `callModel` is the ONLY I/O seam — the
 * gateway adapter wires it to Claude; tests inject a fake. No provider SDK, no DB,
 * no ambient side effects: every effect is a caller-supplied `handler`.
 */
export async function driveToolLoop(
  callModel: (messages: LoopMessage[]) => Promise<ModelTurn>,
  tools: LoopTool[],
  opts: ToolLoopOptions,
): Promise<ToolLoopResult> {
  // (1) Authority ceiling — enforce BEFORE any model turn. A tool the caller isn't
  // allowed to grant never enters the loop, so it can never be executed. §11.1.
  for (const t of tools) {
    if (!opts.allowedEffects.has(t.effect)) {
      throw new ToolAuthorityError(
        `tool "${t.name}" has effect "${t.effect}", not permitted here ` +
          `(allowed: ${[...opts.allowedEffects].join(', ') || 'none'})`,
      )
    }
  }

  const byName = new Map(tools.map((t) => [t.name, t]))
  const messages: LoopMessage[] = [...opts.initialMessages]
  const calls: ToolCallRecord[] = []
  const usage = { inputTokens: 0, outputTokens: 0 }
  const maxIterations = opts.maxIterations ?? 6

  let iterations = 0
  let text = ''
  // Default outcome is the bound — only an explicit "no more tools" turn is a clean stop.
  let stopped: LoopStopReason = 'max_iterations'

  while (iterations < maxIterations) {
    // (5) Kill switch re-checked before EVERY turn; a throw halts the whole loop.
    if (opts.beforeTurn) await opts.beforeTurn()
    iterations++

    const turn = await callModel(messages)
    usage.inputTokens += turn.usage.inputTokens
    usage.outputTokens += turn.usage.outputTokens
    text = turn.text

    if (turn.toolUses.length === 0) {
      stopped = 'stop'
      break
    }

    messages.push(turn.assistant)

    const results: LoopBlock[] = []
    for (const use of turn.toolUses) {
      const tool = byName.get(use.name)
      // (2) Allowlist — an ungranted tool is recorded and refused, never executed.
      if (!tool) {
        calls.push({ name: use.name, input: use.input, status: 'rejected', detail: 'tool not in allowlist' })
        results.push(resultBlock(use.id, `Tool "${use.name}" is not available.`, true))
        continue
      }
      // (3) Fail-safe validation — invalid input never reaches the handler.
      const v = tool.validate(use.input)
      if (!v.ok) {
        calls.push({ name: use.name, input: use.input, status: 'invalid', detail: v.error })
        results.push(resultBlock(use.id, `Invalid input for "${use.name}": ${v.error}`, true))
        continue
      }
      try {
        const output = await tool.handler(v.value)
        calls.push({ name: use.name, input: v.value, status: 'ok', output })
        results.push(resultBlock(use.id, output))
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        calls.push({ name: use.name, input: v.value, status: 'error', detail })
        results.push(resultBlock(use.id, `Tool "${use.name}" failed: ${detail}`, true))
      }
    }
    messages.push({ role: 'user', content: results })
  }

  return { text, calls, iterations, usage, stopped, messages }
}
