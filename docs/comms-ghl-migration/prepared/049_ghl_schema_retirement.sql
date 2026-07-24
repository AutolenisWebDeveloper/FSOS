-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel schema retirement            (ADR-014 stage D4)
-- PREPARED / STAGED ARTIFACT — NOT a live migration. Staged under docs/ on
-- purpose; see docs/comms-ghl-migration/prepared/README.md.
--
-- Status:   DRAFT — not applied. Deferred by design (ADR-014 D4).
-- Purpose:  Remove the GHL-specific INDEXES and the two dedicated GHL UPLOAD
--           TABLES, and permanently MARK the retained ghl_*_id provenance
--           columns as legacy. It does NOT drop provenance columns, and it does
--           NOT touch the legacy tables `customers` / `commission_cases` /
--           `activity` / `consent_ledger` (FSOS legacy tables governed by
--           docs/legacy-mapping.md C1–C6 — explicitly out of scope for D4).
--
-- Additive, forward-only. NEVER edit 002/003/004/023 — production applied them
-- by name; an edited file never re-runs and creates prod/CI drift (ADR-014 §D4,
-- hard rules). This single migration retires the entire GHL schema surface those
-- files added. At execution it is renumbered and MOVED into supabase/migrations/
-- (see RENUMBER below and README §3).
--
-- Why this file lives in docs/, not supabase/migrations/:
--   CI (`npm run test:rls`, `scripts/migrate.mjs`) REPLAYS the whole
--   supabase/migrations/ chain from scratch on a fresh database. Placing this
--   file there now would execute D4 the moment CI (or a hand-run) applies the
--   chain — before D0's export/reconciliation is signed off. It stays staged
--   here until D4 is authorized.
--
-- RENUMBER AT EXECUTION:
--   `049` was the next free number at drafting time (045–048 taken:
--   045_opportunity_source, 046_opportunity_contact, 047_opportunity_policy,
--   048_appointment_lifecycle). D1's native-replacement work may consume 049+
--   before D4 runs. At promotion, re-derive the next free migration number,
--   rename BOTH this file and its rollback to match, and verify no collision
--   against supabase/migrations/.
--
-- DO NOT APPLY until ALL preconditions are met (ADR-014 §D4 / master build §2.A):
--   0. LIVE-SCHEMA DRIFT CHECK PASSED (block below) — prod GHL schema still
--      matches 002/003/004/023. If it doesn't, STOP and reconcile first.
--   1. D0 reconciliation signed off — every GHL opt-out migrated into
--      consents/dnc_entries (NOT consent_ledger), zero unresolved.
--   2. ghl_upload_batches / ghl_upload_rows EXPORTED to durable cold storage —
--      the DROP below is irreversible for DATA; the paired rollback recreates
--      STRUCTURE only, not rows. e.g.:
--        pg_dump --data-only -t ghl_upload_batches -t ghl_upload_rows > ghl_uploads_archive.sql
--   3. Full verified database backup taken.
--   4. Row-count + checksum captured for both upload tables (compare post-run;
--      any unexplained delta halts the migration — master build §2.A).
--   5. The paired rollback (049_ghl_schema_retirement_rollback.sql) applied and
--      reverted on a scratch/branch database — tested, timed, documented.
-- ═══════════════════════════════════════════════════════════════════

-- ── PRECONDITION 0 — live-schema drift check (RUN FIRST, do not wrap in the txn) ──
-- Every object below must be present exactly as named before anything is dropped.
-- RATIONALE: `comment on column` has NO `if exists` form — a single missing
-- column aborts the transaction and rolls back every preceding DROP. Migrations
-- here are applied BY HAND via the Supabase SQL Editor, where a skipped or
-- duplicated migration is entirely plausible, so "the chain says it's there" is
-- not proof. Verify against live catalogs first; any false = drift; STOP and
-- reconcile the migration history against production before proceeding.
--
--   select 'idx_customers_ghl_contact'            as obj, to_regclass('public.idx_customers_ghl_contact')            is not null as present
--   union all select 'idx_customers_ghl_opportunity',      to_regclass('public.idx_customers_ghl_opportunity')       is not null
--   union all select 'idx_cases_ghl_opportunity',          to_regclass('public.idx_cases_ghl_opportunity')           is not null
--   union all select 'idx_activity_ghl',                   to_regclass('public.idx_activity_ghl')                    is not null
--   union all select 'idx_agencies_ghl_contact',           to_regclass('public.idx_agencies_ghl_contact')            is not null
--   union all select 'idx_households_ghl_contact',         to_regclass('public.idx_households_ghl_contact')          is not null
--   union all select 'idx_agency_partnerships_ghl_contact',to_regclass('public.idx_agency_partnerships_ghl_contact') is not null
--   union all select 'idx_ghl_batches_created',            to_regclass('public.idx_ghl_batches_created')             is not null
--   union all select 'idx_ghl_batches_status',             to_regclass('public.idx_ghl_batches_status')              is not null
--   union all select 'idx_ghl_rows_batch',                 to_regclass('public.idx_ghl_rows_batch')                  is not null
--   union all select 'idx_ghl_rows_status',                to_regclass('public.idx_ghl_rows_status')                 is not null
--   union all select 'idx_ghl_rows_failed',                to_regclass('public.idx_ghl_rows_failed')                 is not null
--   union all select 'ghl_upload_batches',                 to_regclass('public.ghl_upload_batches')                  is not null
--   union all select 'ghl_upload_rows',                    to_regclass('public.ghl_upload_rows')                     is not null;
--
--   -- and every retained provenance column still present (expect 19 rows):
--   select table_name, column_name
--   from information_schema.columns
--   where column_name like 'ghl\_%' escape '\'
--     and table_name in ('customers','agencies','commission_cases','activity',
--                        'households','agency_partnerships','contacts','workshop_registrations')
--   order by table_name, column_name;
-- ──────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. DROP the 12 GHL indexes ─────────────────────────────────────
-- The columns themselves are KEPT as legacy provenance (step 3); only their
-- indexes go. (`if exists` is safe here; PRECONDITION 0 still verifies presence
-- so a silent no-op cannot hide real drift.) The 004 upload-table indexes are
-- dropped explicitly — even though DROP TABLE (step 2) would cascade them — so
-- the intent is auditable.

