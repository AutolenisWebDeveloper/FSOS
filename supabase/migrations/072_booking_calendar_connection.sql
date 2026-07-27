-- ─────────────────────────────────────────────────────────
-- Migration: 072_booking_calendar_connection
--
-- Native FSOS booking system — Slice 7 (one-way Google Calendar busy-sync). Adds the
-- single table that stores a host's READ-ONLY Google Calendar connection so the pure
-- availability calculator can subtract the FSA's real external commitments (externalBusy).
--
-- DESIGN NOTES
--   • ONE-WAY, READ-ONLY. FSOS reads busy time-ranges via Google's freeBusy API
--     (scope calendar.readonly). It NEVER writes appointments back to Google in this
--     initiative (ADR-027 §7). freeBusy returns only start/end instants — no event
--     titles, attendees, or details — so nothing but opaque busy windows is ever stored.
--   • TOKENS ENCRYPTED AT REST. The OAuth credential envelope (access/refresh token,
--     expiry) is encrypted IN POSTGRES via pgcrypto pgp_sym_encrypt, with the symmetric
--     key held in the environment and passed per-call — never stored in the DB. This
--     conforms to the established secret-at-rest technique (social_channel_set_secret,
--     mig 063; DOB column encryption) but is BOOKING-LOCAL: the social module is frozen,
--     and a booking calendar credential belongs in the booking bounded context, not
--     conflated into social_channels (§6 bounded contexts).
--   • not_configured-SAFE. When Google OAuth env vars are absent, or no host has
--     connected, or a token has expired/been revoked, availability degrades to native
--     data (WARNING, never a hard failure) — enforced in the service layer.
--   • SECURITIES FIREWALL (§4.1) intact: no securities data; only the host's own
--     scheduling busy-windows and the connected account email are stored.
--
-- Additive · idempotent · forward-only. Default-deny under RLS (service-role writes
-- after an rbac assertion, matching the sibling booking config tables in mig 069). The
-- secret_enc bytea column is NEVER selected into any client-facing shape.
-- ─────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── 1. The per-host read-only calendar connection ────────────────────────────────────────
create table if not exists booking_calendar_connections (
  id                   uuid primary key default gen_random_uuid(),
  host_user_id         uuid,                                   -- owning FSA/host (null = default practice host)
  provider             text not null default 'google' check (provider in ('google')),
  google_account_email text,                                   -- the FSA's OWN connected calendar account (display/identity)
  calendar_id          text not null default 'primary',        -- which calendar to read busy from
  status               text not null default 'not_configured'
                         check (status in ('not_configured','connected','error','revoked')),
  secret_enc           bytea,                                  -- pgcrypto-encrypted credential envelope; NEVER selected to a client
  scopes               jsonb not null default '[]'::jsonb,     -- scopes Google actually granted
  token_expires_at     timestamptz,
  last_synced_at       timestamptz,                            -- last successful freeBusy read
  last_error           text,                                   -- last degradation reason (non-sensitive)
  connected_by         text,
  connected_at         timestamptz,
  created_by           text,
  updated_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

comment on table booking_calendar_connections is
  'Native booking Slice 7: a host''s READ-ONLY Google Calendar connection. Feeds the availability calculator''s externalBusy via freeBusy. One-way only — FSOS never writes to Google (ADR-027 §7). Tokens encrypted at rest (secret_enc, pgcrypto).';
comment on column booking_calendar_connections.secret_enc is
  'pgcrypto-encrypted OAuth credential envelope. Encrypted/decrypted only via booking_calendar_set_secret / booking_calendar_secret with the env-held key. NEVER selected into a client-facing shape or logged.';
comment on column booking_calendar_connections.google_account_email is
  'The FSA''s own connected Google account email (identity/display). Not client PII — the practice''s own calendar account.';

-- One active connection per host (null host = the default practice host).
create unique index if not exists uq_booking_calendar_host
  on booking_calendar_connections (host_user_id)
  where deleted_at is null and host_user_id is not null;
create unique index if not exists uq_booking_calendar_default_host
  on booking_calendar_connections ((true))
  where deleted_at is null and host_user_id is null;

create index if not exists idx_booking_calendar_status
  on booking_calendar_connections (status) where deleted_at is null;

drop trigger if exists booking_calendar_connections_updated_at on booking_calendar_connections;
create trigger booking_calendar_connections_updated_at before update on booking_calendar_connections
  for each row execute function update_updated_at();

-- ── 2. Encryption at rest — pgcrypto, app-supplied key (never stored in the DB) ──────────
-- SECURITY DEFINER so the encrypt/decrypt runs with the extension available; the symmetric
-- key is passed per-call from the environment (booking_calendar_token key). Mirrors the
-- social_channel_set_secret / social_channel_secret pattern (mig 063), booking-local.
create or replace function booking_calendar_set_secret(p_id uuid, p_secret text, p_key text)
returns void language sql volatile security definer as $$
  update booking_calendar_connections set secret_enc = pgp_sym_encrypt(p_secret, p_key) where id = p_id;
$$;

create or replace function booking_calendar_secret(p_id uuid, p_key text)
returns text language sql stable security definer as $$
  select nullif(pgp_sym_decrypt(secret_enc, p_key), '') from booking_calendar_connections where id = p_id;
$$;

-- Harden: only the service role (and the DB owner) may invoke the crypto helpers — a
-- SECURITY DEFINER function is world-executable by default. Revoke from the login roles
-- so a compromised anon/authenticated session cannot call decrypt with a guessed key.
revoke all on function booking_calendar_set_secret(uuid, text, text) from public;
revoke all on function booking_calendar_secret(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function booking_calendar_set_secret(uuid, text, text) from anon';
    execute 'revoke all on function booking_calendar_secret(uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function booking_calendar_set_secret(uuid, text, text) from authenticated';
    execute 'revoke all on function booking_calendar_secret(uuid, text) from authenticated';
  end if;
end $$;

-- ── 3. RLS — default-deny (service-role writes after rbac, matching mig 069) ──────────────
alter table booking_calendar_connections enable row level security;
