// src/lib/comms/policy-context.ts
// Resolve a recipient's POLICY as a personalization source (DB-backed).
//
// The send path passes a policyId (e.g. the life-conversion campaign's enrollment.policy_id →
// household_policies.id); this loads that row and shapes it for buildRecipientContext (variables.ts),
// so {{PolicyNumber}}, {{PolicyType}}, {{PolicyIssueDate}}, {{PolicyEffectiveDate}},
// {{PolicyFaceAmount}}, {{ConversionExpirationDate}}, and {{DaysUntilConversionExpires}} resolve
// per recipient. Fails SOFT (missing row / lookup error → null): the individual policy variables
// then FAIL CLOSED at the gate (never a blank/guessed value, §4.3) rather than blocking on the
// lookup itself.
//
// Reads only policy-SUMMARY fields — never securities account/order/suitability data (firewall §4.1).
import { getDb } from '@/lib/supabase/client'
import type { PersonalizationSources } from './variables'

export async function resolvePolicySource(
  policyId: string | null | undefined,
): Promise<PersonalizationSources['policy'] | null> {
  if (!policyId) return null
  try {
    const { data } = await getDb()
      .from('household_policies')
      .select('policy_number, policy_type, issue_date, effective_date, face_amount, conversion_deadline')
      .eq('id', policyId)
      .maybeSingle()
    const row = data as {
      policy_number?: string | null
      policy_type?: string | null
      issue_date?: string | null
      effective_date?: string | null
      face_amount?: string | number | null
      conversion_deadline?: string | null
    } | null
    if (!row) return null
    return {
      policy_number: row.policy_number ?? null,
      policy_type: row.policy_type ?? null,
      issue_date: row.issue_date ?? null,
      effective_date: row.effective_date ?? null,
      face_amount: row.face_amount ?? null,
      conversion_deadline: row.conversion_deadline ?? null,
    }
  } catch {
    return null
  }
}
