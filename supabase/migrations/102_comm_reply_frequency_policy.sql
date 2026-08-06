-- ─────────────────────────────────────────────────────────
-- 102 — Reply-scoped frequency caps (ADR-017 amendment)
--
-- WHY. ADR-017's per-recipient frequency caps were written for PROACTIVE outreach: a drip
-- must not text someone twice in an hour. They were never applied to an inbound-triggered
-- conversation reply, because at the time the reply path supplied no `purpose` at all and
-- therefore never entered the policy engine. Classifying replies (so the §11 authority
-- matrix can clear them) also enrolled them in §9 frequency counting for the first time, and
-- the seeded 60-minute minimum interval stalls a normal back-and-forth after ONE AI turn —
-- proven at tests/comms-inbound-e2e.test.mjs §1c:
--     turn 1 sent=true | turn 2 sent=false  → failed|frequency|Minimum interval not met (0m < 60m).
--
-- WHAT. A SECOND cap row, id='reply', selected by the send path for a reply on a live
-- conversation. This is deliberately a ROW, not a code exemption: the ceiling stays real,
-- stays auditable in one place next to the outreach caps, and can be dialled back without a
-- deploy. Answering someone who just texted you is not the mass-outreach case the interval
-- cap exists to bound, so min_interval_minutes is 0 — but the DAILY maxima remain a genuine
-- volumetric bound, which is what keeps this safe to land before the per-conversation turn
-- limit does.
--
-- Config defaults (§4.3): is_assumption = true → the gold "verify" badge. These are NOT
-- Farmers/carrier figures; the FSA sets the real numbers.
--
-- Additive, forward-only, idempotent. No schema change, no RLS change (the caps table's
-- existing policy already governs reads); one INSERT ... ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────

insert into comm_frequency_policy (
  id,
  enabled,
  min_interval_minutes,
  max_sms_per_day,
  max_sms_per_7_days,
  max_marketing_emails_per_day,
  max_marketing_emails_per_7_days,
  max_combined_touches_per_day,
  is_assumption,
  note
)
values (
  'reply',
  true,
  0,   -- a reply answers a message the contact just sent; a spacing interval would stall it
  10,  -- config default — a real per-day ceiling on AI replies to one contact
  40,  -- config default — per-7-day ceiling
  1,   -- replies are never marketing (purpose is always SERVICING); kept at the outreach value
  3,
  12,  -- combined touches/day, slightly above the SMS ceiling to allow a mixed-channel thread
  true,
  'Config default — VERIFY. Reply-scoped caps (ADR-017 amendment): applied ONLY to an inbound-triggered conversation reply, never to campaign/drip outreach, which keeps using the ''global'' row. min_interval is 0 because a reply answers a message the contact just sent; the per-day/per-7-day maxima are the real bound. A capped reply is escalated to the FSA by the conversation path, never silently dropped.'
)
on conflict (id) do nothing;

comment on table comm_frequency_policy is
  'Editable per-recipient frequency caps (§9). Enforced at the send gate (step frequency) as a non-escalating deferral; counts derived from comm_messages. TWO rows: ''global'' bounds proactive campaign/drip outreach; ''reply'' bounds inbound-triggered conversation replies (ADR-017 amendment, migration 102) — the send path selects the row, so neither can be bypassed. Config defaults (is_assumption) — the FSA sets real caps.';
