// src/lib/ai/outreach.ts
// The PURE core of the AI workforce's daily outreach planning. Deliberately DB-free
// (imports nothing) so it compiles/tests in isolation, and so the prioritization +
// quota logic is unit-provable independent of Supabase.
//
// It answers three questions the orchestrator (lib/ai/workforce.ts) asks each day:
//   1. How urgent is each candidate?           → priorityOf()
//   2. Which candidates does an agent work,     → selectForQuota()
//      given its daily quota and firewall/
//      contactability constraints?
//   3. What green-zone instruction drafts it?   → OUTREACH_PROMPTS / buildDraftUserContent()
//
// GUARDRAILS baked in here (not just documented):
//   • Securities firewall — selectForQuota() drops any candidate with is_security or
//     an uncontactable/DNC/no-consent recipient; a securities candidate can NEVER be
//     selected. (The send-time gate is still the final authority.)
//   • Green-zone only — every prompt forbids product/policy/investment/replacement/
//     allocation recommendations and any securities call-to-action; the agents may
//     only identify, educate, invite, schedule, remind, follow up.

/** The four agents that proactively contact clients. Everything else is detection/internal. */
export const OUTREACH_AGENTS = [
  'cross_sell',
  'term_conversion',
  'referral_followup',
  'marketing_automation',
] as const
export type OutreachAgentKey = (typeof OUTREACH_AGENTS)[number]

/** Which detection signal a candidate came from. */
export type OutreachSource = 'cross_sell' | 'term_conversion' | 'referral_followup' | 'win_back'

export interface OutreachCandidate {
  source: OutreachSource
  agentKey: OutreachAgentKey
  entityType: 'household' | 'policy' | 'referral' | 'contact'
  entityId: string
  householdId: string | null
  /** Resolved recipient (best contactable member). Null → cannot contact → not selectable. */
  memberId: string | null
  channel: 'sms' | 'email'
  /** Recipient contactability, resolved by the orchestrator before selection. */
  contactable: boolean
  hasConsent: boolean
  onDNC: boolean
  /** Firewall: a securities-flagged target must never be selected for auto-outreach. */
  isSecurity: boolean
  /** Raw source signal used to rank (e.g. cross-sell gap score, days remaining). */
  signal: OutreachSignal
  reason: string
  recipientName?: string | null
}

/** Source-specific ranking inputs, normalized by priorityOf() to a 0..100 scale. */
export interface OutreachSignal {
  /** cross_sell: v_cross_sell_gaps.score (0..N, higher = bigger gap / no life). */
  gapScore?: number
  /** term_conversion: days until the conversion deadline (smaller = more urgent). */
  daysRemaining?: number
  /** referral_followup: hours since the referral arrived (older = more urgent). */
  ageHours?: number
  /** referral_followup: SLA already breached → top priority. */
  slaBreached?: boolean
  /** win_back: months since the life line lapsed (fresher lapses win back easier). */
  lapsedMonths?: number
}

/** Clamp to the inclusive [lo, hi] range. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Normalize a candidate's source signal to a 0..100 priority (higher = contact
 * sooner). Each source has its own shape, so we map each onto the same scale:
 *   • cross_sell        — bigger coverage gap / no life ⇒ higher (gapScore capped).
 *   • term_conversion   — a closing window is urgent; ≤30d ⇒ ~100, ramping down.
 *   • referral_followup — SLA breach ⇒ 100; otherwise older-waiting ⇒ higher.
 *   • win_back          — a fresher lapse converts more easily ⇒ higher.
 * Pure + deterministic so it is unit-testable.
 */
export function priorityOf(c: Pick<OutreachCandidate, 'source' | 'signal'>): number {
  const s = c.signal
  switch (c.source) {
    case 'cross_sell':
      return clamp(Math.round(s.gapScore ?? 0), 0, 100)
    case 'term_conversion': {
      const d = s.daysRemaining ?? 999
      if (d <= 30) return 100
      if (d <= 90) return 85
      if (d <= 180) return 65
      if (d <= 365) return 40
      return 10
    }
    case 'referral_followup': {
      if (s.slaBreached) return 100
      const age = s.ageHours ?? 0
      // 0h → 50, ramping to 95 by ~48h waiting (first touch should be fast).
      return clamp(Math.round(50 + (age / 48) * 45), 50, 95)
    }
    case 'win_back': {
      const m = s.lapsedMonths ?? 24
      // Fresher lapse ⇒ higher. 0mo → 80, decaying ~2pts/month, floor 20.
      return clamp(Math.round(80 - m * 2), 20, 80)
    }
    default:
      return 0
  }
}

/** A candidate is dispatchable only if it clears the firewall + is reachable + allowed. */
export function isSelectable(c: OutreachCandidate): boolean {
  return (
    !c.isSecurity &&      // §2.1 securities firewall
    c.contactable &&      // we resolved a phone/email
    c.hasConsent &&       // TCPA — no consent, no proactive contact
    !c.onDNC &&           // internal/external DNC
    c.memberId !== null
  )
}

