-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 064_social_schedule_retry  (Social Content Module — Slice 3, ADR-026)
--
-- Slice 3 adds scheduling + the durable, idempotent publish pipeline. The
-- social_schedule_entries / social_publish_log tables already exist (mig 063);
-- this migration only adds the retry/backoff bookkeeping the job path needs:
--   • next_attempt_at — when a failed-but-retryable entry becomes eligible again
--     (exponential backoff, §16.3). NULL = eligible as soon as scheduled_at passes.
-- Dead-letter is the terminal `failed` status once attempts hit the cap (in code).
--
-- Additive · idempotent · forward-only. No new table, no RLS change (the existing
-- social_schedule_entries policies from 063 cover the new column). Guardrails
-- unchanged: the approval gate + immutability + append-only triggers from 063 hold.
-- ─────────────────────────────────────────────────────────────────────────────

alter table social_schedule_entries
  add column if not exists next_attempt_at timestamptz;

-- The publish job selects entries that are due (scheduled_at passed) AND eligible
-- to attempt now (never retried, or the backoff window elapsed).
create index if not exists idx_social_schedule_next_attempt
  on social_schedule_entries(next_attempt_at)
  where deleted_at is null and status in ('pending', 'failed');

comment on column social_schedule_entries.next_attempt_at is
  'Earliest time a retryable entry may be attempted again (exponential backoff, ADR-026 Slice 3). NULL = eligible once scheduled_at passes.';
