// src/lib/comms/data-confidence.ts
// Slice 6 — Data confidence & source verification (PURE). Master build instruction §13.
//
// FSOS must never send a message making a SPECIFIC claim (a term-conversion deadline, a
// product the contact owns, a lapse/age/appointment status, an agency-ownership fact)
// unless the underlying field is VERIFIED / confident. A generic invitation ("would you
// be open to a review?") needs no verified data; a specific claim does. When confidence
// is insufficient the contact is EXCLUDED and a verification task is raised (§13) — never
// sent on a guess. Pure decision (no DB) → unit-testable offline
// (tests/comms-data-confidence.test.mjs); enforced at the gate (step data_confidence).

export interface ClaimField {
  /** Field name (e.g. 'policy.conversion_deadline', 'product_ownership'). */
  key: string
  /** Whether the field has been verified against a source (verified_at + verified_by). */
  verified: boolean
  /** Optional extraction confidence 0..1 (used when not explicitly verified). */
  confidence?: number
  /** The field is internally conflicting across sources (§13 "conflicting policy records"). */
  conflicting?: boolean
}

export interface DataConfidenceInput {
  /**
   * Does this message assert SPECIFIC claims that depend on the fields below? A generic
   * educational invitation sets this false and always passes (no verified data required).
   */
  makesSpecificClaims: boolean
  /** The fields the specific claims depend on. */
  claims: ClaimField[]
  /** Minimum confidence for an unverified-but-scored field to count as sufficient (default 0.8). */
  minConfidence?: number
}

export interface DataConfidenceDecision {
  allowed: boolean
  reason: string
  /** The fields that were unverified / low-confidence / conflicting (for the verification task). */
  unverified: string[]
}

const DEFAULT_MIN_CONFIDENCE = 0.8

/** A field is sufficient when verified, not conflicting, and (if scored) above threshold. */
function fieldSufficient(f: ClaimField, minConfidence: number): boolean {
  if (f.conflicting) return false
  if (f.verified) return true
  return typeof f.confidence === 'number' && f.confidence >= minConfidence
}

/**
 * Decide whether a message may be sent given the confidence of the fields its specific
 * claims depend on (§13). A message with no specific claims always passes. A message with
 * specific claims passes only when EVERY dependent field is sufficient; otherwise it is
 * excluded and the unverified/conflicting fields are returned for the verification task.
 */
export function evaluateDataConfidence(input: DataConfidenceInput): DataConfidenceDecision {
  if (!input.makesSpecificClaims) {
    return { allowed: true, reason: 'No specific claims — no verified data required.', unverified: [] }
  }
  const min = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const unverified = input.claims.filter((f) => !fieldSufficient(f, min)).map((f) => f.key)
  if (unverified.length > 0) {
    return {
      allowed: false,
      reason: `Unverified/conflicting data for specific claim(s): ${unverified.join(', ')}. Excluded; verification task required (§13).`,
      unverified,
    }
  }
  return { allowed: true, reason: 'All claim fields verified/confident.', unverified: [] }
}
