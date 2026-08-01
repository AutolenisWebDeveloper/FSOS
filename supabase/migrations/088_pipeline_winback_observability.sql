-- 088_pipeline_winback_observability.sql
-- Observability parity for the Pipeline Win-Back Campaign execution ledger (C1/D9), bringing
-- pipeline_winback_executions to the same retry/dead-letter shape as the reference Cross-Sell Life
-- engine (085) and the Life Conversion engine (087). Forward-only and idempotent — safe to re-run.
--
-- Mirrors 087 exactly, on pipeline_winback_executions:
--   • idempotency_key  — global dedupe key (unique partial index); the runner may stamp it so the
--                        retry sweep can find a stuck send. NULL until then; the sweep stays inert.
--   • attempts         — retry accounting (default 0).
--   • next_retry_at    — when a still-'scheduled' execution becomes eligible for the retry sweep.
--   • status 'dead_letter' — terminal "needs operator attention" after the retry ceiling.
--   • partial indexes  — dead-letter list, retry queue, idempotency guard.
--
-- Sequencing: inert until applied; apply BEFORE deploying runner code that writes these columns.
-- The retry sweep (pipeline-winback/jobs.ts) and health route degrade gracefully (no-op / null
-- counts) if they run before this migration lands, so ordering is safe.

alter table pipeline_winback_executions
  add column if not exists idempotency_key text,
  add column if not exists attempts        integer not null default 0,
  add column if not exists next_retry_at    timestamptz;

-- Extend the status vocabulary with 'dead_letter' (drop the auto-named CHECK and re-add it).
alter table pipeline_winback_executions drop constraint if exists pipeline_winback_executions_status_check;
alter table pipeline_winback_executions add constraint pipeline_winback_executions_status_check
  check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed','dead_letter'));

create unique index if not exists idx_pwx_idem on pipeline_winback_executions (idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_pwx_deadletter on pipeline_winback_executions (status)
  where status = 'dead_letter';
create index if not exists idx_pwx_retry on pipeline_winback_executions (next_retry_at)
  where status = 'scheduled' and next_retry_at is not null;

-- Rollback (manual; forward-only by policy):
--   drop index if exists idx_pwx_retry, idx_pwx_deadletter, idx_pwx_idem;
--   alter table pipeline_winback_executions drop constraint if exists pipeline_winback_executions_status_check;
--   alter table pipeline_winback_executions add constraint pipeline_winback_executions_status_check
--     check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed'));
--   alter table pipeline_winback_executions drop column if exists next_retry_at, drop column if exists attempts,
--     drop column if exists idempotency_key;
