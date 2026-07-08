-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel CSV contact-upload history
-- Migration: 004_ghl_contact_uploads
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- Persists an audit trail for every CSV contact import pushed into GHL:
--   • ghl_upload_batches — one row per uploaded file (counts + status),
--   • ghl_upload_rows     — one row per contact line (result + GHL ids + error).
--
-- The upload API (/api/ghl/contacts/upload) writes here so the Command Center
-- "Contact Upload" screen can show success / duplicate / invalid / failed
-- counts and let the operator retry only the failed rows. Safe to run more
-- than once (idempotent guards throughout).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists ghl_upload_batches (
  batch_id          uuid primary key default gen_random_uuid(),
  filename          text,
  source            text,                         -- lead source stamped on the batch
  tags              text[] default '{}',          -- tags applied to every contact
  pipeline_key      text,                         -- prospect_client|agency_owner|term_conversions|null
  stage_position    integer,                      -- 1-based stage, null = no opportunity
  location_id       text,                         -- GHL location the batch synced to
  total_rows        integer default 0,
  success_count     integer default 0,
  duplicate_count   integer default 0,
  invalid_count     integer default 0,
  failed_count      integer default 0,
  status            text default 'processing',    -- processing|complete|error
  error_message     text,
  created_by        text,                          -- admin user that ran the import
  created_at        timestamptz default now(),
  completed_at      timestamptz
);

create index if not exists idx_ghl_batches_created on ghl_upload_batches(created_at desc);
create index if not exists idx_ghl_batches_status  on ghl_upload_batches(status);

create table if not exists ghl_upload_rows (
  row_id              uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references ghl_upload_batches(batch_id) on delete cascade,
  row_number          integer not null,           -- 1-based line in the source file
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  status              text not null,              -- success|duplicate|invalid|failed
  ghl_contact_id      text,
  ghl_opportunity_id  text,
  is_new              boolean,                     -- GHL created a new contact vs updated existing
  attempts            integer default 0,
  error_message       text,
  created_at          timestamptz default now()
);

create index if not exists idx_ghl_rows_batch  on ghl_upload_rows(batch_id);
create index if not exists idx_ghl_rows_status on ghl_upload_rows(status);
create index if not exists idx_ghl_rows_failed on ghl_upload_rows(batch_id) where status = 'failed';

-- These tables are written only by the service-role API routes; enable RLS with
-- no permissive policy so the anon/browser key can never read the import log.
alter table ghl_upload_batches enable row level security;
alter table ghl_upload_rows    enable row level security;