export interface QuotaSelection {
  selected: OutreachCandidate[]
  /** Candidates dropped and why (for the escalation/skip log — never silently dropped). */
  skipped: { candidate: OutreachCandidate; reason: string }[]
}

/**
 * Choose which candidates an agent works today: sort by priority (desc), keep only
 * selectable ones, and take at most `dailyTarget`. Non-selectable candidates are
 * returned in `skipped` with a reason so the workforce never silently drops work —
 * a securities/no-consent/DNC candidate is recorded and can be routed to the human.
 * Pure + deterministic (stable tie-break on entityId) so it is unit-testable.
 */
export function selectForQuota(candidates: OutreachCandidate[], dailyTarget: number): QuotaSelection {
  const ranked = [...candidates].sort((a, b) => {
    const pa = priorityOf(a)
    const pb = priorityOf(b)
    if (pb !== pa) return pb - pa
    return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0
  })

  const selected: OutreachCandidate[] = []
  const skipped: { candidate: OutreachCandidate; reason: string }[] = []

  for (const c of ranked) {
    if (c.isSecurity) { skipped.push({ candidate: c, reason: 'securities_firewall' }); continue }
    if (!c.contactable || c.memberId === null) { skipped.push({ candidate: c, reason: 'no_contact_method' }); continue }
    if (c.onDNC) { skipped.push({ candidate: c, reason: 'on_dnc' }); continue }
    if (!c.hasConsent) { skipped.push({ candidate: c, reason: 'no_consent' }); continue }
    if (selected.length >= Math.max(0, dailyTarget)) { skipped.push({ candidate: c, reason: 'over_daily_quota' }); continue }
    selected.push(c)
  }

  return { selected, skipped }
}

// ─── Green-zone draft prompts (one per outreach agent) ─────────────────────────
// Every prompt is constrained to the green zone: identify/educate/invite/schedule/
// remind/follow-up ONLY. None may recommend a product/policy/investment/carrier,
// make a suitability/replacement determination, or issue a securities call-to-action.
// The draft is still sent ONLY through sendThroughGate(), which re-checks all of this.

const GREEN_ZONE_RULES = `You operate strictly in the GREEN ZONE. You MAY: warmly reach out, educate at a product-CATEGORY level (e.g. "life insurance", "coverage review"), and INVITE the person to a no-obligation review or to schedule a call. You MUST NEVER: recommend a specific product/policy/investment/carrier, state or imply a specific product is right for them, make a suitability or replacement determination, quote a rate, give individualized financial/investment advice, or issue any securities call-to-action. Do not add signatures, disclaimers, or opt-out footers — the system appends required footers. Keep SMS under 300 characters and email to a few short sentences. Output ONLY the message text.`

export const OUTREACH_PROMPTS: Record<OutreachAgentKey, string> = {
  cross_sell: `You are a proactive outreach assistant for Markist, a licensed Farmers Financial Services agent in McKinney, TX. You send a first-touch message to an existing client who may have a coverage gap, INVITING them to a complimentary coverage review. Do not name or push any product. ${GREEN_ZONE_RULES}`,
  term_conversion: `You are a proactive outreach assistant for Markist, a licensed Farmers Financial Services agent in McKinney, TX. You send a short educational note to a client whose term life policy has a conversion window opening, INVITING them to a review to learn about their options before the window. Do not recommend converting or name a product — only educate that options exist and invite a conversation. ${GREEN_ZONE_RULES}`,
  referral_followup: `You are a proactive outreach assistant for Markist, a licensed Farmers Financial Services agent in McKinney, TX. You send a warm first-touch to someone an agency partner referred, introducing Markist and INVITING them to a brief intro call or review. ${GREEN_ZONE_RULES}`,
  marketing_automation: `You are a proactive outreach assistant for Markist, a licensed Farmers Financial Services agent in McKinney, TX. You send a friendly re-engagement note to a former life-insurance household, INVITING them to reconnect and review their coverage. Do not name a product or reference specifics of any prior policy. ${GREEN_ZONE_RULES}`,
}

/** Build the per-candidate user turn for the drafting model (green-zone context only). */
export function buildDraftUserContent(
  c: Pick<OutreachCandidate, 'source' | 'channel' | 'reason' | 'recipientName'>,
  knowledgeContext?: string,
): string {
  const name = c.recipientName?.trim() || 'there'
  return (
    (knowledgeContext ? knowledgeContext + '\n\n' : '') +
    `Recipient first name: ${name}\n` +
    `Channel: ${c.channel}\n` +
    `Why now (context only, do not quote figures as fact): ${c.reason}\n\n` +
    `Draft the green-zone ${c.channel} message now.`
  )
}
