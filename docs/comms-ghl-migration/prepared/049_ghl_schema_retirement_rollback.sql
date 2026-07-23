-- ═══════════════════════════════════════════════════════════════════
-- FSOS — ROLLBACK for GoHighLevel schema retirement (ADR-014 stage D4)
-- PREPARED / STAGED ARTIFACT — pairs with 049_ghl_schema_retirement.sql.
-- DO NOT PLACE IN supabase/migrations/. Promote/renumber alongside its
-- forward file (see RENUMBER AT EXECUTION in the forward migration).
--
-- Status:  DRAFT — not applied. Must be applied-then-reverted on a scratch
--          database as part of the D4 tested-rollback prerequisite.
--
-- SCOPE / LIMITS:
--   • Recreates the 12 dropped indexes verbatim from their 002/003/004/023
--     definitions (partial / unique predicates preserved exactly).
--   • Recreates the two upload tables' STRUCTURE (columns, PK, FK, RLS) from
--     their 004 definitions.
--   • DATA IS NOT RESTORED BY THIS FILE. `ghl_upload_batches` /
--     `ghl_upload_rows` rows come back only by re-importing the export taken
--     under forward-migration EXECUTION PREREQUISITE 2, or from the verified
--     backup. Structure-only recreate ≠ data recovery.
--   • The retained-provenance COMMENTs are cleared back to NULL (cosmetic;
--     harmless if this block is skipped).
--
-- ESTIMATED DURATION: seconds on an empty/near-empty schema (index builds are
--   the only real cost and both upload tables are low-cardinality). Re-measure
--   on the scratch-DB rollback test and record the actual figure here before D4.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. Recreate the two upload tables (from 004_ghl_contact_uploads) ──
create table if not exists ghl_upload_batches (
  batch_id          uuid primary key default gen_random_uuid(),
  filename          text,
  source            text,
  tags              text[] default '{}',
  pipeline_key      text,
  stage_position    integer,
  location_id       text,
  total_rows        integer default 0,
  success_count     integer default 0,
  duplicate_count   integer default 0,
  invalid_count     integer default 0,
  failed_count      integer default 0,
  status            text default 'processing',
  error_message     text,
  created_by        text,
  created_at        timestamptz default now(),
  completed_at      timestamptz
);

create index if not exists idx_ghl_batches_created on ghl_upload_batches(created_at desc);
create index if not exists idx_ghl_batches_status  on ghl_upload_batches(status);

create table if not exists ghl_upload_rows (
  row_id              uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references ghl_upload_batches(batch_id) on delete cascade,
  row_number          integer not null,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  status              text not null,
  ghl_contact_id      text,
  ghl_opportunity_id  text,
  is_new              boolean,
  attempts            integer default 0,
  error_message       text,
  created_at          timestamptz default now()
);

create index if not exists idx_ghl_rows_batch  on ghl_upload_rows(batch_id);
create index if not exists idx_ghl_rows_status on ghl_upload_rows(status);
create index if not exists idx_ghl_rows_failed on ghl_upload_rows(batch_id) where status = 'failed';

-- RLS as in 004: enabled, no permissive policy (service-role only).
alter table ghl_upload_batches enable row level security;
alter table ghl_upload_rows    enable row level security;

-- ── 2. Recreate the spine + legacy provenance indexes ──────────────

-- from 002_ghl_integration
create unique index if not exists idx_customers_ghl_contact
  on customers(ghl_contact_id) where ghl_contact_id is not null;
create index if not exists idx_customers_ghl_opportunity on customers(ghl_opportunity_id);
create index if not exists idx_cases_ghl_opportunity      on commission_cases(ghl_opportunity_id);
create index if not exists idx_activity_ghl               on activity(ghl_activity_id);

-- from 003_ghl_agency
create unique index if not exists idx_agencies_ghl_contact
  on agencies(ghl_contact_id) where ghl_contact_id is not null;

-- from 023_ghl_sync_native
create unique index if not exists idx_households_ghl_contact
  on households(ghl_contact_id) where ghl_contact_id is not null;
create unique index if not exists idx_agency_partnerships_ghl_contact
  on agency_partnerships(ghl_contact_id) where ghl_contact_id is not null;

-- ── 3. Clear the retained-provenance column comments (cosmetic) ─────
comment on column customers.ghl_contact_id      is null;
comment on column customers.ghl_opportunity_id  is null;
comment on column customers.ghl_stage_id        is null;
comment on column customers.ghl_pipeline_id     is null;
comment on column commission_cases.ghl_opportunity_id is null;
comment on column activity.ghl_activity_id      is null;
comment on column agencies.ghl_contact_id       is null;
comment on column agencies.ghl_opportunity_id   is null;
comment on column agencies.ghl_stage_id         is null;
comment on column agencies.ghl_pipeline_id      is null;
comment on column households.ghl_contact_id     is null;
comment on column households.ghl_opportunity_id is null;
comment on column households.ghl_synced_at      is null;
comment on column agency_partnerships.ghl_contact_id     is null;
comment on column agency_partnerships.ghl_opportunity_id is null;
comment on column agency_partnerships.ghl_synced_at      is null;
comment on column contacts.ghl_contact_id       is null;
comment on column workshop_registrations.ghl_contact_id     is null;
comment on column workshop_registrations.ghl_opportunity_id is null;

commit;

-- ── DATA RESTORE (manual, after this structural rollback) ──────────
--   Re-import the export from forward-migration EXECUTION PREREQUISITE 2:
--     \copy ghl_upload_batches from 'ghl_upload_batches_export.csv' csv header
--     \copy ghl_upload_rows     from 'ghl_upload_rows_export.csv'     csv header
--   Then verify row-count + checksum against the pre-drop capture.
