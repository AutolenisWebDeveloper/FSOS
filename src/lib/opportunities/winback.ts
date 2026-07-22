// src/lib/opportunities/winback.ts
// The PURE planner that turns an imported Life Win-Back contact (a former life client)
// into an explainable, deduplicated win_back OPPORTUNITY draft. Deliberately DB-free
// (imports nothing) so eligibility, dedup, and the firewall rule are unit-provable in
// isolation — the same discipline as lib/opportunities/crosssell.ts.
//
// Closes the §13.2 gap: win-back contacts are imported (contacts.source='winback_life',
// tagged 'life-winback') and a dashboard reads them, but nothing ever created a tracked,
// attributed, deduplicated pipeline opportunity from a former life client. The impure
// service (lib/opportunities/originate.ts) reads the contacts + existing win_back
// opportunities, calls planWinbackOpportunities(), and persists the drafts.
//
// GUARDRAILS baked in here (not just documented):
//   • Securities firewall — a win-back opportunity is ALWAYS is_security=false. Life
//     win-back is not a securities target. The draft type makes is_security a literal
//     `false`, unforgeable by a caller.
//   • No invented Farmers data (§4.3 / §13.2) — the reason is grounded in the imported
//     win-back list; it NEVER claims a current/active policy or a carrier fact (that
//     data is not captured), and NO commission/premium is invented. The FSA prices it.
//   • Dedup per contact — one OPEN win_back opportunity per contact; a former client is
//     never worked twice concurrently.

/** Provenance tag written to opportunities.source for attribution + dedup. */
export const WIN_BACK_SOURCE = 'win_back'

/** The tag the win-back importer applies when a contact previously held life. */
export const LIFE_WINBACK_TAG = 'life-winback'

/** Contact status that means the win-back has already been worked/closed. */
export const WORKED_STATUS = 'archived'

/** Stages at which an opportunity is finished and no longer blocks re-origination. */
export const TERMINAL_STAGES = ['placed_issued', 'lost'] as const

/** A contacts row (source='winback_life') — the columns the planner needs. */
export interface WinbackContact {
  id: string
  full_name: string | null
  tags: string[] | null
  lines_of_business: string[] | null
  agency_partnership_id: string | null
  household_id: string | null
  status: string | null
}

/** An existing opportunity used only to dedup (contact + source + stage). */
export interface ExistingWinbackOpp {
  contact_id: string | null
  source: string | null
  stage: string
}

export type WinbackEngagement = 'co_sell' | 'direct'

/** The additive opportunity draft the service persists. is_security is a literal false. */
export interface WinbackOpportunityDraft {
  contact_id: string
  household_id: string | null
  referring_agency_id: string | null
  product_id: null
  engagement: WinbackEngagement
  stage: 'prospect'
  is_security: false
  source: typeof WIN_BACK_SOURCE
  reason: string
}

export interface WinbackPlanResult {
  drafts: WinbackOpportunityDraft[]
  skipped: { contact_id: string; reason: 'not_eligible' | 'duplicate_open' }[]
}

/** True when the imported contact previously held life (the win-back signal). */
export function hadLife(c: WinbackContact): boolean {
  return Array.isArray(c.tags) && c.tags.includes(LIFE_WINBACK_TAG)
}

/** Eligible = a real former-life contact that has not already been worked. */
export function isEligibleWinback(c: WinbackContact): boolean {
  return Boolean(c.id) && hadLife(c) && c.status !== WORKED_STATUS
}

/** Agency-attributed contacts are worked as a co-sell with the partner; else direct. */
export function engagementForContact(c: WinbackContact): WinbackEngagement {
  return c.agency_partnership_id ? 'co_sell' : 'direct'
}

/**
 * An evidence-grounded reason. It references the imported win-back list and prior lines
 * ONLY — it never asserts a current/active policy, in-force status, or carrier (that
 * data is not captured; asserting it would violate §13.2 / §4.3).
 */
export function winbackReason(c: WinbackContact): string {
  const priorLines = (c.lines_of_business ?? []).filter((l) => l && l.toLowerCase() !== 'life')
  const extra = priorLines.length ? ` · prior lines: ${priorLines.join(', ')}` : ''
  return `Life win-back: former life client (imported win-back list) — relationship re-engagement review${extra}.`
}

function isTerminal(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

/**
 * Plan win_back opportunity drafts from imported win-back contacts, deduplicated
 * against contacts that already carry an open win_back opportunity (and within the
 * batch itself). Ineligible contacts are skipped with a reason. Every draft is
 * is_security=false.
 */
export function planWinbackOpportunities(
  contacts: WinbackContact[],
  existingOpen: ExistingWinbackOpp[],
): WinbackPlanResult {
  // Contacts already carrying an OPEN win_back opportunity — the dedup guard.
  const openByContact = new Set<string>()
  for (const o of existingOpen) {
    if (o.source !== WIN_BACK_SOURCE) continue
    if (isTerminal(o.stage)) continue
    if (o.contact_id) openByContact.add(o.contact_id)
  }

  const drafts: WinbackOpportunityDraft[] = []
  const skipped: WinbackPlanResult['skipped'] = []
  const draftedThisBatch = new Set<string>()

  for (const c of contacts) {
    if (!isEligibleWinback(c)) {
      skipped.push({ contact_id: c.id, reason: 'not_eligible' })
      continue
    }
    if (openByContact.has(c.id) || draftedThisBatch.has(c.id)) {
      skipped.push({ contact_id: c.id, reason: 'duplicate_open' })
      continue
    }
    draftedThisBatch.add(c.id)
    drafts.push({
      contact_id: c.id,
      household_id: c.household_id,
      referring_agency_id: c.agency_partnership_id,
      product_id: null,
      engagement: engagementForContact(c),
      stage: 'prospect',
      is_security: false,
      source: WIN_BACK_SOURCE,
      reason: winbackReason(c),
    })
  }

  return { drafts, skipped }
}
