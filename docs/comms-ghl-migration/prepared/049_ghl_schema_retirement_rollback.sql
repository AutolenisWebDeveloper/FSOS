-- ═══════════════════════════════════════════════════════════════════
-- Rollback for 049_ghl_schema_retirement.   PREPARED ARTIFACT — NOT live.
-- Restores STRUCTURE (tables, indexes, comments-cleared). The dropped
-- table DATA is restored separately from the precondition-2 export /
-- verified backup (e.g. psql -f ghl_uploads_archive.sql). Test this on a
-- scratch DB before D4 is applied to production (ADR-014 D4 precondition 4).
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
