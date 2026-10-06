-- 142_residual_schema_gaps.sql
-- Close the three residual gaps recorded in the production ledger during the 2026-08-29
-- reconciliation (production's schema_migrations.note on the 001 and 070 rows, read-only
-- 2026-10-06; ADR-039 "Genuinely missing" lists the two indexes). Each object is defined in an
-- earlier migration, was never dropped by a later one, and is absent in production. Those files
-- must NOT be re-run (001 is the whole initial schema), so the objects are re-declared here,
-- verbatim, idempotently.
--
--   idx_form_submissions_pending  — 001_initial_schema.sql:264
--   idx_opra_uncontacted          — 001_initial_schema.sql:423 (opra_cases, the legacy OPRA table)
--   v_contact_by_source           — 070_contact_consolidation_report.sql:37. Read by
--                                   loadContactConsolidationReport (src/lib/services/
--                                   contactConsolidation.ts:109), which nothing calls today; if it
--                                   is wired up again, a missing view would make the per-source
--                                   breakdown read as empty (the loader degrades to zero on error).
--
-- Plain CREATE INDEX, not CONCURRENTLY. The ledger note suggested CONCURRENTLY, but it cannot run
-- inside a transaction, and the owner's procedure applies each file and its ledger row in ONE
-- transaction (docs/ops/migration-runbook.md, `psql -1`). The tables are tiny (form_submissions 9
-- rows, opra_cases 0 rows, read-only 2026-10-06), so the SHARE lock lasts milliseconds.
--
-- The view keeps 070's `security_invoker = true`: a reader sees only the contacts its own RLS
-- allows. It must never be created without it (that is the security-definer-view advisor finding).
--
-- ROLLBACK:
--   drop view if exists v_contact_by_source;
--   drop index if exists idx_opra_uncontacted;
--   drop index if exists idx_form_submissions_pending;

create index if not exists idx_form_submissions_pending on form_submissions(status, expires_at);

create index if not exists idx_opra_uncontacted on opra_cases(created_at) where contacted = false;

create or replace view v_contact_by_source
with (security_invoker = true) as
select
  coalesce(nullif(btrim(source), ''), '(unspecified)')  as source,
  count(*)                                               as total,
  count(*) filter (where household_id is null)           as orphaned
from contacts
where deleted_at is null
group by 1;
