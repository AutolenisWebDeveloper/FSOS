-- 064_fna_performance_indexes.sql
-- Forward-only, additive (indexes only — no data or schema change, no lock risk on
-- these table sizes). Closes the full-scan / unindexed-sort paths the FNA Command
-- Center audit found. Every index is `if not exists` so re-running is a no-op.

-- ── audit_log ────────────────────────────────────────────────────────────────
-- The plan Audit tab filters audit_log by entity_id ALONE (idx_audit_entity leads
-- with `entity`, so it can't serve an entity_id-only predicate) and sorts by `at`.
-- audit_log is the platform-wide append-only log — the largest, fastest-growing
-- table — so this was two sequential scans per view.
create index if not exists idx_audit_entity_id_at on audit_log(entity_id, at desc);

-- The plan Audit tab also filters on the JSONB expression diff->>'plan_id' (a
-- deterministic-calc/version row records plan_id there, not as entity_id). No index
-- covered the expression → a full scan evaluating JSON extraction on every row.
create index if not exists idx_audit_diff_plan on audit_log((diff->>'plan_id')) where diff ? 'plan_id';

-- The cross-plan FNA audit page does `entity in (...) order by at desc limit 200`;
-- idx_audit_entity serves the filter but not the sort. This covers both.
create index if not exists idx_audit_entity_at on audit_log(entity, at desc);

-- ── fna_plans ────────────────────────────────────────────────────────────────
-- Every FNA list (overview, plans, reports, recommendations, module-results) does
-- `.is('deleted_at', null).order('updated_at', desc)`; migration 060 indexed
-- household_id/status/review_id/plan_type but not updated_at, so each list did a
-- filtered scan + in-memory sort.
create index if not exists idx_fna_plans_updated on fna_plans(updated_at desc) where deleted_at is null;

-- ── household_policies ───────────────────────────────────────────────────────
-- The dashboard planning-intelligence widget and the FNA timeline count policies
-- with a conversion/renewal milestone in a date window. conversion_deadline already
-- has a partial index (mig 001); renewal_date had none.
create index if not exists idx_household_policies_renewal on household_policies(renewal_date) where renewal_date is not null;
