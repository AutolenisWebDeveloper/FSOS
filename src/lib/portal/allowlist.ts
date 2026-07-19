// src/lib/portal/allowlist.ts
// Column allowlists for the partner + client portals (middleware-auth §5,
// portals-admin P-4/P-5). The securities firewall is enforced BY CONSTRUCTION:
// these portals may only ever select an explicit allowlist of columns, and that
// allowlist can never contain a securities/advice/commission field. Even if a
// caller passes '*', pickAllowed() strips everything not on the list.
//
// Pair with RLS (010): RLS denies out-of-scope ROWS; this strips forbidden
// COLUMNS from the rows that are in scope. A securities field can never be
// selected into a client/partner response.

// Fields that must NEVER reach a client/partner portal response, regardless of
// table. A hard second line of defense behind the per-table allowlists.
const FORBIDDEN_FIELD_FRAGMENTS = [
  'is_security',
  'ffs_case_ref',
  'suitability',
  'commission',
  'fsa_amount',
  'fsa_split',
  'aum',
  'expected_commission',
  'actual_commission',
  'license_basis',
  'owner_scope',
  'account_number',
  'order_',
  'holdings',
  'dob_enc',
  'stage_history',
] as const

function isForbidden(field: string): boolean {
  const lower = field.toLowerCase()
  return FORBIDDEN_FIELD_FRAGMENTS.some((frag) => lower.includes(frag))
}

/** Partner portal (agency owner): only status/attribution the owner submitted. */
export const PARTNER_ALLOWLIST: Record<string, string[]> = {
  referrals: ['id', 'referred_name', 'engagement', 'status', 'received_at', 'loss_reason'],
  agency_partnerships: ['id', 'agency_name', 'owner_name', 'status', 'ytd_referrals', 'ytd_placed_premium'],
  // Commissions are comp-disclosure-gated and rendered via a dedicated projection,
  // never through the generic allowlist — so no commission table entry here.
  work_tasks: ['id', 'title', 'due_at', 'completed'],
  comm_templates: ['id', 'name', 'channel', 'category', 'body'],
  appointments: ['id', 'scheduled_at', 'status'],
}

/** Client portal (household): appointments, doc requests, education, consent only. */
export const CLIENT_ALLOWLIST: Record<string, string[]> = {
  households: ['id', 'primary_name', 'city', 'state'],
  appointments: ['id', 'scheduled_at', 'status'],
  document_requests: ['id', 'requirement', 'status', 'created_at'],
  documents: ['id', 'file_name', 'classification', 'created_at'],
  reviews: ['id', 'type', 'stage', 'scheduled_at'], // non-securities review info only
  consents: ['id', 'channel', 'status', 'captured_at'],
  comm_templates: ['id', 'name', 'body'], // approved education materials only
}

/** The Postgrest select string for a table under a portal (never '*'). */
export function selectFor(allowlist: Record<string, string[]>, table: string): string {
  const cols = allowlist[table]
  if (!cols || cols.length === 0) return 'id'
  return cols.filter((c) => !isForbidden(c)).join(', ')
}

/**
 * Strip any field not on the allowlist (and any forbidden field) from a row or
 * rows. Defense-in-depth: even a raw '*' fetch is sanitized before it renders.
 */
export function pickAllowed<T extends Record<string, unknown>>(
  allowlist: Record<string, string[]>,
  table: string,
  rows: T[],
): Partial<T>[] {
  const cols = (allowlist[table] ?? []).filter((c) => !isForbidden(c))
  const set = new Set(cols)
  return rows.map((row) => {
    const out: Partial<T> = {}
    for (const key of Object.keys(row)) {
      if (set.has(key) && !isForbidden(key)) out[key as keyof T] = row[key as keyof T]
    }
    return out
  })
}

/** Assert a projection contains no forbidden field (unit-testable firewall proof). */
export function assertNoForbiddenColumns(columns: string[]): void {
  const bad = columns.filter(isForbidden)
  if (bad.length) {
    throw new Error(`Portal column allowlist violation: forbidden field(s) ${bad.join(', ')}`)
  }
}
