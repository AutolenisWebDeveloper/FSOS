// src/lib/policy-label.ts
// Human-readable policy-type label derived from a product's family + subtype (e.g. "Term Life").
// Denormalized onto household_policies.policy_type so the {{PolicyType}} personalization variable
// resolves without a product join. Pure — no invented data (§4.3): derived only from real product
// fields, returns null when neither is present (so {{PolicyType}} fails closed rather than guessing).

/** Build a display label from a product family + subtype, or null when both are empty. */
export function policyTypeLabel(family: string | null | undefined, subtype: string | null | undefined): string | null {
  const parts = [subtype, family].map((s) => String(s ?? '').trim()).filter(Boolean)
  if (!parts.length) return null
  return parts.join(' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
