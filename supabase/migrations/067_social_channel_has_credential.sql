-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 067_social_channel_has_credential  (ADR-026 fix)
--
-- BUG: the social account loaders derived `has_credential` with a raw SQL expression
-- embedded in the PostgREST select string — `(secret_enc is not null) as has_credential`.
-- PostgREST does not support SQL expressions in `select`; supabase-js also strips the
-- whitespace, so the server received `(secret_encisnotnull)ashas_credential` and returned
-- HTTP 500 "failed to parse select parameter". Every /app/social/accounts load 500'd.
--
-- FIX: make `has_credential` a REAL, selectable STORED generated column. The boolean is
-- computed in Postgres from secret_enc and kept in sync on every write (including the
-- social_channel_set_secret RPC). The ciphertext secret_enc is STILL never selected into
-- any client-facing shape — only this derived boolean is exposed. Additive · idempotent ·
-- forward-only.
-- ─────────────────────────────────────────────────────────────────────────────

alter table social_channels
  add column if not exists has_credential boolean
  generated always as (secret_enc is not null) stored;

comment on column social_channels.has_credential is
  'Derived (generated): true when an encrypted OAuth credential is stored. secret_enc itself is never selected client-side; this boolean is the only credential-presence signal exposed (ADR-026).';
