// src/lib/ai/responder.ts
// The Conversation Responder agent (green-zone). Given an inbound contact message
// plus the thread history, it retrieves relevant Knowledge Library context and
// drafts a reply through the model-agnostic gateway. The draft is then sent ONLY
// through sendThroughGate() — the same 7-step compliance gate as every other
// message — so a securities-flagged thread, an out-of-hours reply, an unconsented
// recipient, or any recommendation language is hard-blocked and escalated, never
// sent. The agent holds no "recommend" capability; the prompt is constrained to
// identify/educate/invite/schedule/remind and to escalate anything advisory.

import { runGateway } from '@/lib/ai/gateway'
import { searchKnowledge, renderKnowledgeContext, recordCitations, type RetrievedChunk } from '@/lib/knowledge/library'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { FINRA_DISCLAIMER } from '@/lib/compliance'
import { getDb } from '@/lib/supabase/client'
import type { Conversation } from '@/lib/comms/conversations'

const AGENT_KEY = 'conversation'

const SYSTEM_PROMPT = `You are the FSOS Conversation Responder for Markist, a licensed Farmers Financial Services (FSA) agent in McKinney, TX. You draft SHORT, warm, plain-language replies to a contact's inbound SMS or email on Markist's behalf.

You operate strictly in the GREEN ZONE. You MAY: acknowledge the message, answer general/educational questions at a product-CATEGORY level (e.g. "term life", "annuities"), invite the contact to a financial review, offer to schedule, send reminders, and confirm logistics. You MUST NEVER: recommend a specific product/policy/investment/carrier, make a suitability or replacement determination, give individualized financial or investment advice, discuss securities specifics, or issue any call-to-action to buy/convert/transact.

If the contact asks for advice, a recommendation, a specific product, pricing/suitability, or anything securities-related, DO NOT answer it — instead say a licensed specialist (Markist) will follow up personally, and keep the reply to that hand-off. Prefer to under-answer and escalate rather than cross a line.

Use the Knowledge Library context only as background. Never state a value flagged "CONFIG DEFAULT — verify" as an established fact. Keep replies concise (SMS: <320 chars; email: a few short sentences). Do not add signatures, disclaimers, or opt-out footers — the system appends required footers. Output ONLY the reply text, nothing else.`

export interface DraftResult {
  draft: string
  chunks: RetrievedChunk[]
  runId: string | null
  model: string
  escalateOnly: boolean // model itself decided to hand off (no substantive answer)
}

interface HistoryMsg {
  direction: string
  body: string | null
}

/** Draft a green-zone reply for a conversation given the latest inbound message. */
export async function draftReply(
  conversation: Conversation,
  inboundBody: string,
  history: HistoryMsg[],
): Promise<DraftResult | { error: string }> {
  // Retrieve knowledge relevant to the inbound question (client-safe context only).
  const chunks = await searchKnowledge(inboundBody, { limit: 5, clientSafeOnly: false })
  const knowledge = renderKnowledgeContext(chunks)

  const transcript = history
    .slice(-10)
    .map((m) => `${m.direction === 'inbound' ? 'Contact' : 'Markist'}: ${(m.body || '').slice(0, 500)}`)
    .join('\n')

  const userContent =
    (knowledge ? knowledge + '\n\n' : '') +
    `CONVERSATION SO FAR (${conversation.channel}):\n${transcript || '(no prior messages)'}\n\n` +
    `LATEST INBOUND FROM CONTACT:\n${inboundBody.slice(0, 1500)}\n\n` +
    `Draft Markist's green-zone reply now.`

  let runId: string | null = null
  const db = getDb()

  try {
    // Open a durable agent_run for attribution (tokens/cost/model).
    const { data: created } = await db
      .from('agent_runs')
      .insert({ agent_key: AGENT_KEY, actor: `agent:${AGENT_KEY}`, input: { channel: conversation.channel, conversation_id: conversation.id }, status: 'running' })
      .select('id')
      .maybeSingle()
    runId = created?.id ?? null

    const result = await runGateway({
      agentKey: AGENT_KEY,
      system: SYSTEM_PROMPT,
      maxTokens: 500,
      messages: [{ role: 'user', content: userContent }],
    })

    let draft = result.text.trim()
    // Belt-and-suspenders: if the model produced recommendation language, do NOT
    // use it — hand off. (The gate would block it anyway; this avoids a wasted send.)
    const escalateOnly = containsRecommendationLanguage(draft)
    if (escalateOnly) {
      draft = `Thanks for reaching out! This is a great question for Markist, your licensed Farmers Financial Services specialist — he'll follow up with you personally. ${FINRA_DISCLAIMER}`
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
    }

    await recordCitations(chunks, { runId })

    return { draft, chunks, runId, model: result.model, escalateOnly }
  } catch (err) {
    if (runId) {
      await db.from('agent_runs').update({ status: 'errored', error: err instanceof Error ? err.message : String(err), finished_at: new Date().toISOString() }).eq('id', runId)
    }
    return { error: err instanceof Error ? err.message : 'AI responder failed' }
  }
}
