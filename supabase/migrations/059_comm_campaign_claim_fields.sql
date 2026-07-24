-- ─────────────────────────────────────────────────────────
-- Migration: 059_comm_campaign_claim_fields
--
-- Native Communications Platform — SLICE 8 (§18): data-confidence claim declaration.
-- A campaign whose message rests on SPECIFIC per-recipient claims (a term-conversion
-- deadline, a coverage/lapse status, an appointment time — the fields the claim-bearing
-- library blueprints name) declares those fields here. At dispatch the claim resolver
-- reads each recipient's stored value + verification state and passes data-confidence to
-- the gate (§13): an unverified/conflicting claim EXCLUDES the send and raises a
-- verification task — never sent on a guess.
--
-- Additive, forward-only, idempotent. Nullable → existing campaigns declare no claims and
-- are unaffected (the data_confidence gate step stays a no-op for them). RLS inherited from
-- comm_campaigns (mig 010). No securities data (firewall §4.1). No GHL surface (§0.A).
-- ─────────────────────────────────────────────────────────

alter table comm_campaigns
  add column if not exists claim_fields text[];

-- Controlled vocabulary (kept in sync with CLAIM_FIELD_KEYS in src/lib/comms/claims.ts).
-- NULL / empty means "no specific claims". A DB check keeps the column honest even if a
-- write bypasses the Zod edge.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comm_campaigns_claim_fields_check'
  ) then
    alter table comm_campaigns add constraint comm_campaigns_claim_fields_check
      check (
        claim_fields is null
        or claim_fields <@ array['conversion_deadline','policy_status','appointment_at']::text[]
      );
  end if;
end $$;

comment on column comm_campaigns.claim_fields is
  'Specific per-recipient claim fields this campaign''s message depends on (§13/§18). Resolved per recipient at dispatch; an unverified/conflicting field excludes the send + raises a verification task. NULL/empty → no specific claims.';
