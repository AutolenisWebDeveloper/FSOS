-- 122_comm_message_events_dedupe.sql — FSOS-032
-- Providers deliver status callbacks AT LEAST ONCE, so a repeated delivered/opened/clicked
-- callback appended a DUPLICATE row to the append-only comm_message_events ledger (the table had
-- only plain indexes, no idempotency key). Aggregate delivery rates are read off the reconciled
-- parent comm_messages columns and are unaffected, but the per-message timeline showed dupes.
--
-- Add a plain unique index that dedupes a CORRELATED provider event by its natural fingerprint
-- (message_id, event, provider_id). A PLAIN (not partial) unique index is used deliberately:
--   • Standard SQL treats a tuple containing any NULL as DISTINCT, so orphaned events
--     (message_id IS NULL — the pre-correlation window, FSOS-030) and internal/non-provider
--     events (provider_id IS NULL, e.g. an inbound 'replied' marker) are NEVER constrained —
--     the same effect a partial predicate would give, without the predicate.
--   • A plain index lets Postgres INFER it for `ON CONFLICT (message_id, event, provider_id)`.
--     A PARTIAL index cannot be inferred by onConflict (supabase-js can't pass the predicate),
--     which would make the upsert fail its conflict target.
-- recordMessageEvent() upserts with ignoreDuplicates so a redelivered identical callback is a
-- no-op instead of a duplicate row; an uncorrelated event is still appended (never dropped).
--
-- BACKFILL FIRST: this table already contains the duplicate rows the bug produced, so a bare
-- CREATE UNIQUE INDEX would ABORT on existing data. Collapse each correlated duplicate group to a
-- single row (keep the newest by ctid) BEFORE building the index. Only fully-correlated rows are
-- touched: the equality joins skip NULL message_id / provider_id (NULL = NULL is false), and the
-- explicit NOT NULL guards make that intent unmistakable — so orphaned/internal rows are never
-- deleted. This runs once; on a table with no duplicates (e.g. a fresh DB) it is a no-op.
delete from comm_message_events a
  using comm_message_events b
 where a.ctid < b.ctid
   and a.message_id = b.message_id
   and a.event = b.event
   and a.provider_id = b.provider_id
   and a.message_id is not null
   and a.provider_id is not null;

create unique index if not exists uq_comm_message_events_dedupe
  on comm_message_events (message_id, event, provider_id);

comment on index uq_comm_message_events_dedupe is
  'FSOS-032: idempotency key for provider status callbacks — one row per (message, event, provider message). Plain unique index: NULL tuples are distinct, so orphaned (null message_id) and internal (null provider_id) events are unconstrained, and onConflict can infer it.';
