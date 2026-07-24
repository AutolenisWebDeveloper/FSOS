// src/lib/comms/claims.ts
// Slice 8 (§18) — Data-confidence claim wiring (PURE part). Master build instruction §13/§18.
//
// A campaign can DECLARE that its message rests on specific per-recipient claims (a term-
// conversion deadline, a coverage/lapse status, an appointment time — the fields the
// claim-bearing library blueprints name). This module maps that declaration + the RESOLVED
// verification state of those fields into the DataConfidenceInput the gate consumes (§13):
// an unverified/conflicting field excludes the send and raises a verification task — never
// sent on a guess. The DB resolution of each field's state lives in claim-resolver.ts; this
// module is pure (no DB, no clock) so it is unit-tested offline (tests/comms-claims.test.mjs).
import type { ClaimField, DataConfidenceInput } from './data-confidence'

/** The claim fields a campaign may declare — matched to the claim-bearing blueprints. */
export const CLAIM_FIELD_KEYS = ['conversion_deadline', 'policy_status', 'appointment_at'] as const
export type ClaimFieldKey = (typeof CLAIM_FIELD_KEYS)[number]

/** Keep only known claim keys from a stored declaration (drop unknown/empty; null → []). */
export function campaignClaimKeys(stored: unknown): ClaimFieldKey[] {
  if (!Array.isArray(stored)) return []
  return stored.filter((k): k is ClaimFieldKey => typeof k === 'string' && (CLAIM_FIELD_KEYS as readonly string[]).includes(k))
}

/**
 * Build the data-confidence gate input from the RESOLVED claim fields (each with its
 * verified/confidence/conflicting state). An empty list → makesSpecificClaims=false, so a
 * campaign that declares no claims is never blocked by the data_confidence step.
 */
export function buildDataConfidence(resolved: ClaimField[], minConfidence?: number): DataConfidenceInput {
  return {
    makesSpecificClaims: resolved.length > 0,
    claims: resolved,
    ...(typeof minConfidence === 'number' ? { minConfidence } : {}),
  }
}
