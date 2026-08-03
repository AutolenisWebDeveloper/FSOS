-- ─────────────────────────────────────────────────────────
-- Migration: 095_household_policy_personalization_fields
--
-- Personalization variables — complete the policy/conversion data so the centralized variable
-- registry (src/lib/comms/variables.ts) can resolve every policy field for a recipient. The
-- aggregate-root household_policies table already carries policy_number, effective_date, and
-- conversion_deadline; this adds the remaining fields the requested variables need:
--
--   • issue_date   → {{PolicyIssueDate}}
--   • face_amount  → {{PolicyFaceAmount}}
--   • policy_type  → {{PolicyType}} (denormalized text, mirroring the legacy policies table so a
--                    template resolves the type without a product join)
--
-- {{PolicyEffectiveDate}} already resolves from the existing household_policies.effective_date
-- (the `add column if not exists` below is a documented no-op that makes that explicit).
--
-- Additive, forward-only, idempotent. All columns nullable — existing rows unaffected, and a
-- policy variable referenced without a value still FAILS CLOSED at send (never a blank), per §4.3.
-- No securities data stored (firewall §4.1): a face amount / issue date / type are policy-summary
-- fields, not securities account or transaction data.
-- ─────────────────────────────────────────────────────────

alter table household_policies
  add column if not exists issue_date     date,
  add column if not exists face_amount    numeric(12,2),
  add column if not exists policy_type    text,
  add column if not exists effective_date date;  -- already present; kept for explicitness

comment on column household_policies.issue_date is
  'Policy issue date — resolves {{PolicyIssueDate}} in communications personalization.';
comment on column household_policies.face_amount is
  'Policy face/coverage amount — resolves {{PolicyFaceAmount}}. Not securities data (firewall §4.1).';
comment on column household_policies.policy_type is
  'Denormalized policy type label (e.g. "Term Life") — resolves {{PolicyType}} without a product join.';
