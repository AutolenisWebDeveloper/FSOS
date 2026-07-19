-- 016_gdc_ffs_config.sql
-- Legacy-port config surfaces (docs/legacy-port.md 2.2 GDC & Commission, 2.4 FFS
-- Contacts). Two config-driven tables that feed the sidebar character panels
-- (design-system.md 5.3B GDC tier gold card, 5.3C FFS quick-access) and their
-- /super/config editors.
--
-- GUARDRAIL 3 (No invented Farmers data): GDC tier thresholds/payouts are NOT
-- publicly documented Farmers figures. Every tier ships is_assumption = true and
-- renders the gold "config default - verify" badge. FFS contact details are
-- config-driven, never hard-coded.
--
-- RLS: default-deny. Config is read-only to internal staff, editable only via the
-- service role after an rbac assertion in the API route (writes audited there).
--
-- NOTE: comments here are kept on their own lines and contain no semicolons, so
-- every statement terminator in this file is a real one (safe for naive splitters).

-- ---------------------------------------------------------------------------
-- 1. GDC tiers - rolling-12mo Gross Dealer Concession -> FSA payout percent.
--    Assumption-flagged config, never a Farmers-published figure.
--    Columns:
--      tier_no  - 1..n, ascending by threshold
--      min_gdc  - inclusive floor of the rolling-12mo GDC band
--      max_gdc  - exclusive ceiling, equals the next tier's floor
--                 (half-open [min, max)), null for the open-ended top tier
--      payout_pct - FSA payout percent at this tier
-- ---------------------------------------------------------------------------
create table if not exists gdc_tiers (
  id            uuid primary key default gen_random_uuid(),
  tier_no       integer not null unique,
  label         text not null,
  min_gdc       numeric(14,2) not null default 0,
  max_gdc       numeric(14,2),
  payout_pct    numeric(5,2) not null,
  is_assumption boolean not null default true,
  active        boolean not null default true,
  note          text,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (payout_pct >= 0 and payout_pct <= 100),
  check (max_gdc is null or max_gdc >= min_gdc)
);

create index if not exists idx_gdc_tiers_active on gdc_tiers(active);

-- ---------------------------------------------------------------------------
-- 2. FFS key contacts - config-driven quick-access directory (sidebar panel).
--    slug is a stable idempotent seed/upsert key.
--    name may be null for a desk line rather than a person.
-- ---------------------------------------------------------------------------
create table if not exists ffs_contacts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  role          text not null,
  name          text,
  phone         text not null,
  hours         text,
  note          text,
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_ffs_contacts_active on ffs_contacts(active, sort);

-- ---------------------------------------------------------------------------
-- 3. RLS - default-deny. Internal staff read, no client/partner exposure.
-- ---------------------------------------------------------------------------
alter table gdc_tiers enable row level security;
alter table ffs_contacts enable row level security;

-- GDC tiers: FSA production tracking plus super/compliance oversight and admin.
drop policy if exists gdc_tiers_read on gdc_tiers;
create policy gdc_tiers_read on gdc_tiers for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

-- FFS contacts: any internal staff role may read the directory (sidebar panel).
-- Never clients or agency owners.
drop policy if exists ffs_contacts_read on ffs_contacts;
create policy ffs_contacts_read on ffs_contacts for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or has_role('admin') or has_role('ops') or has_role('case_manager')
);

-- ---------------------------------------------------------------------------
-- 4. Seeds - assumption-flagged config defaults (docs/legacy-port.md 2.2, 2.4).
--    GDC tier values are NOT Farmers-published. Verify against contract.
--    Half-open bands [min, max): each tier's max_gdc equals the next tier's
--    min_gdc, so boundary values (exactly 15000 / 55000) belong to the upper
--    tier and no dollar range is unowned.
-- ---------------------------------------------------------------------------
insert into gdc_tiers (tier_no, label, min_gdc, max_gdc, payout_pct, is_assumption, sort, note) values
  (1, 'Tier 1',     0, 15000, 40, true, 1, 'config default - verify, not a Farmers-published figure'),
  (2, 'Tier 2', 15000, 55000, 60, true, 2, 'config default - verify, not a Farmers-published figure'),
  (3, 'Tier 3', 55000,  null, 80, true, 3, 'config default - verify, not a Farmers-published figure')
  on conflict (tier_no) do nothing;

insert into ffs_contacts (slug, role, name, phone, hours, note, sort) values
  ('fsd-central-tx',      'FSD - Central (TX)',    'Matt Anderson',   '(818) 584-0264', null,                 null,        1),
  ('internal-wholesaler', 'Internal Wholesaler',   'Ando Agamalian',  '(818) 584-0205', null,                 null,        2),
  ('compliance-tx',       'Compliance - TX',       'Ryan Anderson',   '(253) 242-0597', null,                 null,        3),
  ('osj-principal-mgr',   'OSJ Principal Manager', 'Lora Brandt',     '(818) 584-0199', null,                 null,        4),
  ('sales-desk',          'Sales Desk',            null,              '(866) 888-9739', 'Mon-Fri 7AM-5PM PT', 'Opt 3 to 3', 5)
  on conflict (slug) do nothing;
