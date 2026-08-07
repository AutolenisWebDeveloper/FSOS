# Life Conversion messaging v4 — center the copy on the actual conversion opportunity

**Date:** 2026-08-07 · **Owner direction:** the FSA (2026-08-07) — the Life Conversion emails/SMS/AI
conversations must be about the term→permanent conversion option itself (policy number, coverage,
conversion expiration date, the no-new-medical-exam privilege where verified), progressing
awareness → education → relevance → partial conversion → deadline → decision → final notice.
Verified facts must come from the policy record, never be inferred or invented; the
"no new medical exam" statement may render only when the policy's conversion rules verifiably
support it.

## Why this is now permissible (§4.3 / ADR-020 reconciliation)

Migration 108's copy avoided all conversion claims because "FSOS holds no verified per-policy
conversion data". That premise no longer holds for this campaign's population:

- Enrollment is drawn exclusively from `v_conversions_due` — policies with a **verified**
  `conversion_deadline` (imported from the FNWL conversion list, `src/lib/import/conversionList.ts`,
  which also writes the verified convertible amount into `face_amount` and the policy number).
- The send gate resolves per-recipient policy facts fail-closed: `{{policy_number}}`,
  `{{policy_face_amount}}`, `{{conversion_expiration_date}}`, `{{days_until_conversion_expires}}`
  are BLOCKING-tier registry variables (variables.ts) resolved by `resolvePolicySource()`; a
  recipient whose record lacks any referenced fact is hard-blocked at gate step `personalization`
  and escalated — never sent a guess (§4.3, ADR-020).
- The exam claim gets its own verified flag: `household_policies.conversion_no_exam`
  (null = unverified). A new COSMETIC registry variable `{{conversion_exam_clause}}` renders
  "with no new medical exam" only when the flag is verified true; otherwise it degrades to the
  always-true neutral "subject to the conversion provisions in your policy".

The red line is unchanged: no individualized recommendation to convert, no product named to
convert into, no premium quotes, no replacement language; every individualized question still
escalates to the licensed FSA (§4.2).

## Changes

1. `supabase/migrations/109_policy_conversion_no_exam.sql` — the verified exam flag (nullable).
2. `supabase/migrations/110_life_conversion_messaging_v4.sql` — in-place UPDATE of the same
   18 `comm_templates` rows (7 email / 6 SMS / 5 AI), version 4, `approval_status='draft'`,
   approval cleared (nothing auto-approves/activates), `introduces_sender` preserved
   (Email 1 / SMS 1 / AI 1 only).
3. `src/lib/comms/variables.ts` — register `conversion_exam_clause` (cosmetic; neutral fallback);
   resolve from `policy.conversion_no_exam === true` in `buildRecipientContext`.
4. `src/lib/comms/policy-context.ts` — select + pass `conversion_no_exam`.
5. `src/app/api/policies/[id]/route.ts` — allow PATCHing `conversion_no_exam` through the
   existing authorized, audited policy endpoint (the verification write surface).
6. `src/lib/life-campaign/playbooks.ts` — conversion-focused playbooks + advisor scripts;
   header constraint rewritten to the verified-facts contract. Policy-fact tokens appear ONLY
   in `opening` (the tick supplies policyId); followUp/handoff/closing stay fact-token-free
   (the AI responder path carries no policy context).
7. Tests (updated first, TDD): `tests/lifecycle-campaign-messaging.test.mjs` (per-campaign
   file/version/token allowlists → 110/v4 + policy tokens for Life Conversion),
   `tests/comms-email-subject.test.mjs` (file pointer), `tests/comms-variables.test.mjs`
   (27 variables + exam-clause resolution contract).
8. `docs/adr/ADR-029-life-conversion-campaign.md` — record the verified-facts copy contract and
   the exam-claim gating.

## Non-goals

- No change to schedule (20 touches / 180 days), eligibility, enrollment, lifecycle, or the gate.
- No import-mapping wiring for `conversion_no_exam` (the FNWL list carries no exam field);
  the flag is set through the audited policy PATCH after human verification. Documented limitation.
- Win-Back and Cross-Sell copy untouched (their v3 files stay authoritative).