-- from 002_ghl_integration
drop index if exists idx_customers_ghl_contact;            -- unique, partial
drop index if exists idx_customers_ghl_opportunity;
drop index if exists idx_cases_ghl_opportunity;            -- on commission_cases
drop index if exists idx_activity_ghl;

-- from 003_ghl_agency
drop index if exists idx_agencies_ghl_contact;             -- unique, partial

-- from 023_ghl_sync_native (spine partial-unique indexes)
drop index if exists idx_households_ghl_contact;
drop index if exists idx_agency_partnerships_ghl_contact;

-- from 004_ghl_contact_uploads (on the tables dropped in step 2)
drop index if exists idx_ghl_batches_created;
drop index if exists idx_ghl_batches_status;
drop index if exists idx_ghl_rows_batch;
drop index if exists idx_ghl_rows_status;
drop index if exists idx_ghl_rows_failed;                  -- partial

-- ── 2. DROP the two dedicated GHL upload tables ────────────────────
-- EXECUTION PREREQUISITE 2 (export) MUST be complete first — this is
-- irreversible for the DATA. ghl_upload_rows.batch_id → ghl_upload_batches
-- (on delete cascade); drop the child first regardless.
drop table if exists ghl_upload_rows;
drop table if exists ghl_upload_batches;

-- ── 3. MARK the 19 retained provenance columns as legacy ───────────
-- KEPT per ADR-014 D4 so post-decommission reconciliation stays possible; not
-- written to after D3 code removal. No `if exists` form exists for COMMENT —
-- PRECONDITION 0 guards this block. Spans 002/003/023/026/038/039.
comment on column customers.ghl_contact_id            is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column customers.ghl_opportunity_id        is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column customers.ghl_stage_id              is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column customers.ghl_pipeline_id           is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agencies.ghl_contact_id             is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agencies.ghl_opportunity_id         is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agencies.ghl_stage_id               is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agencies.ghl_pipeline_id            is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column commission_cases.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column activity.ghl_activity_id            is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column households.ghl_contact_id           is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column households.ghl_opportunity_id       is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column households.ghl_synced_at            is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agency_partnerships.ghl_contact_id     is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agency_partnerships.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column agency_partnerships.ghl_synced_at      is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column contacts.ghl_contact_id             is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column workshop_registrations.ghl_contact_id     is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';
comment on column workshop_registrations.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014. Kept for reconciliation.';

commit;

-- ── POST-RUN VERIFICATION (run after COMMIT) ───────────────────────
--   • 12 indexes gone (expect 0 rows):
--       select indexname from pg_indexes
--       where indexname in (
--         'idx_customers_ghl_contact','idx_customers_ghl_opportunity',
--         'idx_cases_ghl_opportunity','idx_activity_ghl','idx_agencies_ghl_contact',
--         'idx_households_ghl_contact','idx_agency_partnerships_ghl_contact',
--         'idx_ghl_batches_created','idx_ghl_batches_status','idx_ghl_rows_batch',
--         'idx_ghl_rows_status','idx_ghl_rows_failed');
--   • 2 tables gone (expect 0 rows):
--       select table_name from information_schema.tables
--       where table_name in ('ghl_upload_batches','ghl_upload_rows');
--   • 19 columns still present and now commented (expect 19 rows, each note =
--     the retained-provenance string):
--       select (table_name || '.' || column_name) as col,
--              col_description(('"'||table_name||'"')::regclass, ordinal_position) as note
--       from information_schema.columns
--       where column_name like 'ghl\_%' escape '\'
--         and table_name in ('customers','agencies','commission_cases','activity',
--                            'households','agency_partnerships','contacts',
--                            'workshop_registrations')
--       order by 1;
