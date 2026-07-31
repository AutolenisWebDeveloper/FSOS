-- ─────────────────────────────────────────────────────────
-- Migration: 079_comm_messages_provider_dedupe
--
-- Inbound-webhook idempotency (god-mode audit, §13.10/§16.3). A provider (Twilio,
-- Resend) retries a webhook on any non-2xx or timeout, so the same inbound message can
-- arrive more than once. Without a guard that creates a DUPLICATE conversation message
-- and can fire a SECOND AI auto-reply — a TCPA/compliance exposure.
--
-- A globally-unique provider message id (Twilio MessageSid, Resend id) must map to at
-- most one comm_messages row. Partial unique index (WHERE provider_id IS NOT NULL) so
-- internal/manual rows without a provider id are unaffected. The application also
-- pre-checks provider_id before processing (src/lib/comms/inbound.ts); this index is the
-- hard race-proof backstop.
--
-- Idempotent (IF NOT EXISTS). Transaction-safe (runs inside the runner's per-file txn).
-- If creation ever fails on pre-existing duplicate provider_ids, dedupe those rows first.
-- ─────────────────────────────────────────────────────────

create unique index if not exists uq_comm_messages_provider_id
  on comm_messages (provider_id)
  where provider_id is not null;
