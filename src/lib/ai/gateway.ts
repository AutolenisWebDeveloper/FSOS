// src/lib/ai/gateway.ts
// The model-agnostic AI gateway (CLAUDE.md §1, §6). ALL AI calls go through here —
// never call a provider SDK directly from a route/component. Claude-first, with
// OpenAI + Gemini as configured REST fallbacks. Enforces the kill switch (per-agent
// + global) at call start, logs tokens + estimated cost, and returns a normalized
// result. Wraps the existing lib/anthropic.ts client (does not recreate it).

import { getAnthropic } from '@/lib/anthropic'
import { getDb } from '@/lib/supabase/client'

export type Provider = 'claude' | 'openai' | 'gemini'

export interface GatewayMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A binary document attached to the FIRST user message so the model can read it
 * natively — a PDF (Claude reads text AND scanned pages, i.e. the OCR path) or an
 * image. Claude-only; other providers ignore attachments (the caller degrades to a
 * text path). `data` is base64 (no data: prefix).
 */
export interface GatewayAttachment {
  kind: 'pdf' | 'image'
  media_type: string
  data: string
}

export interface GatewayRequest {
  system?: string
  messages: GatewayMessage[]
  /** Primary model id (defaults to Claude). */
  model?: string
  maxTokens?: number
  /** Ordered fallback model ids tried if the primary provider errors. */
  fallback?: string[]
  /** Agent key for the kill switch + run attribution (e.g. "pipeline"). */
  agentKey?: string
  /** Binary documents (PDF/image) attached to the first user turn (Claude native). */
  attachments?: GatewayAttachment[]
}

export interface GatewayUsage {
  inputTokens: number
  outputTokens: number
}

export interface GatewayResult {
  text: string
  provider: Provider
  model: string
  usage: GatewayUsage
  costUsd: number
}

export class GatewayDisabledError extends Error {
  constructor(scope: string) {
    super(`AI gateway disabled by kill switch (${scope}).`)
    this.name = 'GatewayDisabledError'
  }
}

// Default routing. Claude-first; the app already standardizes on Claude models.
export const DEFAULT_MODEL = 'claude-sonnet-5'

// Provider inferred from model id prefix.
export function providerOf(model: string): Provider {
  if (model.startsWith('claude')) return 'claude'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'gemini'
  return 'claude'
}

// Price table ($ per 1M tokens) — CONFIG DEFAULT, assumption-flagged; verify
// against current provider pricing. Used only for cost estimation/telemetry.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gemini-1.5-pro': { in: 1.25, out: 5 },
}

export function estimateCostUsd(model: string, usage: GatewayUsage): number {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (usage.inputTokens / 1_000_000) * p.in + (usage.outputTokens / 1_000_000) * p.out
}

// ─── Kill switch (§6) ─────────────────────────────────────────────────────────

/** Global gateway switch. Env override for infra; DB flag is the operator control. */
async function isGatewayEnabled(): Promise<boolean> {
  if (process.env.AI_GATEWAY_DISABLED === '1') return false
  try {
    const { data } = await getDb()
      .from('ai_policies')
      .select('gateway_enabled')
      .eq('id', 'global')
      .maybeSingle()
    // Default enabled when unconfigured (fail-open only for the GLOBAL flag; the
    // per-agent check below fails safe to enabled=false when a row is missing).
    return data?.gateway_enabled !== false
  } catch {
    return true
  }
}

async function isAgentEnabled(agentKey: string): Promise<boolean> {
  try {
    const { data } = await getDb().from('ai_agents').select('enabled').eq('key', agentKey).maybeSingle()
    return data?.enabled === true
  } catch {
    return false
  }
}

export async function assertKillSwitch(agentKey?: string): Promise<void> {
  if (!(await isGatewayEnabled())) throw new GatewayDisabledError('global')
  if (agentKey && !(await isAgentEnabled(agentKey))) throw new GatewayDisabledError(`agent:${agentKey}`)
}

// ─── Providers (lazy; never called at module load) ────────────────────────────

// Build a Claude content block for one attachment. PDFs use a `document` block
// (native text + vision, incl. scanned pages); images use an `image` block. Typed
// loosely because the pinned SDK's message types predate document blocks.
function attachmentBlock(a: GatewayAttachment): unknown {
  if (a.kind === 'pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } }
}

async function callClaude(req: GatewayRequest, model: string): Promise<GatewayResult> {
  const client = getAnthropic()
  const attachments = req.attachments ?? []

  // Attach binaries to the FIRST user message as document/image blocks + the text.
  let attached = false
  const messages = req.messages.map((m) => {
    if (!attached && m.role === 'user' && attachments.length) {
      attached = true
      const blocks = [
        ...attachments.map(attachmentBlock),
        { type: 'text', text: m.content },
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { role: m.role, content: blocks as any }
    }
    return { role: m.role, content: m.content }
  })

  const res = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 2048,
    system: req.system,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: messages as any,
  })
  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
  const usage: GatewayUsage = {
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  }
  return { text, provider: 'claude', model, usage, costUsd: estimateCostUsd(model, usage) }
}

async function callOpenAI(req: GatewayRequest, model: string): Promise<GatewayResult> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2048,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages,
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const usage: GatewayUsage = {
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  }
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    provider: 'openai',
    model,
    usage,
    costUsd: estimateCostUsd(model, usage),
  }
}

async function callGemini(req: GatewayRequest, model: string): Promise<GatewayResult> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  const contents = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        contents,
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const usage: GatewayUsage = {
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  }
  return {
    text: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    provider: 'gemini',
    model,
    usage,
    costUsd: estimateCostUsd(model, usage),
  }
}

function callProvider(req: GatewayRequest, model: string): Promise<GatewayResult> {
  switch (providerOf(model)) {
    case 'openai':
      return callOpenAI(req, model)
    case 'gemini':
      return callGemini(req, model)
    default:
      return callClaude(req, model)
  }
}

/**
 * Run a completion through the gateway: kill-switch → primary model → configured
 * fallbacks on error. Returns normalized text + usage + estimated cost. The caller
 * (jobs/agent-runner.ts) persists these to agent_runs.
 */
export async function runGateway(req: GatewayRequest): Promise<GatewayResult> {
  await assertKillSwitch(req.agentKey)
  const chain = [req.model ?? DEFAULT_MODEL, ...(req.fallback ?? [])]
  let lastErr: unknown
  for (const model of chain) {
    try {
      return await callProvider(req, model)
    } catch (err) {
      lastErr = err
      // Try the next configured fallback model/provider.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI gateway: all providers failed')
}
