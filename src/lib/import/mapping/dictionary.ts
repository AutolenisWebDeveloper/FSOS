// src/lib/import/mapping/dictionary.ts
// ─────────────────────────────────────────────────────────────────────────
// Auto-recognition dictionary (design spec v2.1 §2): source header → FSOS
// target field. Exact (squashed) match first, then a conservative fuzzy pass
// (token-overlap, abbreviation-insensitive) so a near-miss header still lands
// with a lower confidence badge instead of falling to "unrecognized".
//
// Composite/derived headers (e.g. "AOR with Series Code") are handled by
// composite.ts, which the plan builder consults BEFORE this dictionary.
// Pure; no I/O.
// ─────────────────────────────────────────────────────────────────────────

import { TARGET_FIELDS, squashHeader, tokenizeHeader, type TargetField } from './fields'

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export interface HeaderMatch {
  fieldId: string
  confidence: MatchConfidence
  /** How the match was made — surfaced in the UI badge and the audit trail. */
  method: 'dictionary' | 'fuzzy'
}

// Exact squashed aliases → target field id. Every value is a squashHeader() key.
// Sourced verbatim from the recognition tables in the v2.1 spec (§2), widened
// with the aliases the live district parsers already accept.
const EXACT_ALIASES: Record<string, string> = {
  // Household
  accountname: 'household.household_name',
  street: 'household.street',
  owneraddress: 'household.street',
  address: 'household.street',
  address1: 'household.street',
  streetaddress: 'household.street',
  mailingstreet: 'household.street',
  city: 'household.city',
  ownercity: 'household.city',
  mailingcity: 'household.city',
  state: 'household.state',
  ownerstate: 'household.state',
  mailingstate: 'household.state',
  mailingstateprovince: 'household.state',
  zip: 'household.zip',
  zipcode: 'household.zip',
  ownerzip: 'household.zip',
  postalcode: 'household.zip',
  mailingzip: 'household.zip',
  preferredhouseholdphone: 'household.preferred_phone',
  preferredphonenumber: 'household.preferred_phone',
  preferredphone: 'household.preferred_phone',
  ownerphonenumber: 'household.preferred_phone',
  phone: 'household.preferred_phone',
  phonenumber: 'household.preferred_phone',
  preferredhouseholdemail: 'household.preferred_email',
  preferredemail: 'household.preferred_email',
  preferredemailaddress: 'household.preferred_email',
  email: 'household.preferred_email',
  emailaddress: 'household.preferred_email',
  activelob: 'household.active_lob',
  currentactivelinesofbusiness: 'household.active_lob',
  activelinesofbusiness: 'household.active_lob',
  inactiveagencylob: 'household.inactive_lob',
  inactiveagencylinesofbusiness: 'household.inactive_lob',
  inactivelob: 'household.inactive_lob',
  inactivelinesofbusiness: 'household.inactive_lob',

  // Member — primary
  ownername: 'member.full_name',
  policyowner: 'member.full_name',
  policyholdername: 'member.full_name',
  policyholder: 'member.full_name',
  primaryinsuredname: 'member.full_name',
  primarynamedinsured: 'member.full_name',
  insuredname: 'member.full_name',
  insuredbirthday: 'member.dob',
  insureddob: 'member.dob',
  dateofbirth: 'member.dob',
  dob: 'member.dob',
  birthday: 'member.dob',

  // Member — joint owner
  jointownername: 'member.joint_full_name',
  jointowneraddress: 'member.joint_address',
  jointownercity: 'member.joint_city',
  jointownerstate: 'member.joint_state',
  jointownerzip: 'member.joint_zip',
  jointownerphone: 'member.joint_phone',

  // Policy
  policynumber: 'policy.policy_number',
  productname: 'policy.product',
  producttype: 'policy.product',
  policystatus: 'policy.policy_status',
  faceamount: 'policy.face_amount',
  coverageamount: 'policy.face_amount',
  convertibleamount: 'policy.convertible_amount',
  accumulationvalue: 'policy.accumulation_value',
  policyvalueasofdate: 'policy.policy_value_asof',
  paidtodate: 'policy.paid_to_date',
  inceptiondate: 'policy.inception_date',
  policyissuedate: 'policy.inception_date',
  conversiondate: 'policy.conversion_date',
  conversionexpiringdate: 'policy.conversion_expiring_date',
  conversionexpirydate: 'policy.conversion_expiring_date',
  expirationdate: 'policy.expiration_date',
  seriescode: 'policy.series_code',

  // Agency attribution
  agentofrecord: 'agency.agent_of_record',
  agencyofrecord: 'agency.agent_of_record',
  agentnumber: 'agency.agent_number',
  aorcode: 'agency.aor_code',
  agencyaor: 'agency.aor_code',
}

