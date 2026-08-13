-- ─────────────────────────────────────────────────────────
-- Migration: 109_policy_conversion_no_exam
--
-- The verified gate for the "no new medical exam" conversion claim (owner-directed 2026-08-07,
-- Life Conversion messaging v4 — see 110_life_conversion_messaging_v4.sql).
--
-- Whether a term policy's conversion privilege can be exercised without new medical underwriting
-- is a carrier/contract rule that is NOT publicly documented, so it may never be assumed (§4.3 /
-- ADR-020). This column records that fact as a VERIFIED per-policy value:
--
--   • null  → unverified (the default for every existing and imported row). The claim is never
--             rendered; {{ConversionExamClause}} degrades to the neutral
--             "subject to the conversion provisions in your policy".
--   • true  → the FSA has confirmed, against the actual policy/carrier conversion rules, that an
--             eligible conversion requires no new medical exam. Only then does
--             {{ConversionExamClause}} render "with no new medical exam".
--   • false → verified that new underwriting IS required — treated exactly like null by the
--             clause (the claim is simply never made), kept distinct for accurate records.
--
-- Written through the existing authorized + audited policy PATCH (src/app/api/policies/[id]);
-- the FNWL conversion-list import does NOT set it (the list carries no exam field), so imports
-- leave it null/unchanged. Read by resolvePolicySource() (src/lib/comms/policy-context.ts) into
-- buildRecipientContext() (src/lib/comms/variables.ts).
--
-- Additive, forward-only, idempotent. Nullable — existing rows unaffected. Not securities data
-- (firewall §4.1): a conversion-underwriting fact on a life policy is policy-summary data.
-- ─────────────────────────────────────────────────────────

alter table household_policies
  add column if not exists conversion_no_exam boolean;

comment on column household_policies.conversion_no_exam is
  'VERIFIED per-policy fact: conversion requires no new medical exam (null = unverified — the no-exam claim is never rendered; gates {{ConversionExamClause}} in communications personalization, §4.3/ADR-020).';
