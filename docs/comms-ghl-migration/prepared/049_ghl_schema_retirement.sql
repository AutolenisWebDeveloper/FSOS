-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel schema retirement (ADR-014 stage D4)
-- PREPARED / STAGED ARTIFACT — DO NOT PLACE IN supabase/migrations/ YET.
--
-- Status:   DRAFT — not applied. Deferred by design (ADR-014 D4).
-- Purpose:  Remove GHL-specific INDEXES and the two dedicated GHL UPLOAD
--           TABLES, and permanently MARK the retained ghl_*_id provenance
--           columns as legacy. It does NOT drop provenance columns and does
--           NOT touch the legacy tables `customers` / `commission_cases` /
--           `activity` / `consent_ledger` (governed by docs/legacy-mapping.md,
--           explicitly out of scope for D4).
--
-- Why this file lives in docs/, not supabase/migrations/:
--   CI (`npm run test:rls`, `scripts/migrate.mjs`) REPLAYS the whole
--   supabase/migrations/ chain from scratch on a fresh database. Placing this
--   file there now would execute D4 the moment CI (or a hand-run) applies the
--   chain — three slices early, before D0's export/reconciliation is signed
--   off. It stays staged here until D4 is authorized; at that point it is
--   promoted into supabase/migrations/ under a re-derived, collision-checked
--   number (see RENUMBER below).
--
-- ───────────────────────────────────────────────────────────────────
-- PRECONDITION 0 — LIVE-SCHEMA DRIFT CHECK MUST PASS BEFORE RUNNING.
--   Confirm, against the LIVE production database, that ALL of the following
--   are present exactly as named:
--     • the 19 ghl_*_id / ghl_synced_at columns on customers, agencies,
--       commission_cases, activity, households, agency_partnerships, contacts,
--       workshop_registrations (the KEEP set commented below);
--     • the 12 GHL indexes dropped below;
--     • both tables ghl_upload_batches and ghl_upload_rows.
--   RATIONALE: `comment on column` has NO `if exists` form. A single missing
--   column aborts the whole transaction and rolls back every preceding DROP.
--   Migrations in this project are applied BY HAND via the Supabase SQL Editor,
--   where a skipped migration is exactly as plausible as the duplicate runs the
--   footprint audit already found — so "the chain says it's there" is not proof.
--   Verify each object against live catalogs (information_schema.columns,
--   pg_indexes, information_schema.tables) FIRST. Do not run this file until the
--   drift check returns zero missing objects.
--
-- RENUMBER AT EXECUTION:
--   `049` was the next free number at drafting time. D1's native-replacement
--   work will very likely consume 049 (and beyond) before D4 runs. At promotion,
--   re-derive the next free migration number, rename BOTH this file and its
--   rollback to match, and verify no collision against supabase/migrations/.
--
-- EXECUTION PREREQUISITES (ADR-014 D4 hard rules — all required before running):
--   1. Reconciliation report signed off (zero unresolved opt-outs).
--   2. ghl_upload_batches / ghl_upload_rows EXPORTED to durable storage
--      (CSV or SQL dump) — the DROP below is irreversible for DATA; the paired
--      rollback recreates STRUCTURE only, not rows.
--   3. Full verified database backup taken.
--   4. Row-count + checksum captured for both upload tables (compare post-run).
--   5. The paired rollback (049_ghl_schema_retirement_rollback.sql) applied and
--      reverted on a scratch/branch database — tested, timed, documented.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. DROP the 12 GHL indexes ─────────────────────────────────────
-- (`if exists` is safe here; PRECONDITION 0 still verifies presence so a
--  silent no-op cannot hide real drift.)

-- from 002_ghl_integration
drop index if exists idx_customers_ghl_contact;
drop index if exists idx_customers_ghl_opportunity;
drop index if exists idx_cases_ghl_opportunity;
drop index if exists idx_activity_ghl;

-- from 003_ghl_agency
drop index if exists idx_agencies_ghl_contact;

-- from 004_ghl_contact_uploads (indexes on the tables dropped in step 3;
-- listed explicitly so the intent is auditable even though DROP TABLE cascades)
drop index if exists idx_ghl_batches_created;
drop index if exists idx_ghl_batches_status;
drop index if exists idx_ghl_rows_batch;
drop index if exists idx_ghl_rows_status;
drop index if exists idx_ghl_rows_failed;

-- from 023_ghl_sync_native (spine partial-unique indexes)
drop index if exists idx_households_ghl_contact;
drop index if exists idx_agency_partnerships_ghl_contact;

-- ── 2. MARK the 19 retained provenance columns as legacy ───────────
-- KEPT per ADR-014 D4 so post-decommission reconciliation stays possible.
-- No `if exists` exists for COMMENT — PRECONDITION 0 guards this block.

-- customers (002)
comment on column customers.ghl_contact_id      is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column customers.ghl_opportunity_id  is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column customers.ghl_stage_id        is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column customers.ghl_pipeline_id     is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- commission_cases (002)
comment on column commission_cases.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- activity (002)
comment on column activity.ghl_activity_id      is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- agencies (003)
comment on column agencies.ghl_contact_id       is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column agencies.ghl_opportunity_id   is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column agencies.ghl_stage_id         is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column agencies.ghl_pipeline_id      is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- households (023)
comment on column households.ghl_contact_id     is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column households.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column households.ghl_synced_at      is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- agency_partnerships (023)
comment on column agency_partnerships.ghl_contact_id     is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column agency_partnerships.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column agency_partnerships.ghl_synced_at      is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- contacts (026)
comment on column contacts.ghl_contact_id       is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- workshop_registrations (038/039)
comment on column workshop_registrations.ghl_contact_id     is 'Legacy GHL provenance — not written to, retained per ADR-014.';
comment on column workshop_registrations.ghl_opportunity_id is 'Legacy GHL provenance — not written to, retained per ADR-014.';

-- ── 3. DROP the two dedicated GHL upload tables ────────────────────
-- EXECUTION PREREQUISITE 2 (export) MUST be complete first — this is
-- irreversible for the DATA. `ghl_upload_rows` FKs `ghl_upload_batches`
-- (on delete cascade); drop the child first regardless.
drop table if exists ghl_upload_rows;
drop table if exists ghl_upload_batches;

commit;

-- ── POST-RUN VERIFICATION (run after COMMIT) ───────────────────────
--   • 12 indexes gone:
--       select indexname from pg_indexes
--       where indexname in (
--         'idx_customers_ghl_contact','idx_customers_ghl_opportunity',
--         'idx_cases_ghl_opportunity','idx_activity_ghl','idx_agencies_ghl_contact',
--         'idx_ghl_batches_created','idx_ghl_batches_status','idx_ghl_rows_batch',
--         'idx_ghl_rows_status','idx_ghl_rows_failed','idx_households_ghl_contact',
--         'idx_agency_partnerships_ghl_contact');   -- expect 0 rows
--   • 2 tables gone:
--       select table_name from information_schema.tables
--       where table_name in ('ghl_upload_batches','ghl_upload_rows'); -- expect 0 rows
--   • 19 columns still present and now commented:
--       select (table_name || '.' || column_name) as col,
--              col_description(('"'||table_name||'"')::regclass, ordinal_position) as note
--       from information_schema.columns
--       where column_name like 'ghl\_%' escape '\'
--         and table_name in ('customers','agencies','commission_cases','activity',
--                            'households','agency_partnerships','contacts',
--                            'workshop_registrations')
--       order by 1;   -- expect 19 rows, each note = the retained-provenance string
