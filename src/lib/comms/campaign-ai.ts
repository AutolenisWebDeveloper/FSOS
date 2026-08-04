// src/lib/comms/campaign-ai.ts
// Arm per-thread AI auto-reply on a campaign AI-conversation thread so the customer's replies are
// answered by the governed conversation subsystem (ADR-032: the AI-conversation touches "reuse the
// shared conversation subsystem at the campaign boundaries"), exactly as the manual initiator
// (/api/comms/conversations/start) does after a gated opener. Without this the campaign AI touches
// were one-way openers: a reply hit comm_conversations with ai_autoreply=false and escalated to the
// FSA queue instead of continuing as an AI conversation.
//
// Governance is preserved end-to-end (§4.2 red-line / §11 AI governance):
//   • fails CLOSED — never arms a securities-flagged thread (firewall §4.1), the Compliance
//     Guardrail, or a disabled agent (per-agent kill switch); those threads keep routing replies to
//     the human FSA queue;
//   • arming only ENABLES replies the FSA's approved AI policy already permits — every subsequent AI
//     reply is still independently evaluated by the send gate + AI-authority matrix + kill switch
//     before it can send, so out-of-the-box (no approved AI policy) replies still escalate.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'

/** Arm AI auto-reply on a campaign conversation thread. Idempotent. Returns whether it armed. */
export async function armCampaignAiConversation(
  conversationId: string,
  agentKey: string,
  isSecurity: boolean,
  actor: string,
): Promise<boolean> {
  if (isSecurity) return false // firewall §4.1 — a securities thread is never AI-armed
  const db = getDb()
  const { data: agent } = await db
    .from('ai_agents')
    .select('key, enabled, is_guardrail')
    .eq('key', agentKey)
    .maybeSingle()
  // Kill switch (agent.enabled) + the Compliance Guardrail is never a conversational starter.
  if (!agent || agent.enabled !== true || agent.is_guardrail === true) return false
  await db
    .from('comm_conversations')
    .update({ ai_autoreply: true, agent_key: agentKey, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
  await writeAudit({
    actor,
    action: 'ai.action',
    entity: 'comm_conversation',
    entityId: conversationId,
    diff: { campaign_ai_armed: true, agent: agentKey },
  })
  return true
}
