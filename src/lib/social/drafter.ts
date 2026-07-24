// AI Content Drafter (ADR-026, Slice 2) — extends the existing AI workforce.
//
// Produces social post DRAFTS for human approval. It NEVER approves, NEVER publishes,
// and NEVER makes an individualized product/investment/replacement recommendation
// (AI red-line §4.2). Every draft is grounded in the knowledge library (not model
// memory), validated with Zod (fail-safe on bad output), screened for recommendation
// language, confidence-gated against the roster threshold, and logged to agent_runs /
// agent_actions through the same governance as every other agent.

import { getDb } from '@/lib/supabase/client'
import { runGateway, assertKillSwitch, DEFAULT_MODEL } from '@/lib/ai/gateway'
import { AGENT_ROSTER } from '@/lib/ai/roster'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { searchKnowledge, renderKnowledgeContext, recordCitations } from '@/lib/knowledge/library'
import { AIDraftOutputSchema, type AIDraftOutput, type DraftRequest } from './schema'
import { PLATFORM_LABELS, PLATFORM_BODY_LIMITS } from './labels'
import { SOCIAL_BRAND_VOICE, disclaimerFor, ensureDisclaimer } from './brand'
import type { SocialPlatform } from './adapters/types'

// Pinned in one place for migration (the roster/model-anchor convention).
export const CONTENT_DRAFTER_MODEL = DEFAULT_MODEL
// Prompt versioned as a repo artifact; the version is recorded on agent_runs.input.
// v2: brand-voice grounding, per-platform character budgets, mandatory disclaimer.
export const CONTENT_DRAFTER_PROMPT_VERSION = 'content_drafter@v2'

const CONTENT_DRAFTER_SYSTEM = [
  'You are the FSOS Social Content Drafter for a licensed Farmers Financial Services Agent.',
  'You DRAFT educational, compliant social posts for the agent to review — you never publish and never approve.',
  'BRAND VOICE:',
  ...SOCIAL_BRAND_VOICE.map((v) => `• ${v}`),
  'HARD RULES (a violation must never appear in output):',
  '• Never make an individualized product, policy, investment, replacement, allocation, or transaction recommendation.',
  '• Never make a suitability/best-interest determination or a securities "call to action".',
  '• Never invent statistics, testimonials, client outcomes, product facts, or guarantees.',
  '• Only use facts present in the provided knowledge context; if a needed fact is absent, insert a clearly-marked [PLACEHOLDER] instead of inventing it.',
  '• Respect each platform\'s character budget given below — the disclaimer is appended automatically, so stay within the stated body budget.',
  'Educate and invite; do not steer to a product. Keep claims general and informational.',
  'Reply with STRICT JSON ONLY, matching:',
  '{"variants":[{"platform":"<platform>","body":"<text>","hashtags":["#..."]}],"needs_review_flags":["..."],"confidence":<0..1>}',
].join('\n')

// Body budget the model should target = platform limit minus the disclaimer that
// gets appended after generation (plus a 2-char separator).
function bodyBudget(platform: SocialPlatform): number {
  const limit = PLATFORM_BODY_LIMITS[platform] ?? 0
  return Math.max(0, limit - disclaimerFor(platform).length - 2)
}

export interface DrafterResult {
  ok: boolean
  runId: string | null
  output: AIDraftOutput | null
  // True when the draft must go to human review before being trusted (low
  // confidence, a red-line hit, or a validation failure). It ALWAYS goes to a human
  // anyway (drafts never auto-publish) — this flags the held/annotated ones.
  needsReview: boolean
  flags: string[]
  message?: string
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s === -1 || e === -1 || e < s) return null
  try {
    return JSON.parse(text.slice(s, e + 1))
  } catch {
    return null
  }
}

