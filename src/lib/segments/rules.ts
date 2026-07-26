// src/lib/segments/rules.ts
// Slice 5 — the PURE contact-segmentation rule engine (no I/O). A segment is a
// structured rule over contact fields (+ a campaign preset that also consults a
// household signal). Membership (is this contact in the segment?) is decided by the
// rule; eligibility (can we enroll/send to it now?) is decided by per-recipient
// signals the resolver gathers — consent, suppression, a household/member, a contact
// method, completeness. Everything here is unit-testable without a database; the
// resolver (resolve.ts) supplies the signals and the campaign engine enrolls the
// eligible members via household_members.source_contact_id. See ADR-030.

export type SegmentChannel = 'sms' | 'email'
export type SegmentPreset = 'cross_sell' | 'life_conversion' | 'win_back'

// Which household-level signal a preset additionally requires. The resolver reads the
// matching view and passes presetHouseholdMatch per contact.
export type HouseholdSignal = 'cross_sell_gaps' | 'conversions_due' | null

export interface SegmentRule {
  base: 'contacts'
  preset?: SegmentPreset | null
  /** contact_type IN (…). Empty/undefined = any type (except the resolver always drops archived). */
  contactTypes?: string[]
  /** tags && (overlap). */
  tagsAny?: string[]
  /** source IN (…). */
  sources?: string[]
  /** state IN (…). */
  states?: string[]
  /** owner_scope = (book scope). */
  ownerScope?: string | null
  /** Minimum completeness [0..1] to count as eligible (below → 'incomplete'). */
  minCompleteness?: number
  /** Channel the segment targets (consent + contact-method are channel-specific). */
  channel?: SegmentChannel
}

// The contact fields the engine reasons over (a subset of the contacts row).
export interface SegmentContact {
  id: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
  household_id?: string | null
  contact_type?: string | null
  tags?: string[] | null
  source?: string | null
  state?: string | null
  owner_scope?: string | null
  status?: string | null
}

// Per-recipient eligibility signals the resolver gathers from the DB.
export interface EligibilitySignals {
  /** A materialized household_members row exists for this contact (source_contact_id). */
  hasMember: boolean
  /** A granted consent row exists for the member on the segment channel. */
  hasConsent: boolean
  /** Household do_not_contact, a matching DNC entry, or a revoked consent. */
  suppressed: boolean
}

export type ExclusionReason = 'no_household' | 'no_contact_method' | 'no_consent' | 'suppressed' | 'incomplete'

// The three campaign segments ship as first-class presets. Each is a base rule plus
// the household signal its preset consults. contactTypes are advisory hints; the
// authoritative membership for cross_sell/life_conversion is the household view.
export const SEGMENT_PRESETS: Record<SegmentPreset, { key: SegmentPreset; label: string; rule: SegmentRule; householdSignal: HouseholdSignal }> = {
  cross_sell: {
    key: 'cross_sell',
    label: 'Cross-Sell — auto/home, no life',
    rule: { base: 'contacts', preset: 'cross_sell', channel: 'email' },
    householdSignal: 'cross_sell_gaps',
  },
  life_conversion: {
    key: 'life_conversion',
    label: 'Life Conversion — term in conversion window',
    rule: { base: 'contacts', preset: 'life_conversion', channel: 'email' },
    householdSignal: 'conversions_due',
  },
  win_back: {
    key: 'win_back',
    label: 'Win-Back — lapsed/prior-quote life',
    rule: { base: 'contacts', preset: 'win_back', sources: ['winback_life'], tagsAny: ['life-winback'], channel: 'email' },
    householdSignal: null,
  },
}

const COMPLETENESS_FIELDS = 6

/**
 * Completeness [0..1] over the fields that make a contact usable: a real name, email,
 * phone, a household link, a known type, and a state. A blank/placeholder name counts
 * as missing.
 */
export function computeCompleteness(c: SegmentContact): number {
  let present = 0
  const name = (c.full_name || '').trim()
  if (name && name.toLowerCase() !== 'unnamed contact') present++
  if ((c.email || '').trim()) present++
  if ((c.phone || '').trim()) present++
  if (c.household_id) present++
  if (c.contact_type && c.contact_type !== 'unknown') present++
  if ((c.state || '').trim()) present++
  return present / COMPLETENESS_FIELDS
}

const norm = (s?: string | null) => (s || '').trim().toLowerCase()

/**
 * Structural membership: does the contact match the rule's field filters? (Preset
 * household signals are applied by the resolver, not here.) Archived contacts are
 * never members. A win-back-style rule that sets BOTH sources and tagsAny matches on
 * EITHER (source in list OR tag overlap), since a lapsed contact may carry one or the
 * other; all other filters are AND.
 */
export function matchesRule(c: SegmentContact, rule: SegmentRule): boolean {
  if (norm(c.status) === 'archived') return false
  if (rule.contactTypes && rule.contactTypes.length && !rule.contactTypes.includes(c.contact_type ?? 'unknown')) return false
  if (rule.states && rule.states.length && !rule.states.map(norm).includes(norm(c.state))) return false
  if (rule.ownerScope && c.owner_scope !== rule.ownerScope) return false

  const hasSourceFilter = !!(rule.sources && rule.sources.length)
  const hasTagFilter = !!(rule.tagsAny && rule.tagsAny.length)
  if (hasSourceFilter || hasTagFilter) {
    const sourceHit = hasSourceFilter && rule.sources!.map(norm).includes(norm(c.source))
    const tagHit = hasTagFilter && (c.tags ?? []).map(norm).some((t) => rule.tagsAny!.map(norm).includes(t))
    // If the rule declares both, EITHER satisfies it; if only one, that one must hit.
    if (hasSourceFilter && hasTagFilter) { if (!sourceHit && !tagHit) return false }
    else if (hasSourceFilter) { if (!sourceHit) return false }
    else if (!tagHit) return false
  }
  return true
}

/**
 * Given a segment member and its gathered signals, decide eligibility for enrollment
 * and, if excluded, why. Reasons are ordered most-blocking first. This does NOT
 * re-enforce compliance — the dispatcher gate is the enforcement point — it classifies
 * for the preview so the FSA sees exactly who a campaign will reach and who it won't.
 */
export function classifyEligibility(c: SegmentContact, rule: SegmentRule, signals: EligibilitySignals): { eligible: boolean; reasons: ExclusionReason[] } {
  const reasons: ExclusionReason[] = []
  const channel = rule.channel ?? 'email'
  const hasContactMethod = channel === 'email' ? !!(c.email || '').trim() : !!(c.phone || '').trim()

  if (!c.household_id || !signals.hasMember) reasons.push('no_household')
  if (!hasContactMethod) reasons.push('no_contact_method')
  if (signals.suppressed) reasons.push('suppressed')
  if (!signals.hasConsent) reasons.push('no_consent')
  if (typeof rule.minCompleteness === 'number' && computeCompleteness(c) < rule.minCompleteness) reasons.push('incomplete')

  return { eligible: reasons.length === 0, reasons }
}

/** Build a concrete rule from a preset key, or return the rule as-is. */
export function ruleForPreset(preset: SegmentPreset, overrides?: Partial<SegmentRule>): SegmentRule {
  return { ...SEGMENT_PRESETS[preset].rule, ...overrides }
}
