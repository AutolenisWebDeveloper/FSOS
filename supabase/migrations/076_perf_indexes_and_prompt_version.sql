-- fsos:no-transaction
-- ─────────────────────────────────────────────────────────
-- Migration: 076_perf_indexes_and_prompt_version
--
-- APPROVED additive hardening (god-mode audit, Phase 2). Two independent, purely
-- additive changes — no data rewrite, no behavior change, forward-only:
--
--   (A) Covering indexes on hot aggregate-root FK columns that today have NONE.
--       Postgres does not auto-index foreign keys, so both the everyday equality
--       lookups AND the ON DELETE CASCADE child-row scans on these columns are
--       sequential scans that also take stronger locks during a cascade. Each index
--       below is justified by a REAL access path in the codebase (not speculative)
--       and was confirmed NOT to duplicate any existing index (009 defines indexes
--       on households.referring_agency_id, opportunities.household_id, cases.status,
--       commissions.reconciliation_status, … but none on the columns below):
--
--         • household_members(household_id)
--             - real query: src/app/api/app/conversions/import/route.ts:439
--               `.in('household_id', …)`; household-360/detail loads; import matchers
--             - FK: household_members.household_id → households(id) ON DELETE CASCADE
--         • cases(opportunity_id)
--             - real query: src/app/api/cases/route.ts:65
--               `from('cases').select('id').eq('opportunity_id', opp.id)` (the hot
--               case-creation dedupe lookup)
--         • case_requirements(case_id)
--             - real query: src/app/api/cases/[id]/requirements/route.ts:56,61
--               `.eq('case_id', params.id)` (requirement list + outstanding check)
--             - FK: case_requirements.case_id → cases(id) ON DELETE CASCADE
--         • coverages(policy_id)
--             - FK: coverages.policy_id → household_policies(id) ON DELETE CASCADE
--               (a policy delete must scan coverages; unindexed = seq-scan + lock)
--
--       Uses CREATE INDEX CONCURRENTLY so building the index never locks the table
--       against writes in production. CONCURRENTLY cannot run inside a transaction —
--       hence the `-- fsos:no-transaction` directive on line 1 (honored by
--       scripts/migrate.mjs). IF NOT EXISTS keeps re-runs safe.
--
--       NOTE: index selection was validated against query paths + the schema; run
--       EXPLAIN (ANALYZE) against a populated instance to confirm plan wins before a
--       high-traffic prod rollout (no live DB was available in the authoring session).
--
--   (B) agent_runs.prompt_version — ADR-008/§11.1 require the prompt version used to
--       be recorded on every run for reproducibility/audit. The column was missing.
--       Added nullable (no table rewrite / no default backfill); the runner now
--       records lib/ai/roster.ts PROMPT_VERSION on each new run.
-- ─────────────────────────────────────────────────────────

-- (A) Hot-FK covering indexes (concurrent, non-locking).
create index concurrently if not exists idx_household_members_household on household_members(household_id);
create index concurrently if not exists idx_cases_opportunity on cases(opportunity_id);
create index concurrently if not exists idx_case_requirements_case on case_requirements(case_id);
create index concurrently if not exists idx_coverages_policy on coverages(policy_id);

-- (B) Prompt-version provenance on agent runs (nullable — no rewrite).
alter table agent_runs add column if not exists prompt_version text;
comment on column agent_runs.prompt_version is 'Version of the prompt/roster used for this run (ADR-008 reproducibility). Recorded by src/jobs/agent-runner.ts from lib/ai/roster.ts PROMPT_VERSION.';
