-- ─────────────────────────────────────────────────────────
-- Migration: 054_comm_purpose_frequency
--
-- Native Communications Platform — SLICE 3: policy-engine extensions (master build
-- instruction §9/§10; ADR-017). Adds the PURPOSE axis to the enforced consent store and
-- the editable frequency-cap policy. The pure decisions live in purpose.ts / frequency.ts
-- and are enforced at the send gate (steps `frequency`, `collision`, and purpose-scoped
-- `consent`).
--
--   1. consents.purpose — the per-purpose consent axis on the SPINE consent table (the
--      store the gate actually enforces, §9). A NULL purpose is the existing channel-wide
--      consent (fully backward-compatible). A purpose-scoped row lets a contact grant or
--      revoke a specific purpose (e.g. MARKETING_SMS) independently of the channel.
--
--   2. comm_frequency_policy — editable per-recipient rate caps (max SMS/day + /7d, max
--      marketing emails/day + /7d, max combined touches/day, min interval). Config
--      defaults (is_assumption → gold "verify" badge, §4.3); frequency counts are derived
--      from comm_messages at send time (no separate counter table).
--
-- Additive, forward-only, idempotent. The consents.purpose column is nullable; existing
-- rows stay channel-wide. The old unique(member_id, channel) is replaced by two partial
-- unique indexes so channel-wide AND purpose-scoped consent can coexist. No securities
-- data (firewall §4.1). No GHL surface touched (§0.A). consent_ledger is NOT modified —
-- it remains append-only evidence, never an enforcement store (§9).
-- ─────────────────────────────────────────────────────────

-- ── 1. Purpose axis on the enforced consent store ────────────────────────────
alter table consents
  add column if not exists purpose text
    check (
      purpose is null or purpose in (
        'TRANSACTIONAL_SMS','MARKETING_SMS','TRANSACTIONAL_EMAIL','MARKETING_EMAIL',
        'APPOINTMENT_REMINDERS','SERVICE_NOTIFICATIONS','WORKSHOP_COMMUNICATIONS','BIRTHDAY_COMMUNICATIONS'
      )
    );

comment on column consents.purpose is
  'Per-purpose consent axis (§9). NULL = channel-wide consent (existing behavior). A purpose-scoped row grants/revokes one consent purpose independently; the send resolver prefers the purpose-scoped row, else falls back to the channel-wide row.';

-- Replace the channel-only uniqueness with two partial unique indexes so a channel-wide
-- row (purpose NULL) and one row per purpose can coexist for the same member+channel.
alter table consents drop constraint if exists consents_member_id_channel_key;
create unique index if not exists uq_consents_member_channel_nopurpose
  on consents (member_id, channel) where purpose is null;
create unique index if not exists uq_consents_member_channel_purpose
  on consents (member_id, channel, purpose) where purpose is not null;

-- ── 1b. Record each send's purpose (drives frequency counting + analytics, §9) ──
alter table comm_messages
  add column if not exists purpose text;
comment on column comm_messages.purpose is
  'The classified message purpose (§9: MARKETING/TRANSACTIONAL/SERVICING/…). Nullable/additive; drives marketing-vs-transactional frequency counting and analytics.';
-- Frequency counting filters by (member_id, channel, purpose, created_at); index it.
create index if not exists idx_msg_member_channel_sent
  on comm_messages (member_id, channel, created_at desc) where member_id is not null;

-- ── 2. Editable frequency-cap policy (singleton) ─────────────────────────────
create table if not exists comm_frequency_policy (
  id                            text primary key default 'global',
  enabled                       boolean  not null default true,
  max_sms_per_day               integer  not null default 2   check (max_sms_per_day >= 0),
  max_sms_per_7_days            integer  not null default 5   check (max_sms_per_7_days >= 0),
  max_marketing_emails_per_day  integer  not null default 1   check (max_marketing_emails_per_day >= 0),
  max_marketing_emails_per_7_days integer not null default 3  check (max_marketing_emails_per_7_days >= 0),
  max_combined_touches_per_day  integer  not null default 3   check (max_combined_touches_per_day >= 0),
  min_interval_minutes          integer  not null default 60  check (min_interval_minutes >= 0),
  is_assumption                 boolean  not null default true,
  note                          text,
  updated_at                    timestamptz not null default now()
);

comment on table comm_frequency_policy is
  'Editable per-recipient frequency caps (§9). Enforced at the send gate (step frequency) as a non-escalating deferral; counts derived from comm_messages. Config defaults (is_assumption) — the FSA sets real caps.';

insert into comm_frequency_policy (id, note)
values ('global', 'Config default — verify your real per-recipient frequency caps. Enforced as an operational deferral (a capped send is held for a later cycle, not a compliance escalation).')
on conflict (id) do nothing;

-- ── 3. RLS — FSA/staff/compliance/supervisor/admin/super read; service-role writes.
alter table comm_frequency_policy enable row level security;
drop policy if exists cfp_read on comm_frequency_policy;
create policy cfp_read on comm_frequency_policy for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
