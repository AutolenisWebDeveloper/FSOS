// src/lib/import/mapping/fields.ts
// ─────────────────────────────────────────────────────────────────────────
// Canonical FSOS target-field catalog for the Contact Import mapping model
// (design spec v2.1 §2). This is the vocabulary the recognizer maps source
// headers INTO and the dropdown the operator picks from when a header is
// unrecognized. It spans the four import entities — household, member (person),
// policy, and agency attribution — so a single unified mapper can recognize any
// of the five district exports without a per-file parser.
//
// Pure data + helpers only; no I/O, no clock, no randomness (safe for tests and
// deterministic replay).
// ─────────────────────────────────────────────────────────────────────────

export type FieldEntity = 'household' | 'member' | 'policy' | 'agency'

/** Data type of a target/custom field — drives normalization + the custom-field UI. */
export type FieldType = 'text' | 'email' | 'phone' | 'state' | 'date' | 'number' | 'tag'

/** Person-role a member field belongs to (owner + joint owner group into one household). */
export type MemberRole = 'primary' | 'joint_owner'

export interface TargetField {
  /** Stable id, `${entity}.${key}` — persisted in templates/memory, sent over the wire. */
  id: string
  entity: FieldEntity
  key: string
  role?: MemberRole
  label: string
  type: FieldType
}

// The catalog. Order is presentation order in the field-picker dropdown.
export const TARGET_FIELDS: TargetField[] = [
  // ── Household ──────────────────────────────────────────────────────────
  { id: 'household.household_name', entity: 'household', key: 'household_name', label: 'Household — name', type: 'text' },
  { id: 'household.street', entity: 'household', key: 'street', label: 'Household — street', type: 'text' },
  { id: 'household.city', entity: 'household', key: 'city', label: 'Household — city', type: 'text' },
  { id: 'household.state', entity: 'household', key: 'state', label: 'Household — state', type: 'state' },
  { id: 'household.zip', entity: 'household', key: 'zip', label: 'Household — ZIP', type: 'text' },
  { id: 'household.preferred_phone', entity: 'household', key: 'preferred_phone', label: 'Household — preferred phone', type: 'phone' },
  { id: 'household.preferred_email', entity: 'household', key: 'preferred_email', label: 'Household — preferred email', type: 'email' },
  { id: 'household.active_lob', entity: 'household', key: 'active_lob', label: 'Household — active LOB (tag)', type: 'tag' },
  { id: 'household.inactive_lob', entity: 'household', key: 'inactive_lob', label: 'Household — inactive LOB (tag)', type: 'tag' },

  // ── Member — primary (owner / policyholder / primary insured) ──────────
  { id: 'member.full_name', entity: 'member', key: 'full_name', role: 'primary', label: 'Primary member — full name', type: 'text' },
  { id: 'member.phone', entity: 'member', key: 'phone', role: 'primary', label: 'Primary member — phone', type: 'phone' },
  { id: 'member.email', entity: 'member', key: 'email', role: 'primary', label: 'Primary member — email', type: 'email' },
  { id: 'member.address', entity: 'member', key: 'address', role: 'primary', label: 'Primary member — address', type: 'text' },
  { id: 'member.dob', entity: 'member', key: 'dob', role: 'primary', label: 'Primary member — DOB', type: 'date' },

  // ── Member — joint owner (distinct person, same household) ──────────────
  { id: 'member.joint_full_name', entity: 'member', key: 'joint_full_name', role: 'joint_owner', label: 'Joint owner — full name', type: 'text' },
  { id: 'member.joint_address', entity: 'member', key: 'joint_address', role: 'joint_owner', label: 'Joint owner — address', type: 'text' },
  { id: 'member.joint_city', entity: 'member', key: 'joint_city', role: 'joint_owner', label: 'Joint owner — city', type: 'text' },
  { id: 'member.joint_state', entity: 'member', key: 'joint_state', role: 'joint_owner', label: 'Joint owner — state', type: 'state' },
  { id: 'member.joint_zip', entity: 'member', key: 'joint_zip', role: 'joint_owner', label: 'Joint owner — ZIP', type: 'text' },
  { id: 'member.joint_phone', entity: 'member', key: 'joint_phone', role: 'joint_owner', label: 'Joint owner — phone', type: 'phone' },

  // ── Policy (optional linked entity — Conversion / Book files) ───────────
  { id: 'policy.policy_number', entity: 'policy', key: 'policy_number', label: 'Policy — number', type: 'text' },
  { id: 'policy.product', entity: 'policy', key: 'product', label: 'Policy — product', type: 'text' },
  { id: 'policy.policy_status', entity: 'policy', key: 'policy_status', label: 'Policy — status', type: 'text' },
  { id: 'policy.face_amount', entity: 'policy', key: 'face_amount', label: 'Policy — face amount', type: 'number' },
  { id: 'policy.convertible_amount', entity: 'policy', key: 'convertible_amount', label: 'Policy — convertible amount', type: 'number' },
  { id: 'policy.accumulation_value', entity: 'policy', key: 'accumulation_value', label: 'Policy — accumulation value', type: 'number' },
  { id: 'policy.policy_value_asof', entity: 'policy', key: 'policy_value_asof', label: 'Policy — value as-of date', type: 'date' },
  { id: 'policy.paid_to_date', entity: 'policy', key: 'paid_to_date', label: 'Policy — paid-to date', type: 'date' },
  { id: 'policy.inception_date', entity: 'policy', key: 'inception_date', label: 'Policy — inception date', type: 'date' },
  { id: 'policy.conversion_date', entity: 'policy', key: 'conversion_date', label: 'Policy — conversion date', type: 'date' },
  { id: 'policy.conversion_expiring_date', entity: 'policy', key: 'conversion_expiring_date', label: 'Policy — conversion expiring date', type: 'date' },
  { id: 'policy.expiration_date', entity: 'policy', key: 'expiration_date', label: 'Policy — expiration date', type: 'date' },
  { id: 'policy.series_code', entity: 'policy', key: 'series_code', label: 'Policy — series code', type: 'text' },

  // ── Agency attribution → referring_agency / owning agent ───────────────
  { id: 'agency.agent_of_record', entity: 'agency', key: 'agent_of_record', label: 'Agency — agent of record', type: 'text' },
  { id: 'agency.agent_number', entity: 'agency', key: 'agent_number', label: 'Agency — agent number', type: 'text' },
  { id: 'agency.aor_code', entity: 'agency', key: 'aor_code', label: 'Agency — AOR code', type: 'text' },
]

const BY_ID = new Map(TARGET_FIELDS.map((f) => [f.id, f]))

export function getTargetField(id: string): TargetField | undefined {
  return BY_ID.get(id)
}

export function isTargetFieldId(id: string): id is string {
  return BY_ID.has(id)
}

/** Normalize a source header to a comparison key: lowercased, punctuation/space stripped. */
export function squashHeader(h: string): string {
  return (h || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Split a header into lowercase word tokens (for fuzzy token-overlap matching). */
export function tokenizeHeader(h: string): string[] {
  return (h || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}
