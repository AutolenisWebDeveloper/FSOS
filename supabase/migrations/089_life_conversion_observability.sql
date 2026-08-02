-- 089_life_conversion_observability.sql
-- (Renumbered from 087 to resolve a migration version collision: 087_comms_console.sql, from a
--  separate PR, also claimed version 087 in main. This migration is idempotent and its ledger
--  insert had always failed on the duplicate version, so it was never recorded anywhere — applying
--  it fresh as 089 is safe in every environment.)
-- Observability parity for the Life Conversion Campaign execution ledger (D9), bringing
-- life_campaign_executions to the same retry/dead-letter shape the reference Cross-Sell Life
-- engine already carries (migration 085). Forward-only and idempotent — safe to re-run.
--
-- What this adds (and nothing else — no data change, no behavior change on its own):
--   • idempotency_key  — global dedupe key for an execution (mirrors 085; a unique partial index
--                        enforces at-most-one live key). The runner may stamp it so the retry sweep
--                        can find a stuck send; until then it stays NULL and the sweep is inert.
--   • attempts         — retry accounting (default 0).
--   • next_retry_at    — when a still-'scheduled' execution becomes eligible for the retry sweep.
--   • status 'dead_letter' — a terminal "needs operator attention" outcome after the retry ceiling.
--   • partial indexes  — the dead-letter list, the retry queue, and the idempotency guard.
--
-- Sequencing: this migration is inert until applied and must be applied BEFORE any runner code that
-- writes these columns is deployed. The retry sweep (life-campaign/jobs.ts) and health route degrade
-- gracefully (no-op / null counts) if they run before this migration lands, so ordering is safe.

alter table life_campaign_executions
  add column if not exists idempotency_key text,
  add column if not exists attempts        integer not null default 0,
  add column if not exists next_retry_at    timestamptz;

-- Extend the status vocabulary with 'dead_letter'. Drop the auto-named CHECK and re-add it so the
-- set matches the reference engine (085). Idempotent: drop-if-exists then add.
alter table life_campaign_executions drop constraint if exists life_campaign_executions_status_check;
alter table life_campaign_executions add constraint life_campaign_executions_status_check
  check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed','dead_letter'));

-- Global idempotency guard (at most one execution per non-null key).
create unique index if not exists idx_lcx_idem on life_campaign_executions (idempotency_key)
  where idempotency_key is not null;
-- Dead-letter list for the health route / operator queue.
create index if not exists idx_lcx_deadletter on life_campaign_executions (status)
  where status = 'dead_letter';
-- Retry queue — still-scheduled executions with a due retry time.
create index if not exists idx_lcx_retry on life_campaign_executions (next_retry_at)
  where status = 'scheduled' and next_retry_at is not null;

-- Rollback (manual; forward-only by policy):
--   drop index if exists idx_lcx_retry, idx_lcx_deadletter, idx_lcx_idem;
--   alter table life_campaign_executions drop constraint if exists life_campaign_executions_status_check;
--   alter table life_campaign_executions add constraint life_campaign_executions_status_check
--     check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed'));
--   alter table life_campaign_executions drop column if exists next_retry_at, drop column if exists attempts,
--     drop column if exists idempotency_key;
