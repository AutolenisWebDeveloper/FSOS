// src/lib/ai/roster.ts
// The agent roster metadata (mission, green-zone tools, triggers). This is the
// single source of truth the AI Operations detail page renders. EVERY agent's tool
// set is green-zone ONLY — none holds a "recommend product" tool. The
// compliance_guardrail agent is the hard-block layer and cannot be disabled without
// super + 2FA. Tool names are validated against GREEN_ZONE_TOOLS below.

// The complete green-zone tool vocabulary. There is deliberately NO recommend/advise/
// suitability/allocate tool anywhere in this list.
export const GREEN_ZONE_TOOLS = [
  'identify',
  'educate',
  'invite',
  'schedule',
  'remind',
  'follow_up',
  'draft_internal',
  'assemble_data',
  'log',
  'escalate',
  'reconcile_flag',
  'validate_message', // guardrail only
] as const

export type GreenZoneTool = (typeof GREEN_ZONE_TOOLS)[number]

export interface AgentDef {
  key: string
  mission: string
  tools: GreenZoneTool[]
  triggers: string
  confidenceThreshold: number
}

export const AGENT_ROSTER: Record<string, AgentDef> = {
  executive_intelligence: { key: 'executive_intelligence', mission: 'Surface priorities and KPIs for the FSA.', tools: ['assemble_data', 'draft_internal', 'log'], triggers: 'Daily briefing schedule', confidenceThreshold: 0.7 },
  agency_growth: { key: 'agency_growth', mission: 'Identify high-value partner targets (never a product rec).', tools: ['identify', 'assemble_data', 'draft_internal', 'log'], triggers: 'Weekly penetration scan', confidenceThreshold: 0.7 },
  agency_activation: { key: 'agency_activation', mission: 'Schedule green-zone partner check-ins.', tools: ['schedule', 'remind', 'invite', 'escalate', 'log'], triggers: 'Activation stage changes', confidenceThreshold: 0.7 },
  referral_triage: { key: 'referral_triage', mission: 'Dedupe and prioritize inbound referrals.', tools: ['identify', 'assemble_data', 'escalate', 'log'], triggers: 'New referral', confidenceThreshold: 0.75 },
  referral_followup: { key: 'referral_followup', mission: 'Draft consented first-touch outreach.', tools: ['invite', 'remind', 'follow_up', 'escalate', 'log'], triggers: 'SLA timer / no first touch', confidenceThreshold: 0.75 },
  pipeline: { key: 'pipeline', mission: 'Flag stalled opportunities; draft green-zone follow-up.', tools: ['follow_up', 'remind', 'escalate', 'log'], triggers: 'Stage age threshold', confidenceThreshold: 0.7 },
  cross_sell: { key: 'cross_sell', mission: 'Score coverage gaps; enroll in review invitations (never recommend).', tools: ['identify', 'educate', 'invite', 'schedule', 'escalate', 'log'], triggers: 'cross-sell-scan job', confidenceThreshold: 0.75 },
  term_conversion: { key: 'term_conversion', mission: 'Run the educational conversion cadence (no product steering).', tools: ['identify', 'educate', 'invite', 'schedule', 'remind', 'escalate', 'log'], triggers: 'conversion-watch job', confidenceThreshold: 0.8 },
  case_management: { key: 'case_management', mission: 'Track milestones; draft consented status updates.', tools: ['assemble_data', 'follow_up', 'escalate', 'log'], triggers: 'Case status change', confidenceThreshold: 0.7 },
  document_intelligence: { key: 'document_intelligence', mission: 'Assemble prep snapshots; flag missing documents.', tools: ['assemble_data', 'identify', 'escalate', 'log'], triggers: 'Review prep / case requirement', confidenceThreshold: 0.7 },
  commission_reconciliation: { key: 'commission_reconciliation', mission: 'Flag expected-vs-received gaps (no financial advice).', tools: ['reconcile_flag', 'assemble_data', 'escalate', 'log'], triggers: 'commission-reconcile job', confidenceThreshold: 0.7 },
  marketing_automation: { key: 'marketing_automation', mission: 'Run approved campaigns when the gate passes.', tools: ['invite', 'educate', 'remind', 'escalate', 'log'], triggers: 'campaign-dispatch job', confidenceThreshold: 0.8 },
  compliance_guardrail: { key: 'compliance_guardrail', mission: 'Hard-block layer: validate every client-facing message before dispatch.', tools: ['validate_message', 'escalate', 'log'], triggers: 'Every outbound draft', confidenceThreshold: 0.99 },
  data_quality: { key: 'data_quality', mission: 'Flag missing/low-quality data for cleanup.', tools: ['identify', 'assemble_data', 'log'], triggers: 'data-quality job', confidenceThreshold: 0.6 },
  contact_router: { key: 'contact_router', mission: 'Classify uploaded contacts by type and route each to the right agent (never a product rec).', tools: ['identify', 'assemble_data', 'log'], triggers: 'Contact upload', confidenceThreshold: 0.6 },
  conversation: { key: 'conversation', mission: 'Draft green-zone replies to inbound contact messages using the knowledge library; every reply passes the gate before sending.', tools: ['educate', 'invite', 'schedule', 'remind', 'follow_up', 'escalate', 'log'], triggers: 'Inbound SMS/email reply', confidenceThreshold: 0.85 },
  // Social Content Module (ADR-026). Both are green-zone and CANNOT publish/approve —
  // the Content Drafter only produces DRAFTS for human approval; the Engagement
  // Triager classifies inbound engagement and routes it (never a product rec).
  content_drafter: { key: 'content_drafter', mission: 'Draft social post variants from a topic/campaign/knowledge article for human approval (never a product rec, never publish).', tools: ['educate', 'draft_internal', 'assemble_data', 'escalate', 'log'], triggers: 'FSA-initiated draft request', confidenceThreshold: 0.8 },
  engagement_triager: { key: 'engagement_triager', mission: 'Classify inbound social engagement and route it to the right CRM action (never a product rec).', tools: ['identify', 'assemble_data', 'escalate', 'log'], triggers: 'New social engagement', confidenceThreshold: 0.7 },
}

/** Assert an agent holds no forbidden tool (unit-testable green-zone proof). */
export function assertGreenZoneOnly(def: AgentDef): void {
  const allowed = new Set<string>(GREEN_ZONE_TOOLS)
  const bad = def.tools.filter((t) => !allowed.has(t))
  if (bad.length) throw new Error(`Agent ${def.key} holds non-green-zone tool(s): ${bad.join(', ')}`)
}
