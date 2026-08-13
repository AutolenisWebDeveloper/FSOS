-- ─────────────────────────────────────────────────────────
-- Migration 114 — District Agent FS Nurture observability (retry / dead-letter)
--
-- Mirrors 088 (pipeline_winback). Adds the idempotency + retry columns the tick and
-- retry sweep (src/lib/district-nurture/{tick,jobs}.ts) rely on, and extends the
-- execution status set with 'dead_letter'. Idempotent.
-- ─────────────────────────────────────────────────────────

alter table district_nurture_executions
  add column if not exists idempotency_key text,
  add column if not exists attempts        integer not null default 0,
  add column if not exists next_retry_at    timestamptz;

alter table district_nurture_executions drop constraint if exists district_nurture_executions_status_check;
alter table district_nurture_executions add constraint district_nurture_executions_status_check
  check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed','dead_letter'));

create unique index if not exists idx_dnx_idem on district_nurture_executions (idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_dnx_deadletter on district_nurture_executions (status)
  where status = 'dead_letter';
create index if not exists idx_dnx_retry on district_nurture_executions (next_retry_at)
  where status = 'scheduled' and next_retry_at is not null;
