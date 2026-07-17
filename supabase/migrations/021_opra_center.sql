-- ═══════════════════════════════════════════════════════════════════
-- FSOS — OPRA Transfer Center (App A → App B parity, Milestone 1)
-- Migration: 021_opra_center
--
-- Ports the legacy Command Center "OPRA Center" natively onto App B's
-- aggregate-root schema. The legacy module tracked one-policy customers
-- eligible for an OPRA transfer/review on `opra_cases` (keyed to the legacy
-- `customers`/`policies` tables). Here the same workflow is rebuilt on the
-- household spine:
--   • `opra_transfers` — one tracked case per household (contact → appointment
--     → review → transfer status), keyed to households/household_policies and
--     the referring agency partnership;
--   • `v_opra_eligible` — one-policy households not yet tracked (the "eligible
--     for OPRA transfer" list that defines the module);
--   • `v_opra_pipeline` — DB-derived summary counts so dashboard tiles cannot
--     drift from the list.
-- Idempotent: safe to re-run. Nothing here drops or renames a legacy object;
-- the legacy `opra_cases` table is left untouched (App A keeps running).
-- Data backfill from `opra_cases` lives in 022_opra_backfill (separable).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. opra_transfers — the App-B-native OPRA tracking table
-- ─────────────────────────────────────────────────────────
create table if not exists opra_transfers (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  policy_id           uuid references household_policies(id) on delete set null,
  referring_agency_id uuid references agency_partnerships(id) on delete set null,
  transfer_date       date,
  annual_premium      numeric(14,2),
  -- Status tracking (mirrors the legacy one-click toggles; all manual/human).
  contacted           boolean not null default false,
  contacted_at        timestamptz,
  appt_scheduled      boolean not null default false,
  appt_date           timestamptz,
  review_complete     boolean not null default false,
  review_date         date,
  transferred         boolean not null default false,
  transferred_date    date,
  status              text not null default 'identified'
                        check (status in ('identified','contacted','scheduled','reviewed','transferred','declined')),
  -- Securities firewall consistency: a securities-flagged policy is surfaced but
  -- never enrolled in automated outreach (§2.1). Carried from the source policy.
  is_security         boolean not null default false,
  notes               text,
  owner_scope         uuid,                              -- owning FSA user (book scope)
  -- Provenance for idempotent backfill from the legacy table (022).
  legacy_opra_id      uuid unique,
  archived_at         timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One live tracked case per household (a household is "in OPRA" once).
create unique index if not exists uq_opra_transfers_household
  on opra_transfers(household_id) where deleted_at is null;
create index if not exists idx_opra_transfers_status on opra_transfers(status);
create index if not exists idx_opra_transfers_agency on opra_transfers(referring_agency_id);
create index if not exists idx_opra_transfers_transfer_date on opra_transfers(transfer_date);
create index if not exists idx_opra_transfers_uncontacted
  on opra_transfers(created_at) where contacted = false and deleted_at is null;

drop trigger if exists opra_transfers_updated_at on opra_transfers;
create trigger opra_transfers_updated_at before update on opra_transfers
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────────────────
-- 2. v_opra_eligible — one-policy households not yet tracked
--    (the defining "eligible for OPRA transfer" list)
-- ─────────────────────────────────────────────────────────
create or replace view v_opra_eligible
with (security_invoker = true) as
select
  h.id                              as household_id,
  h.primary_name,
  h.referring_agency_id,
  ap.agency_name,
  hp.id                             as policy_id,
  hp.premium                        as annual_premium,
  hp.effective_date                 as transfer_date,
  hp.is_security
from households h
join lateral (
  select id, premium, effective_date, is_security
  from household_policies
  where household_id = h.id and status = 'active'
  order by created_at
  limit 1
) hp on true
left join agency_partnerships ap on ap.id = h.referring_agency_id
where h.do_not_contact = false
  -- exactly one active policy → the classic OPRA "one-policy" eligibility
  and (select count(*) from household_policies x
       where x.household_id = h.id and x.status = 'active') = 1
  -- not already being tracked
  and not exists (
    select 1 from opra_transfers ot
    where ot.household_id = h.id and ot.deleted_at is null
  );

-- ─────────────────────────────────────────────────────────
-- 3. v_opra_pipeline — DB-derived summary counts for the dashboard tiles
-- ─────────────────────────────────────────────────────────
create or replace view v_opra_pipeline
with (security_invoker = true) as
select
  count(*)                                                as total,
  count(*) filter (where contacted = false)               as not_contacted,
  count(*) filter (where appt_scheduled = true)           as appt_scheduled,
  count(*) filter (where review_complete = false
                     and transferred = false)             as ready_to_close,
  count(*) filter (where transferred = true)              as transferred
from opra_transfers
where deleted_at is null;

-- ─────────────────────────────────────────────────────────
-- 4. RLS — default-deny; FSA/staff/admin/compliance/super read.
--    Writes go through the service role after an rbac assertion (like every
--    other App B table); service_role bypasses RLS, so no write policy needed.
-- ─────────────────────────────────────────────────────────
alter table opra_transfers enable row level security;

drop policy if exists opra_transfers_read on opra_transfers;
create policy opra_transfers_read on opra_transfers for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
