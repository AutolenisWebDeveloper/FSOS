// src/lib/workshops/logic.ts
// Pure, dependency-free decision logic for the Workshop/Seminar lead engine (P0).
// Kept side-effect-free so it can be unit-tested standalone (compiled by tsc in the
// test harness) AND reused by the API routes. The routes gather the DB facts; these
// functions decide. This mirrors the pattern in src/lib/comms/gate.ts.

// ── Publish hard-gate (defense in depth with the DB trigger in migration 038) ──
// A workshop may only move to 'published' when BOTH compliance prerequisites hold:
//  (a) an APPROVED compliance approval row is referenced, and
//  (b) an APPROVED (verified, non-placeholder) disclosure config is referenced.
// Placeholder disclosure text (is_assumption = true) can therefore never reach a
// published public page. See docs/specs/workshops-seminar-design-spec.md §8.

export interface PublishFacts {
  /** Target status the caller is trying to set. */
  nextStatus: string
  /** True when compliance_approval_ref points at a decision='approved' row. */
  hasApprovedApproval: boolean
  /** True when disclosure_config_id points at an approved (is_assumption=false) config. */
  hasApprovedDisclosure: boolean
}

export interface PublishDecision {
  canPublish: boolean
  /** Machine reasons a publish is blocked (empty when allowed or when not publishing). */
  reasons: PublishBlockReason[]
}

export type PublishBlockReason = 'no_compliance_approval' | 'no_approved_disclosure'

/**
 * Decide whether a status transition to 'published' is permitted. Non-publish
 * transitions are always allowed here (other validation happens in the schema/route).
 */
export function evaluateWorkshopPublish(facts: PublishFacts): PublishDecision {
  if (facts.nextStatus !== 'published') return { canPublish: true, reasons: [] }
  const reasons: PublishBlockReason[] = []
  if (!facts.hasApprovedApproval) reasons.push('no_compliance_approval')
  if (!facts.hasApprovedDisclosure) reasons.push('no_approved_disclosure')
  return { canPublish: reasons.length === 0, reasons }
}

/** Human-readable reason for the staff UI / API error body. */
export function publishBlockMessage(reasons: PublishBlockReason[]): string {
  const parts: string[] = []
  if (reasons.includes('no_compliance_approval'))
    parts.push('a registered-principal compliance approval')
  if (reasons.includes('no_approved_disclosure'))
    parts.push('an approved (non-placeholder) disclosure version')
  if (parts.length === 0) return ''
  return `Cannot publish: this workshop needs ${parts.join(' and ')} before it can go live.`
}

// ── Securities firewall auto-flag (Guardrail 1) ────────────────────────────────
// A workshop is flagged is_security = true (excluded from the automated comms engine,
// purple firewall marker in the UI) when it involves a third-party presenter or a fund
// family — i.e. the event touches securities/investment product marketing. is_security
// only FLAGS + firewalls; it never stores securities account/order/suitability data.

export interface PresenterSecuritySignal {
  is_third_party?: boolean | null
  fund_family?: string | null
  presenter_type?: string | null
}

/** True when any attached presenter makes the workshop securities-touching. */
export function deriveIsSecurity(presenters: PresenterSecuritySignal[]): boolean {
  return presenters.some(
    (p) =>
      p?.is_third_party === true ||
      (typeof p?.fund_family === 'string' && p.fund_family.trim() !== '') ||
      p?.presenter_type === 'wholesaler',
  )
}

// ── Slug generation ────────────────────────────────────────────────────────────
/** URL-safe slug from a title. Deterministic; caller de-dupes against existing slugs. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Append a short suffix to disambiguate a colliding slug. */
export function slugWithSuffix(base: string, suffix: string): string {
  const s = slugify(base)
  const clean = suffix.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6)
  return clean ? `${s}-${clean}` : s
}
