-- ─────────────────────────────────────────────────────────
-- Migration: 058_comm_builder_purpose_delegation
--
-- Native Communications Platform — SLICE 7 (§15/§16): campaign + sequence BUILDER config.
-- The builder now stores the gate-relevant config that earlier slices deferred (ADR-021,
-- ADR-022): a message `purpose` (§9/§10 — drives purpose-scoped consent + frequency caps +
-- priority collision) and, for a campaign sent ON BEHALF OF an agency owner, the
-- delegated-sender pairing (represented agency owner + the delegation that authorizes it,
-- §7 / ADR-015). Dispatch + simulation read these to run the purpose / delegation gate
-- steps that were previously dark for campaigns.
--
-- Additive, forward-only, idempotent. All columns NULLABLE → existing campaigns/sequences
-- dispatch exactly as before (null purpose / no delegation → those gate steps are no-ops).
-- RLS inherited from comm_campaigns / comm_sequences (mig 010). No securities data
-- (firewall §4.1). No GHL surface (§0.A).
-- ─────────────────────────────────────────────────────────

-- ── Campaign builder: message purpose + delegated-sender ──
alter table comm_campaigns
  add column if not exists purpose                     text,
  add column if not exists represented_agency_owner_id uuid references agency_owners(id) on delete set null,
  add column if not exists delegation_id               uuid references agency_communication_delegations(id) on delete set null;

-- Purpose is a controlled vocabulary (the MessagePurpose set in src/lib/comms/purpose.ts).
-- A DB check keeps the column honest even if a write bypasses the Zod edge; NULL is allowed
-- (no purpose governance). Kept in sync with MESSAGE_PURPOSES.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comm_campaigns_purpose_check'
  ) then
    alter table comm_campaigns add constraint comm_campaigns_purpose_check
      check (purpose is null or purpose in (
        'MARKETING','TRANSACTIONAL','SERVICING','APPOINTMENT','RELATIONSHIP',
        'BIRTHDAY','WORKSHOP','APPLICATION_STATUS','DOCUMENT_REQUEST','POLICY_DEADLINE'
      ));
  end if;
end $$;

create index if not exists idx_campaign_delegation on comm_campaigns(delegation_id)
  where delegation_id is not null;

comment on column comm_campaigns.purpose is
  'Message purpose (MessagePurpose, §9/§10). Drives purpose-scoped consent + frequency caps + priority collision at dispatch. NULL → no purpose governance (channel-wide consent as before).';
comment on column comm_campaigns.represented_agency_owner_id is
  'For a delegated (on-behalf-of) campaign: the REPRESENTED agency owner (§7). Set together with delegation_id. Distinct from the actual sender.';
comment on column comm_campaigns.delegation_id is
  'The agency_communication_delegations record authorizing this on-behalf-of campaign (§7, ADR-015). Resolved FRESH at send time by the delegation gate step; a stale/invalid delegation hard-blocks + escalates.';

-- ── Sequence builder: message purpose (drip default; enrollments inherit) ──
alter table comm_sequences
  add column if not exists purpose text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comm_sequences_purpose_check'
  ) then
    alter table comm_sequences add constraint comm_sequences_purpose_check
      check (purpose is null or purpose in (
        'MARKETING','TRANSACTIONAL','SERVICING','APPOINTMENT','RELATIONSHIP',
        'BIRTHDAY','WORKSHOP','APPLICATION_STATUS','DOCUMENT_REQUEST','POLICY_DEADLINE'
      ));
  end if;
end $$;

comment on column comm_sequences.purpose is
  'Default message purpose for the drip (MessagePurpose, §9/§10). A drip campaign built on this sequence dispatches its steps under this purpose. NULL → no purpose governance.';
