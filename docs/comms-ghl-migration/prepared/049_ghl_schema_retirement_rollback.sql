-- ═══════════════════════════════════════════════════════════════════
-- FSOS — ROLLBACK for GoHighLevel schema retirement (ADR-014 stage D4)
-- PREPARED / STAGED ARTIFACT — pairs with 049_ghl_schema_retirement.sql.
-- DO NOT PLACE IN supabase/migrations/. Promote/renumber alongside its
-- forward file (see RENUMBER AT EXECUTION in the forward migration).
--
-- Status:  DRAFT — not applied. Must be applied-then-reverted on a scratch
--          database as part of the D4 tested-rollback prerequisite
--          (forward-migration EXECUTION PREREQUISITE 5).
--
-- SCOPE / LIMITS:
--   • Recreates the 12 dropped indexes verbatim from their 002/003/004/023
--     definitions (partial / unique predicates preserved exactly).
--   • Recreates the two upload tables' STRUCTURE (columns, PK, FK, RLS) from
--     their 004 definitions.
--   • DATA IS NOT RESTORED BY THIS FILE. `ghl_upload_batches` /
--     `ghl_upload_rows` rows come back only by re-importing the export taken
--     under forward-migration EXECUTION PREREQUISITE 2, or from the verified
--     backup. Structure-only recreate ≠ data recovery (see DATA RESTORE below).
--   • The retained-provenance COMMENTs are cleared back to NULL (cosmetic;
--     harmless if this block is skipped).
--
-- ESTIMATED DURATION: seconds on an empty/near-empty schema — index builds are
--   the only real cost and both upload tables are low-cardinality. Re-measure on
--   the scratch-DB rollback test and record the actual figure here before D4.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1) Recreate the upload tables exactly as 004 defined them.
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

-- RLS: enabled, no permissive policy (service-role only) — as in 004.
alter table ghl_upload_batches enable row level security;
alter table ghl_upload_rows    enable row level security;

-- 2) Recreate the dropped indexes (exact definitions from 002/003/004/023).
create index        if not exists idx_ghl_batches_created on ghl_upload_batches(created_at desc);
create index        if not exists idx_ghl_batches_status  on ghl_upload_batches(status);
create index        if not exists idx_ghl_rows_batch      on ghl_upload_rows(batch_id);
create index        if not exists idx_ghl_rows_status     on ghl_upload_rows(status);
create index        if not exists idx_ghl_rows_failed     on ghl_upload_rows(batch_id) where status = 'failed';
create unique index if not exists idx_customers_ghl_contact           on customers(ghl_contact_id)           where ghl_contact_id is not null;
create index        if not exists idx_customers_ghl_opportunity       on customers(ghl_opportunity_id);
create index        if not exists idx_cases_ghl_opportunity           on commission_cases(ghl_opportunity_id);
create index        if not exists idx_activity_ghl                    on activity(ghl_activity_id);
create unique index if not exists idx_agencies_ghl_contact            on agencies(ghl_contact_id)            where ghl_contact_id is not null;
create index        if not exists idx_households_ghl_contact          on households(ghl_contact_id)          where ghl_contact_id is not null;
create index        if not exists idx_agency_partnerships_ghl_contact on agency_partnerships(ghl_contact_id) where ghl_contact_id is not null;

-- 3) Clear the provenance comments.
comment on column customers.ghl_contact_id            is null;
comment on column customers.ghl_opportunity_id        is null;
comment on column customers.ghl_stage_id              is null;
comment on column customers.ghl_pipeline_id           is null;
comment on column agencies.ghl_contact_id             is null;
comment on column agencies.ghl_opportunity_id         is null;
comment on column agencies.ghl_stage_id               is null;
comment on column agencies.ghl_pipeline_id            is null;
comment on column commission_cases.ghl_opportunity_id is null;
comment on column activity.ghl_activity_id            is null;
comment on column households.ghl_contact_id           is null;
comment on column households.ghl_opportunity_id       is null;
comment on column households.ghl_synced_at            is null;
comment on column agency_partnerships.ghl_contact_id     is null;
comment on column agency_partnerships.ghl_opportunity_id is null;
comment on column agency_partnerships.ghl_synced_at      is null;
comment on column contacts.ghl_contact_id             is null;
comment on column workshop_registrations.ghl_contact_id     is null;
comment on column workshop_registrations.ghl_opportunity_id is null;

commit;

-- ── DATA RESTORE (manual, after this structural rollback) ──────────
--   This file recreates STRUCTURE only. Re-import the row data from the export
--   taken under forward-migration EXECUTION PREREQUISITE 2, e.g.:
--     psql -f ghl_uploads_archive.sql                     -- from pg_dump --data-only
--   -- or, for CSV exports:
--     \copy ghl_upload_batches from 'ghl_upload_batches_export.csv' csv header
--     \copy ghl_upload_rows     from 'ghl_upload_rows_export.csv'     csv header
--   Then verify row-count + checksum against the pre-drop capture
--   (forward-migration EXECUTION PREREQUISITE 4); any delta halts and is
--   investigated before the rollback is considered complete.
--
-- ── ROLLBACK VERIFICATION (run after COMMIT) ───────────────────────
--   • 12 indexes back (expect 12 rows):
--       select indexname from pg_indexes
--       where indexname in (
--         'idx_customers_ghl_contact','idx_customers_ghl_opportunity',
--         'idx_cases_ghl_opportunity','idx_activity_ghl','idx_agencies_ghl_contact',
--         'idx_households_ghl_contact','idx_agency_partnerships_ghl_contact',
--         'idx_ghl_batches_created','idx_ghl_batches_status','idx_ghl_rows_batch',
--         'idx_ghl_rows_status','idx_ghl_rows_failed');
--   • 2 tables back (expect 2 rows):
--       select table_name from information_schema.tables
--       where table_name in ('ghl_upload_batches','ghl_upload_rows');
--   • provenance comments cleared (expect 0 rows):
--       select (table_name || '.' || column_name)
--       from information_schema.columns
--       where column_name like 'ghl\_%' escape '\'
--         and table_name in ('customers','agencies','commission_cases','activity',
--                            'households','agency_partnerships','contacts',
--                            'workshop_registrations')
--         and col_description(('"'||table_name||'"')::regclass, ordinal_position) is not null;
