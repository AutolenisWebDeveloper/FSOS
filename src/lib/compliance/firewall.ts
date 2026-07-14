// src/lib/compliance/firewall.ts
// GUARDRAIL 1 — Securities firewall (CLAUDE.md §2.1, data-guardrails §3).
// FSOS is NOT a broker-dealer system of record. It may store the EXISTENCE of a
// securities case (stage, engagement, agency, expected/actual commission) and a
// non-substantive pointer (ffs_case_ref) — never account numbers, order details,
// suitability determinations, or securities client communications.
//
// This module is pure (no I/O) so it can gate writes in any layer and be unit
// tested offline (tests/guardrail.test.mjs).

/** Field-name fragments that indicate substantive securities data FSOS may not store. */
export const SECURITIES_FORBIDDEN_FIELD_PATTERNS = [
  'account_number',
  'account_no',
  'acct_number',
  'order_id',
  'order_details',
  'order_ticket',
  'trade_',
  'securities_account',
  'brokerage_account',
  'suitability_determination',
  'suitability_result',
  'reg_bi_determination',
  'securities_communication',
  'securities_message',
  'holdings',
  'positions',
] as const

// The ONLY securities reference FSOS may persist: a non-substantive pointer.
const ALLOWED_SECURITIES_REF = new Set(['ffs_case_ref', 'suitability_status_pointer'])

export class FirewallError extends Error {
  readonly fields: string[]
  constructor(fields: string[]) {
    super(
      `Securities firewall: payload contains substantive securities field(s) FSOS may not store: ${fields.join(
        ', ',
      )}. Store only a non-substantive ffs_case_ref pointer.`,
    )
    this.name = 'FirewallError'
    this.fields = fields
  }
}

/** Scan an object's keys (deep) for forbidden securities fields. Pure. */
export function findForbiddenSecuritiesFields(payload: unknown, path = ''): string[] {
  if (!payload || typeof payload !== 'object') return []
  const hits: string[] = []
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const full = path ? `${path}.${key}` : key
    const lower = key.toLowerCase()
    if (!ALLOWED_SECURITIES_REF.has(lower)) {
      for (const pat of SECURITIES_FORBIDDEN_FIELD_PATTERNS) {
        if (lower.includes(pat)) {
          hits.push(full)
          break
        }
      }
    }
    if (value && typeof value === 'object') hits.push(...findForbiddenSecuritiesFields(value, full))
  }
  return hits
}

/**
 * Throw if a write payload would make FSOS a securities system of record.
 * Call before persisting opportunities/policies/cases/commissions.
 */
export function assertNotSecuritiesSystemOfRecord(payload: unknown): void {
  const fields = findForbiddenSecuritiesFields(payload)
  if (fields.length) throw new FirewallError(fields)
}

/** True if an entity is securities-flagged and thus excluded from automation. */
export function isSecurity(entity: unknown): boolean {
  return !!entity && typeof entity === 'object' && (entity as { is_security?: unknown }).is_security === true
}
