-- ─────────────────────────────────────────────────────────
-- Migration: 055_comm_consent_purpose_reconcile
--
-- HOTFIX for migration 054. 054 added a `purpose` column to `consents`, dropped the
-- unique(member_id, channel) constraint, and replaced it with two PARTIAL unique indexes.
-- That breaks every existing consent upsert that uses `onConflict: 'member_id,channel'`
-- — PostgREST's ON CONFLICT (member_id, channel) cannot use a partial index without a
-- matching WHERE clause, so it errors. The affected call sites include the STOP/START
-- opt-out handler (src/lib/comms/inbound.ts) — a compliance-critical path — plus the
-- client consent portal and the referral-convert consent seed. hasConsent()'s
-- maybeSingle() would also break once any purpose-scoped row existed on `consents`.
--
-- This migration reconciles 054 to the safe design: `consents` returns to channel-wide
-- only (its original unique constraint restored, the purpose column removed), and the
-- per-purpose axis moves to a COMPANION table `comm_consent_purposes` with a FULL unique
-- constraint (upsert-safe). Together they are the authoritative channel-and-purpose
-- consent store (§9). The resolver (policy-resolver.ts) prefers the purpose-scoped row,
-- else falls back to the channel-wide `consents` row.
--
-- Forward-only + idempotent. Safe because nothing writes purpose-scoped rows to
-- `consents` (the resolver only reads), so every consents row is channel-wide (purpose
-- NULL) and the unique(member_id, channel) constraint can be restored without conflict.
-- consent_ledger is untouched (append-only evidence, never enforcement — §9).
-- ─────────────────────────────────────────────────────────

-- ── 1. Restore consents to channel-wide-only (undo the 054 surgery) ──────────
drop index if exists uq_consents_member_channel_nopurpose;
drop index if exists uq_consents_member_channel_purpose;
alter table consents drop column if exists purpose;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'consents_member_id_channel_key') then
    alter table consents add constraint consents_member_id_channel_key unique (member_id, channel);
  end if;
end $$;

-- ── 2. Per-purpose consent as a companion table (upsert-safe FULL unique) ─────
create table if not exists comm_consent_purposes (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references household_members(id) on delete cascade,
  household_id  uuid references households(id) on delete set null,
  channel       text not null check (channel in ('sms','email')),
  purpose       text not null check (purpose in (
                  'TRANSACTIONAL_SMS','MARKETING_SMS','TRANSACTIONAL_EMAIL','MARKETING_EMAIL',
                  'APPOINTMENT_REMINDERS','SERVICE_NOTIFICATIONS','WORKSHOP_COMMUNICATIONS','BIRTHDAY_COMMUNICATIONS')),
  status        text not null default 'granted' check (status in ('granted','revoked')),
  source        text,
  disclosure    text,
  captured_at   timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (member_id, channel, purpose)
);

comment on table comm_consent_purposes is
  'Per-purpose consent axis (§9), companion to the channel-wide `consents` table. A purpose-scoped grant/revoke overrides the channel-wide default for that purpose; absence falls back to `consents`. Kept separate so consents unique(member_id,channel) + its onConflict upsert call sites are unchanged. Full unique(member_id,channel,purpose) is upsert-safe.';

create index if not exists idx_ccp_member_channel on comm_consent_purposes (member_id, channel);

alter table comm_consent_purposes enable row level security;
drop policy if exists ccp_read on comm_consent_purposes;
create policy ccp_read on comm_consent_purposes for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

-- ── 3. Fix the frequency-count index to match the actual queries ─────────────
-- 054 indexed (member_id, channel, created_at desc); the counting queries filter on
-- direction='outbound' + delivery_status='sent' + sent_at (and purpose for marketing).
drop index if exists idx_msg_member_channel_sent;
create index if not exists idx_msg_freq_count
  on comm_messages (member_id, channel, sent_at desc)
  where direction = 'outbound' and delivery_status = 'sent' and member_id is not null;
