// src/lib/ai/roster.ts
// The agent roster metadata (mission, green-zone tools, triggers). This is the
// single source of truth the AI Operations detail page renders. EVERY agent's tool
// set is green-zone ONLY — none holds a "recommend product" tool. The
// compliance_guardrail agent is the hard-block layer and cannot be disabled without
// super + 2FA. Tool names are validated against GREEN_ZONE_TOOLS below.

// Prompt/roster version recorded on every agent_runs row for reproducibility &
// audit (ADR-008 / §11.1). Bump this whenever an agent's mission, system prompt, or
// tool set changes materially, so a stored run can be traced to the exact prompt
// contract that produced it.
export const PROMPT_VERSION = 'roster-2026-08-1'

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
  // Life Win-Back (ADR-034) — re-engage former life-insurance households whose coverage
  // lapsed (the `winback_life` book). Green-zone reconnect INVITE only; never a product
  // rec, never "you should re-buy." Promoted from the former marketing_automation
  // win-back stub to a first-class, kill-switch-gated agent. Disabled by default until
  // the member/consent mapping is verified (no invented consent for a former client).
  life_winback: { key: 'life_winback', mission: 'Re-engage former life-insurance households whose coverage lapsed — educational reconnect invitation only (never a product rec).', tools: ['identify', 'educate', 'invite', 'schedule', 'remind', 'follow_up', 'escalate', 'log'], triggers: 'life-winback outreach queue', confidenceThreshold: 0.8 },
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

// ─── Runtime SURFACE classification (FSOS-050) ───────────────────────────────────
// The roster is metadata for MANY keys; not every key is a live autonomous agent. To stop the
// AI Operations UI from overstating the live surface, each key is classified by how it actually
// executes (verified against runtime callers — runAgent in workforce.ts and runGateway callers):
//   • active              — a real runtime caller executes it (workforce runAgent, a runGateway
//                           route, the campaign dispatcher, the inbound responder, or the gate).
//   • disabled_by_default — a wired agent shipped OFF (kill switch) pending operator verification.
//   • detection_job       — a scheduled SQL/detection cron carries the work; the "agent" is a
//                           label over that job, not a gateway/runAgent execution.
//   • routing_label       — a contactRouter classification label / UI grouping only; never run.
//   • roadmap             — defined metadata with NO runtime path yet (not wired).
// This corrects the Phase-1 FSOS-050 census, which mis-listed executive_intelligence and pipeline
// as non-executing: both ARE live (executive_intelligence via the FSA assistant + household
// next-action runGateway routes; pipeline as the Pipeline Win-Back campaign's AI-author key).
export type AgentSurface = 'active' | 'disabled_by_default' | 'detection_job' | 'routing_label' | 'roadmap'

export const AGENT_SURFACE: Record<string, AgentSurface> = {
  // Live autonomous / user-triggered / gate execution
  executive_intelligence: 'active', // runGateway: /api/app/assistant + households/[id]/next-action
  pipeline: 'active',               // aiAuthorAgentKey of the scheduled pipeline-winback tick
  cross_sell: 'active',             // workforce runAgent (workforce-orchestrator)
  term_conversion: 'active',        // workforce runAgent
  referral_followup: 'active',      // workforce runAgent
  marketing_automation: 'active',   // campaign-dispatch actor
  compliance_guardrail: 'active',   // the hard-block validator on every outbound
  conversation: 'active',           // inbound SMS/email responder
  contact_router: 'active',         // runGateway on contact upload
  content_drafter: 'active',        // runGateway on FSA draft request
  engagement_triager: 'active',     // runGateway on social engagement
  // Wired but shipped OFF pending operator verification
  life_winback: 'disabled_by_default', // seed enabled=false (consent mapping pending)
  // Scheduled detection/SQL jobs (the "agent" is a label over the job)
  data_quality: 'detection_job',    // data-quality cron
  commission_reconciliation: 'detection_job', // commission-reconcile cron (SQL status transition)
  // Routing/UI taxonomy only — never executed as an agent
  agency_activation: 'routing_label',
  referral_triage: 'routing_label',
  // Defined metadata, no runtime path yet
  agency_growth: 'roadmap',
  case_management: 'roadmap',
  document_intelligence: 'roadmap',
}

/** The runtime surface for an agent key (defaults to 'roadmap' for an unknown/unwired key). */
export function agentSurface(key: string): AgentSurface {
  return AGENT_SURFACE[key] ?? 'roadmap'
}

/** Human-readable label for the surface (for the AI Operations UI). */
export function agentSurfaceLabel(s: AgentSurface): string {
  switch (s) {
    case 'active': return 'Active'
    case 'disabled_by_default': return 'Disabled (default)'
    case 'detection_job': return 'Detection job'
    case 'routing_label': return 'Routing only'
    case 'roadmap': return 'Roadmap'
  }
}

/** Assert an agent holds no forbidden tool (unit-testable green-zone proof). */
export function assertGreenZoneOnly(def: AgentDef): void {
  const allowed = new Set<string>(GREEN_ZONE_TOOLS)
  const bad = def.tools.filter((t) => !allowed.has(t))
  if (bad.length) throw new Error(`Agent ${def.key} holds non-green-zone tool(s): ${bad.join(', ')}`)
}