// Aliases are squashed (no separators); recover their word tokens by matching a
// small vocabulary of known parts. Falls back to the whole alias as one token.
const VOCAB = [
  'account', 'name', 'street', 'owner', 'address', 'city', 'state', 'mailing', 'province', 'zip', 'code',
  'postal', 'preferred', 'household', 'phone', 'number', 'email', 'active', 'inactive', 'agency', 'lines',
  'of', 'business', 'lob', 'policy', 'holder', 'primary', 'insured', 'named', 'birthday', 'date', 'birth',
  'joint', 'product', 'type', 'status', 'face', 'amount', 'coverage', 'convertible', 'accumulation', 'value',
  'asof', 'paid', 'to', 'inception', 'issue', 'conversion', 'expiring', 'expiry', 'expiration', 'series',
  'agent', 'record', 'aor', 'current', 'dob',
].sort((a, b) => b.length - a.length)

function splitCamelishAlias(alias: string): string[] {
  const out: string[] = []
  let rest = alias
  outer: while (rest.length) {
    for (const w of VOCAB) {
      if (rest.startsWith(w)) {
        out.push(w)
        rest = rest.slice(w.length)
        continue outer
      }
    }
    // Unknown leading char — drop it and continue (keeps the loop finite).
    rest = rest.slice(1)
  }
  return out.length ? out : [alias]
}

// Precomputed token sets per target field for the fuzzy pass: the union of the
// field's own key tokens and the tokens of every exact alias pointing at it.
const FIELD_TOKENS: Array<{ field: TargetField; tokens: Set<string> }> = (() => {
  const byId = new Map<string, Set<string>>()
  for (const f of TARGET_FIELDS) byId.set(f.id, new Set(f.key.split('_').filter(Boolean)))
  for (const [alias, id] of Object.entries(EXACT_ALIASES)) {
    const set = byId.get(id)
    if (set) for (const tok of splitCamelishAlias(alias)) set.add(tok)
  }
  return TARGET_FIELDS.map((field) => ({ field, tokens: byId.get(field.id) ?? new Set<string>() }))
})()

/**
 * Recognize a single source header. Exact squashed alias wins (high). Otherwise a
 * fuzzy token-overlap against every field's token set: a strong overlap is medium,
 * a weak-but-nonzero overlap is low. No match → confidence 'none'.
 */
export function recognizeHeader(header: string): HeaderMatch | null {
  const key = squashHeader(header)
  if (!key) return null

  const exact = EXACT_ALIASES[key]
  if (exact) return { fieldId: exact, confidence: 'high', method: 'dictionary' }

  const tokens = new Set(tokenizeHeader(header).flatMap((t) => splitCamelishAlias(t)))
  if (tokens.size === 0) return null

  let best: { fieldId: string; score: number } | null = null
  for (const { field, tokens: fieldTokens } of FIELD_TOKENS) {
    if (fieldTokens.size === 0) continue
    let shared = 0
    for (const t of tokens) if (fieldTokens.has(t)) shared++
    if (shared === 0) continue
    // Jaccard-style overlap, biased toward covering the field's own tokens.
    const score = shared / Math.max(tokens.size, fieldTokens.size)
    if (!best || score > best.score) best = { fieldId: field.id, score }
  }
  if (!best) return null
  if (best.score >= 0.6) return { fieldId: best.fieldId, confidence: 'medium', method: 'fuzzy' }
  if (best.score >= 0.34) return { fieldId: best.fieldId, confidence: 'low', method: 'fuzzy' }
  return null
}

/** Exposed for tests/tools: the exact alias table (read-only view). */
export function exactAliasCount(): number {
  return Object.keys(EXACT_ALIASES).length
}
