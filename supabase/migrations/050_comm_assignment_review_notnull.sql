-- ─────────────────────────────────────────────────────────
-- Migration: 050_comm_assignment_review_notnull
--
-- Follow-up to #107 review (Copilot finding, comm_assignment_reviews). The queue is
-- routed/deduped by (channel, destination) and the app always supplies both
-- (ownership.ts enqueueAssignmentReview passes the normalized destination + channel),
-- so NULLs would only ever be malformed rows that cannot be displayed or deduped.
-- Enforce the invariant at the DB layer.
--
-- Migration 049 is already merged/applied, so per the never-edit-applied-migrations
-- rule this is a NEW forward-only migration rather than a change to 049. Additive +
-- idempotent: the table is new (049) and every insert path supplies both columns, so
-- no backfill is required and the SET NOT NULL cannot fail on existing rows.
-- ─────────────────────────────────────────────────────────

-- Defensive: repair any pre-existing malformed rows before tightening (there should be
-- none — the only writer always supplies both — but this keeps the ALTER safe to re-run).
update comm_assignment_reviews set destination = '' where destination is null;
update comm_assignment_reviews set channel = 'sms' where channel is null;

alter table comm_assignment_reviews alter column destination set not null;
alter table comm_assignment_reviews alter column channel     set not null;