export async function draftContent(req: DraftRequest, actor: string): Promise<DrafterResult> {
  // Kill switch first — a disabled gateway/agent produces nothing.
  await assertKillSwitch('content_drafter')

  const db = getDb()
  const threshold = AGENT_ROSTER.content_drafter?.confidenceThreshold ?? 0.8

  // Ground in the knowledge library (client-safe docs only). When a specific
  // knowledge article is chosen, ground on THAT article; otherwise retrieve by topic.
  const chunks = await searchKnowledge(req.knowledge_document_id ? '' : req.topic, {
    limit: 5,
    clientSafeOnly: true,
    documentId: req.knowledge_document_id,
  })
  const knowledge = renderKnowledgeContext(chunks)

  // Open the run.
  const { data: runRow } = await db
    .from('agent_runs')
    .insert({
      agent_key: 'content_drafter',
      actor: `agent:content_drafter`,
      input: { prompt_version: CONTENT_DRAFTER_PROMPT_VERSION, topic: req.topic, platforms: req.platforms, requested_by: actor },
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()
  const runId = (runRow as { id: string } | null)?.id ?? null

  // Per-platform body budget line so the model targets each platform's limit.
  const platformBudgets = req.platforms
    .map((p) => `${PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] ?? p}: up to ${bodyBudget(p as SocialPlatform)} characters of body`)
    .join('; ')
  const user = [
    knowledge ? knowledge + '\n\n' : '',
    `Draft ${req.platforms.length} social post variant(s) — one per platform.`,
    `Platforms and body budgets — ${platformBudgets}.`,
    `Topic: ${req.topic}.`,
    req.campaign_tag ? `Campaign: ${req.campaign_tag}.` : '',
    `Tone: ${req.tone}. Keep it educational and compliant. Return ONLY the JSON described.`,
  ]
    .filter(Boolean)
    .join('\n')

  let output: AIDraftOutput | null = null
  let model = CONTENT_DRAFTER_MODEL
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  try {
    const res = await runGateway({
      agentKey: 'content_drafter',
      system: CONTENT_DRAFTER_SYSTEM,
      model: CONTENT_DRAFTER_MODEL,
      maxTokens: 1500,
      messages: [{ role: 'user', content: user }],
    })
    model = res.model
    inputTokens = res.usage.inputTokens
    outputTokens = res.usage.outputTokens
    costUsd = res.costUsd
    const parsed = AIDraftOutputSchema.safeParse(extractJson(res.text))
    if (parsed.success) output = parsed.data
  } catch (e) {
    // Fail safe — no draft produced; escalate for human handling.
    await finishRun(db, runId, 'errored', { model, inputTokens, outputTokens, costUsd, confidence: 0, error: e instanceof Error ? e.message : 'gateway error' })
    return { ok: false, runId, output: null, needsReview: true, flags: ['drafter_error'], message: 'The drafter could not produce a valid draft. Escalated for manual drafting.' }
  }

  // Validation failure → fail safe (no draft), route to human.
  if (!output) {
    await finishRun(db, runId, 'completed', { model, inputTokens, outputTokens, costUsd, confidence: 0 })
    return { ok: false, runId, output: null, needsReview: true, flags: ['invalid_output'], message: 'The drafter returned output that failed validation. Escalated for manual drafting.' }
  }

  // Deterministically append the mandatory educational disclaimer to every variant
  // (never trust the model to include it), then screen for red-line language and
  // per-platform overflow. The disclaimer is part of what gets screened/measured.
  for (const v of output.variants) {
    v.body = ensureDisclaimer(v.body, v.platform as SocialPlatform)
  }

  const flags = [...output.needs_review_flags]
  for (const v of output.variants) {
    if (containsRecommendationLanguage(v.body)) flags.push(`recommendation_language:${v.platform}`)
    const limit = PLATFORM_BODY_LIMITS[v.platform as SocialPlatform]
    if (limit && v.body.length > limit) flags.push(`over_limit:${v.platform}`)
  }
  const needsReview = flags.length > 0 || output.confidence < threshold

  // Record provenance + finish the run. Log the action (green-zone draft).
  await recordCitations(chunks, { runId })
  await finishRun(db, runId, 'completed', { model, inputTokens, outputTokens, costUsd, confidence: output.confidence })
  if (runId) {
    await db.from('agent_actions').insert({
      run_id: runId,
      kind: 'draft_content',
      actor: 'agent:content_drafter',
      outcome: needsReview ? 'drafted_flagged' : 'drafted',
      target_type: 'social_content',
      note: needsReview ? `flags: ${flags.join(', ')}` : null,
    })
  }

  return { ok: true, runId, output, needsReview, flags }
}

async function finishRun(
  db: ReturnType<typeof getDb>,
  runId: string | null,
  status: 'completed' | 'errored',
  fields: { model: string; inputTokens: number; outputTokens: number; costUsd: number; confidence: number; error?: string },
): Promise<void> {
  if (!runId) return
  await db
    .from('agent_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      model: fields.model,
      input_tokens: fields.inputTokens,
      output_tokens: fields.outputTokens,
      cost_usd: fields.costUsd,
      confidence: fields.confidence,
      ...(fields.error ? { error: fields.error } : {}),
    })
    .eq('id', runId)
}
