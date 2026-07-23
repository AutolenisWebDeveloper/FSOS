-- ─────────────────────────────────────────────────────────
-- Migration: 049_comm_delegation_ownership
--
-- Native Communications Platform — SLICE 1: Ownership resolution + delegated
-- agency-owner outreach (master build instruction §6–§7; ADR-015).
--
-- FSOS is the system of record for WHO a message is on behalf of and WHO actually
-- sent it. This slice makes that authoritative in the schema:
--
--   1. agency_communication_delegations — the record that a licensed FSA/team member
--      may communicate ON BEHALF OF an agency owner, scoped by campaign type, channel,
--      contact segment, sender identity, and an effective/expiry window. The send gate
--      (delegation.ts → gate.ts step `delegation`) reads this fresh at send time.
--
--   2. comm_messages ownership columns — the actual communicator (FSA) and the
--      represented party (agency owner / agency / contact owner) are kept DISTINCT on
--      every outbound row (§7 "never collapse these into one ambiguous agent field").
--
--   3. comm_assignment_reviews — the queue for records whose ownership cannot be
--      confidently resolved. Unresolved ownership BLOCKS the send (gate step
--      `ownership`) and lands here for authorized human resolution (§6).
--
-- Additive, forward-only, idempotent. No existing column is altered or dropped; all
-- new comm_messages columns are nullable and default NULL (existing rows unaffected).
-- New tables ship with RLS + the CI firewall-proof extension (tests/rls-firewall).
-- No securities data is stored (firewall §4.1). No GHL surface is touched (§0.A).
-- ─────────────────────────────────────────────────────────

-- ── 1. Delegated agency-communication authority ──────────────────────────
create table if not exists agency_communication_delegations (
  id                          uuid primary key default gen_random_uuid(),
  agency_id                   uuid not null references agency_partnerships(id) on delete cascade,
  agency_owner_id             uuid references agency_owners(id) on delete set null,
  -- The actual communicator: the FSA / licensed team member acting on behalf of the owner.
  representative_user_id      uuid,
  representative_fsa_id       uuid,
  -- Scope. NULL / empty array = "no restriction on this dimension" (all permitted).
  permitted_campaign_types    text[],
  permitted_channels          text[],
  permitted_contact_segments  text[],
  -- Sender-identity allow-lists. Identities land in a later slice (§8/§18); kept as bare
  -- uuid[] here (no FK yet) so the delegation model is complete without forward-referencing
  -- a table that does not exist. NULL = no identity restriction.
  approved_sender_identity_ids uuid[],
  approved_phone_number_ids   uuid[],
  approved_email_domain_ids   uuid[],
  effective_at                timestamptz,
  expires_at                  timestamptz,
  status                      text not null default 'DRAFT'
                                check (status in ('DRAFT','ACTIVE','SUSPENDED','EXPIRED','REVOKED')),
  created_by                  text,
  approved_by                 text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Belt-and-suspenders: a stored window must be coherent (the gate re-checks against `now`).
  check (expires_at is null or effective_at is null or expires_at > effective_at)
);

comment on table agency_communication_delegations is
  'Authority for a licensed FSA/team member to communicate ON BEHALF OF an agency owner, scoped by campaign type/channel/segment/sender-identity and an effective/expiry window. Read fresh at send time by the delegation gate step (delegation.ts). ADR-015.';
comment on column agency_communication_delegations.representative_user_id is
  'The ACTUAL sender (FSA/team member auth user) — distinct from the represented agency owner (§7).';

create index if not exists idx_acd_agency on agency_communication_delegations(agency_id);
create index if not exists idx_acd_active on agency_communication_delegations(agency_id, status)
  where status = 'ACTIVE';
create index if not exists idx_acd_representative on agency_communication_delegations(representative_user_id)
  where representative_user_id is not null;

-- ── 2. Distinct actual-sender vs represented-party attribution on every message ──
alter table comm_messages
  add column if not exists actual_sender_user_id       uuid,
  add column if not exists represented_agent_id         uuid,
  add column if not exists represented_agency_owner_id  uuid references agency_owners(id) on delete set null,
  add column if not exists represented_agency_id        uuid references agency_partnerships(id) on delete set null,
  add column if not exists contact_owner_id             uuid,
  add column if not exists communication_operator_id    uuid,
  -- Book-of-business snapshot maps to the existing spine ownership key (owner_scope);
  -- NOT a new parallel ownership column (master build instruction §0 / ADR-013).
  add column if not exists book_of_business_ref         uuid,
  add column if not exists delegation_id                uuid references agency_communication_delegations(id) on delete set null;

comment on column comm_messages.actual_sender_user_id is
  'The person/service that actually sent this message (FSA/team member) — never conflated with the represented agent (§7, ADR-015).';
comment on column comm_messages.represented_agency_owner_id is
  'The agency owner the FSA is representing / acting on behalf of for this send.';
comment on column comm_messages.delegation_id is
  'The delegation record that authorized this on-behalf-of send (null for direct/transactional/human sends).';

create index if not exists idx_msg_delegation on comm_messages(delegation_id) where delegation_id is not null;
create index if not exists idx_msg_repr_agency on comm_messages(represented_agency_id) where represented_agency_id is not null;

-- ── 3. Assignment-review queue (unresolved ownership → do not send) ──────────
create table if not exists comm_assignment_reviews (
  id            uuid primary key default gen_random_uuid(),
  channel       text check (channel in ('sms','email')),
  -- Normalized destination (phone/email) the send was intended for.
  destination   text,
  member_id     uuid references household_members(id) on delete set null,
  household_id  uuid references households(id) on delete set null,
  agency_id     uuid references agency_partnerships(id) on delete set null,
  campaign_id   uuid references comm_campaigns(id) on delete set null,
  -- Why ownership could not be resolved (human-readable), and the conflicting source
  -- data to display for resolution (§6). No securities substance is ever placed here.
  reason        text not null,
  conflict      jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by   text,
  resolution    text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now()
);

comment on table comm_assignment_reviews is
  'Queue for records whose communication ownership could not be confidently resolved. Unresolved ownership blocks the send (gate step ownership) and lands here for authorized human resolution (§6, ADR-015). Never stores securities substance (firewall §4.1).';

create index if not exists idx_asgn_open on comm_assignment_reviews(status, created_at desc);
create index if not exists idx_asgn_member on comm_assignment_reviews(member_id) where member_id is not null;
create index if not exists idx_asgn_household on comm_assignment_reviews(household_id) where household_id is not null;

-- ── 4. Shared updated_at touch trigger for the two new tables ────────────────
create or replace function comm_delegation_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists acd_updated_at on agency_communication_delegations;
create trigger acd_updated_at before update on agency_communication_delegations
  for each row execute function comm_delegation_touch_updated_at();

drop trigger if exists asgn_updated_at on comm_assignment_reviews;
create trigger asgn_updated_at before update on comm_assignment_reviews
  for each row execute function comm_delegation_touch_updated_at();

-- ── 5. RLS — default-deny; FSA/staff/compliance/supervisor/admin/super read.
--    Writes are service-role only, AFTER an app-layer RBAC assertion (mig 010 pattern).
--    Neither table is client/partner-visible (delegation + ownership are back-office).
alter table agency_communication_delegations enable row level security;
drop policy if exists acd_read on agency_communication_delegations;
create policy acd_read on agency_communication_delegations for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

alter table comm_assignment_reviews enable row level security;
drop policy if exists asgn_read on comm_assignment_reviews;
create policy asgn_read on comm_assignment_reviews for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
