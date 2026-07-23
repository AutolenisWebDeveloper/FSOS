-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel schema retirement            (ADR-014 stage D4)
-- PREPARED ARTIFACT — NOT a live migration. Staged under docs/ on purpose.
-- Renumber to the next free number and move into supabase/migrations/ ONLY
-- at execution time (see docs/comms-ghl-migration/prepared/README.md).
--
-- Additive, forward-only. NEVER edit 002/003/004/023 — production applied
-- them by name; an edited file never re-runs and creates prod/CI drift.
-- This single migration retires the entire GHL schema surface those files added.
--
-- DO NOT APPLY until ALL preconditions are met (ADR-014 §D4 / §2.A):
--   0. LIVE-SCHEMA DRIFT CHECK PASSED (see block below) — prod GHL schema still
--      matches 002/003/004/023. If it doesn't, STOP and reconcile first.
--   1. D0 reconciliation signed off — every GHL opt-out migrated into
--      consents/dnc_entries (NOT consent_ledger), zero unresolved.
--   2. ghl_upload_batches / ghl_upload_rows exported to cold storage, e.g.:
--        pg_dump --data-only -t ghl_upload_batches -t ghl_upload_rows > ghl_uploads_archive.sql
--   3. Full database backup verified.
--   4. 049_ghl_schema_retirement_rollback.sql tested on a scratch DB.
--
-- OUT OF SCOPE (never touched here): the tables customers, commission_cases,
-- activity, consent_ledger — FSOS legacy tables governed by
-- docs/legacy-mapping.md (C1–C6), not GHL objects.
-- ═══════════════════════════════════════════════════════════════════

-- ── PRECONDITION 0 — live-schema drift check (RUN FIRST, do not wrap in the txn) ──
-- Every row must report present=true. Any false = drift; STOP and reconcile the
-- migration history against production before proceeding.
--
--   select 'idx_customers_ghl_contact'            as obj, to_regclass('public.idx_customers_ghl_contact')            is not null as present
--   union all select 'idx_customers_ghl_opportunity',      to_regclass('public.idx_customers_ghl_opportunity')       is not null
--   union all select 'idx_cases_ghl_opportunity',          to_regclass('public.idx_cases_ghl_opportunity')           is not null
--   union all select 'idx_activity_ghl',                   to_regclass('public.idx_activity_ghl')                    is not null
--   union all select 'idx_agencies_ghl_contact',           to_regclass('public.idx_agencies_ghl_contact')            is not null
--   union all select 'idx_households_ghl_contact',         to_regclass('public.idx_households_ghl_contact')          is not null
--   union all select 'idx_agency_partnerships_ghl_contact',to_regclass('public.idx_agency_partnerships_ghl_contact') is not null
--   union all select 'ghl_upload_batches',                 to_regclass('public.ghl_upload_batches')                  is not null
--   union all select 'ghl_upload_rows',                    to_regclass('public.ghl_upload_rows')                     is not null;
--
--   -- and every provenance column still present:
--   select table_name, column_name
--   from information_schema.columns
--   where column_name like 'ghl\_%' escape '\'
--     and table_name in ('customers','agencies','commission_cases','activity',
--                        'households','agency_partnerships','contacts','workshop_registrations')
--   order by table_name, column_name;
-- ──────────────────────────────────────────────────────────────────────────────

begin;

-- 1) Drop GHL indexes (from 002/003/004/023). The columns themselves are KEPT
--    as legacy provenance (step 3); only their indexes go.
drop index if exists idx_customers_ghl_contact;            -- 002 (unique, partial)
drop index if exists idx_customers_ghl_opportunity;        -- 002
drop index if exists idx_cases_ghl_opportunity;            -- 002 (commission_cases)
drop index if exists idx_activity_ghl;                     -- 002
drop index if exists idx_agencies_ghl_contact;             -- 003 (unique, partial)
drop index if exists idx_households_ghl_contact;           -- 023 (partial)
drop index if exists idx_agency_partnerships_ghl_contact;  -- 023 (partial)
drop index if exists idx_ghl_batches_created;              -- 004
drop index if exists idx_ghl_batches_status;               -- 004
drop index if exists idx_ghl_rows_batch;                   -- 004
drop index if exists idx_ghl_rows_status;                  -- 004
drop index if exists idx_ghl_rows_failed;                  -- 004 (partial)

-- 2) Drop the dedicated GHL upload tables (EXPORT FIRST — precondition 2).
--    ghl_upload_rows.batch_id → ghl_upload_batches (on delete cascade); child first.
drop table if exists ghl_upload_rows;
drop table if exists ghl_upload_batches;

-- 3) KEEP the ghl_*_id provenance columns (ADR-014 D4); mark each legacy so no
--    code writes them and reconciliation stays possible. Spans 002/003/023/026/038/039.
comment on column customers.ghl_contact_id            is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column customers.ghl_opportunity_id        is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column customers.ghl_stage_id              is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column customers.ghl_pipeline_id           is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agencies.ghl_contact_id             is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agencies.ghl_opportunity_id         is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agencies.ghl_stage_id               is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agencies.ghl_pipeline_id            is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column commission_cases.ghl_opportunity_id is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column activity.ghl_activity_id            is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column households.ghl_contact_id           is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column households.ghl_opportunity_id       is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column households.ghl_synced_at            is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agency_partnerships.ghl_contact_id     is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agency_partnerships.ghl_opportunity_id is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column agency_partnerships.ghl_synced_at      is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column contacts.ghl_contact_id             is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column workshop_registrations.ghl_contact_id     is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';
comment on column workshop_registrations.ghl_opportunity_id is 'Legacy GHL provenance — retired per ADR-014 D3; not written to. Kept for reconciliation.';

commit;
