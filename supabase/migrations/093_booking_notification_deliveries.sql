-- ─────────────────────────────────────────────────────────
-- Migration: 093_booking_notification_deliveries
--
-- P5 notification automation — the CORRECTNESS CORE. Replaces the single appointments.reminder_sent_at
-- boolean with a per-(appointment, schedule_version, event, offset, channel) delivery ledger whose
-- UNIQUE key IS the fire-once guarantee, plus a schedule_version that makes reschedule re-anchoring
-- correct (a bumped version re-arms the new time's reminders once each, even if rescheduled back to a
-- prior time). Additive + forward-only. reminder_sent_at is retained (nullable) for one release for
-- rollback; the P5 email-lifecycle slice retires it.
--
-- RLS posture: matches the existing comm_messages / booking-config app-layer posture — RLS ENABLED
-- with a role-gated STAFF READ policy, writes run service-role AFTER the rbac assertion, NOT FORCE'd
-- and NOT tenant-scoped. This is the SAME app-layer-only isolation cohort as comm_messages /
-- comm_message_events (single-FSA acceptable; recorded in the pre-multi-tenant ledger). It is
-- deliberately NOT a third pattern; FORCE + tenant scoping is the deferred comms-wide hardening.
--
-- No explicit BEGIN/COMMIT: the runner applies each file atomically. Idempotent.
-- ─────────────────────────────────────────────────────────

-- Monotonic schedule version — bumped by the reschedule mover; ties a delivery to a scheduled time.
-- `not null default 1` backfills every EXISTING appointment to version 1 (constant default = metadata
-- only in PG11+, no table rewrite; no null gap, no separate backfill).
alter table appointments add column if not exists schedule_version int not null default 1;

-- The delivery ledger. One row per notice actually acted on; the UNIQUE key is fire-once.
create table if not exists booking_notification_deliveries (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null references appointments(id) on delete cascade,
  schedule_version int  not null,
  event            text not null check (event in ('confirmation','reminder','rescheduled','cancellation','no_show_followup','recap')),
  offset_minutes   int  not null default 0,   -- reminders: minutes-before-start (e.g. 1440=24h); 0 = immediate events
  channel          text not null check (channel in ('email','sms')),
  status           text not null default 'sent' check (status in ('sent','deferred','blocked','failed')),
  comm_message_id  uuid references comm_messages(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (appointment_id, schedule_version, event, offset_minutes, channel)
);
create index if not exists idx_bnd_appt on booking_notification_deliveries (appointment_id, schedule_version);

-- Reminder configuration: which offsets fire, per channel. `sms_enabled` is the P5 booking-SMS
-- FEATURE flag; Stage 4 turns it ON (default true). It is NOT the carrier go-live gate — real SMS
-- still requires SMS_A2P_APPROVED=true (A2P 10DLC, src/lib/comms/a2p.ts), affirmative per-contact
-- SMS consent (comm_contact_consents, Stage 3), an APPROVED sms template, and every other gate step.
-- To keep booking SMS staged despite the feature flag, set sms_enabled=false via UPDATE. Values are
-- config defaults (§4.3): editable, is_assumption=true (render the gold "config default — verify" badge).
create table if not exists booking_reminder_config (
  id              text primary key default 'global',
  offsets_minutes int[] not null default '{1440}',   -- 24h; e.g. '{1440,60}' adds a 1h reminder
  email_enabled   boolean not null default true,
  sms_enabled     boolean not null default true,       -- P5 booking-SMS feature flag (Stage 4 ON)
  is_assumption   boolean not null default true,
  updated_at      timestamptz not null default now()
);
insert into booking_reminder_config (id) values ('global') on conflict do nothing;

-- RLS — enabled, role-gated staff read, service-role writes (matches booking-config / comm_messages).
alter table booking_notification_deliveries enable row level security;
alter table booking_reminder_config         enable row level security;

drop policy if exists bnd_read on booking_notification_deliveries;
create policy bnd_read on booking_notification_deliveries for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
  or has_role('compliance') or has_role('supervisor')
);
drop policy if exists brc_read on booking_reminder_config;
create policy brc_read on booking_reminder_config for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
  or has_role('compliance') or has_role('supervisor')
);

-- Rollback:
--   drop table if exists booking_notification_deliveries;
--   drop table if exists booking_reminder_config;
--   alter table appointments drop column if exists schedule_version;
