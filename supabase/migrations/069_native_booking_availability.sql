-- ─────────────────────────────────────────────────────────
-- Migration: 069_native_booking_availability
--
-- Native FSOS booking system — Slice 1 (availability model + rules engine). Replaces the
-- Calendly dependency with a first-class, spine-attached appointment booking system. This
-- slice is SCHEMA ONLY (no UI, no public route): it extends the minimal `appointments`
-- table (mig 009 / 048) with the columns a real booking system needs, and adds the three
-- supporting configuration tables the pure availability calculator reads
-- (src/lib/booking/availability.ts).
--
-- DESIGN NOTES
--   • EXTEND, don't fork. Per the build contract we extend `appointments` in place rather
--     than create a parallel `bookings` table. Native bookings additionally populate
--     starts_at/ends_at + host_user_id; scheduled_at is kept in lock-step with starts_at
--     for backward-compatibility so every existing surface that reads scheduled_at (FSA
--     calendar, client pages, dashboards, meeting-prep) keeps working unchanged.
--   • DOUBLE-BOOKING is prevented at the DATABASE level (§1.2), not by a check-then-insert:
--     a PARTIAL UNIQUE INDEX on (host_user_id, starts_at) WHERE status='scheduled'. Two
--     concurrent confirmations of the same slot → exactly one INSERT wins, the other gets
--     a unique-violation the service layer translates into "slot just taken". Cancelling
--     (status → cancelled) frees the slot; rescheduling updates starts_at, both atomically.
--   • TIMEZONE: every instant is timestamptz (UTC). Availability RULES carry their own IANA
--     zone (the host's wall-clock hours); the calculator does DST-correct zoned↔UTC math in
--     TypeScript via Intl (no naive-timestamp arithmetic).
--   • SECURITIES FIREWALL (§4.1): booking stores only scheduling metadata + a spine
--     contact/household link. No securities data. is_security appointments are still routed
--     to human handling by the comms gate (later slices), never auto-messaged.
--
-- Additive · idempotent · forward-only. New tables default-deny under RLS (service-role
-- writes, matching `appointments` mig 010); reads happen server-side through getDb() after
-- an rbac assertion, or through the public booking route (later slice) which only surfaces
-- computed open slots — never other tenants' rows.
-- ─────────────────────────────────────────────────────────

-- ── 1. Appointment types — the bookable "products" (duration/buffers/notice/mode) ────────
create table if not exists appointment_types (
  id                     uuid primary key default gen_random_uuid(),
  host_user_id           uuid,                                  -- owning FSA/host (null = default practice host)
  name                   text not null,
  slug                   text not null unique,                  -- public booking URL segment
  description            text,
  duration_minutes       int  not null default 30  check (duration_minutes between 5 and 480),
  buffer_before_minutes  int  not null default 0   check (buffer_before_minutes >= 0 and buffer_before_minutes <= 480),
  buffer_after_minutes   int  not null default 0   check (buffer_after_minutes  >= 0 and buffer_after_minutes  <= 480),
  min_notice_minutes     int  not null default 240 check (min_notice_minutes >= 0),               -- can't book < 4h out
  max_lead_days          int  not null default 60  check (max_lead_days between 1 and 365),        -- can't book > 60d out
  max_per_day            int  check (max_per_day is null or max_per_day > 0),                      -- null = unlimited
  slot_interval_minutes  int  not null default 30  check (slot_interval_minutes between 5 and 480),-- slot start granularity
  meeting_mode           text not null default 'video' check (meeting_mode in ('video','phone','in_person')),
  review_type            text,                                  -- optional link to the review type this books
  color                  text,                                  -- calendar color token key
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table appointment_types is
  'Native booking: the bookable appointment definitions (duration, buffers, notice window, meeting mode). Read by the availability calculator (mig 069).';
comment on column appointment_types.max_per_day is
  'Cap on confirmed appointments of this type per host-local calendar day; null = unlimited.';
comment on column appointment_types.meeting_mode is
  'Default delivery mode. video → auto-provision Zoom on booking (later slice); phone/in_person skip Zoom.';

create index if not exists idx_appointment_types_active on appointment_types(active) where active = true;
create index if not exists idx_appointment_types_host   on appointment_types(host_user_id) where host_user_id is not null;

drop trigger if exists appointment_types_updated_at on appointment_types;
create trigger appointment_types_updated_at before update on appointment_types
  for each row execute function update_updated_at();

-- ── 2. Availability rules — recurring weekly working hours in the host's IANA zone ───────
create table if not exists availability_rules (
  id              uuid primary key default gen_random_uuid(),
  host_user_id    uuid,                                         -- owning FSA/host (null = default practice host)
  weekday         smallint not null check (weekday between 0 and 6),   -- 0 = Sunday … 6 = Saturday
  start_time      time not null,                                -- wall-clock start in `timezone`
  end_time        time not null,                                -- wall-clock end in `timezone`
  timezone        text not null default 'America/Chicago',      -- IANA zone the wall times are expressed in
  effective_start date,                                         -- rule applies on/after this date (null = always)
  effective_end   date,                                         -- rule applies on/before this date (null = always)
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint availability_rules_time_order check (end_time > start_time)
);

comment on table availability_rules is
  'Native booking: recurring weekly working-hours windows. Wall-clock start/end are interpreted in `timezone` (IANA) so a 9:00 AM rule stays 9:00 AM local across DST. Read by the availability calculator (mig 069).';

create index if not exists idx_availability_rules_host_weekday on availability_rules(host_user_id, weekday) where active = true;

drop trigger if exists availability_rules_updated_at on availability_rules;
create trigger availability_rules_updated_at before update on availability_rules
  for each row execute function update_updated_at();

-- ── 3. Availability blackouts — explicit unavailable ranges (vacations, holds) ───────────
create table if not exists availability_blackouts (
  id            uuid primary key default gen_random_uuid(),
  host_user_id  uuid,                                           -- owning FSA/host (null = default practice host)
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint availability_blackouts_time_order check (ends_at > starts_at)
);

comment on table availability_blackouts is
  'Native booking: explicit unavailable ranges subtracted from computed availability (mig 069).';

create index if not exists idx_availability_blackouts_host_range on availability_blackouts(host_user_id, starts_at, ends_at);

drop trigger if exists availability_blackouts_updated_at on availability_blackouts;
create trigger availability_blackouts_updated_at before update on availability_blackouts
  for each row execute function update_updated_at();

-- ── 4. Extend `appointments` in place (additive — no parallel bookings table) ────────────
alter table appointments
  add column if not exists appointment_type_id uuid references appointment_types(id) on delete set null,
  add column if not exists contact_id          uuid references contacts(id)          on delete set null,
  add column if not exists host_user_id        uuid,                                  -- the FSA/host the meeting is booked with
  add column if not exists duration_minutes    int,
  add column if not exists booker_timezone     text,                                  -- IANA zone the booker chose the slot in
  add column if not exists starts_at           timestamptz,                           -- UTC; native bookings keep scheduled_at = starts_at
  add column if not exists ends_at             timestamptz,
  add column if not exists booking_token       text,                                  -- signed self-service tokens (populated later slice)
  add column if not exists cancel_token        text,
  add column if not exists reschedule_token    text,
  add column if not exists booked_at           timestamptz,
  add column if not exists booked_via          text not null default 'manual'
                                               check (booked_via in ('native','manual','legacy_calendly')),
  add column if not exists cancellation_reason text,
  add column if not exists reminder_sent_at    timestamptz,
  add column if not exists meeting_mode        text check (meeting_mode in ('video','phone','in_person')),
  add column if not exists zoom_meeting_id     text,
  add column if not exists join_url            text,                                  -- client-facing Zoom join link
  add column if not exists start_url           text,                                  -- FSA-ONLY Zoom host link (never sent to client)
  add column if not exists dial_in             text;

comment on column appointments.starts_at is
  'UTC start instant for native bookings. Kept in lock-step with scheduled_at for backward-compat with legacy surfaces (mig 069).';
comment on column appointments.host_user_id is
  'The FSA/host the appointment is booked with. Part of the double-booking unique key (mig 069).';
comment on column appointments.start_url is
  'FSA-only Zoom host URL. NEVER sent to the client or logged (guardrail: only join_url is client-facing).';
comment on column appointments.booked_via is
  'Provenance: native (self-serve booking), manual (FSA/review-created), legacy_calendly (migrated). All behave identically across surfaces.';

-- ── 5. Double-booking guarantee (§1.2) — DB-enforced, not check-then-insert ──────────────
-- At most ONE scheduled appointment per host per slot-start. Only 'scheduled' rows
-- participate, so cancelling frees the slot and legacy rows (null host / null starts_at)
-- are exempt. A concurrent second confirmation of the same slot raises a unique violation
-- the booking service turns into a clean "slot just taken" (never a double-book, never a 500).
create unique index if not exists uq_appointments_host_slot
  on appointments (host_user_id, starts_at)
  where status = 'scheduled' and host_user_id is not null and starts_at is not null;

-- Self-service tokens resolve to exactly one appointment (no ID exposure in links).
create unique index if not exists uq_appointments_cancel_token
  on appointments (cancel_token) where cancel_token is not null;
create unique index if not exists uq_appointments_reschedule_token
  on appointments (reschedule_token) where reschedule_token is not null;

-- Query support: availability subtraction (host + time window) and native-booking filters.
create index if not exists idx_appointments_host_starts
  on appointments (host_user_id, starts_at)
  where host_user_id is not null and starts_at is not null;
create index if not exists idx_appointments_type on appointments(appointment_type_id) where appointment_type_id is not null;
create index if not exists idx_appointments_contact on appointments(contact_id) where contact_id is not null;

-- ── 6. RLS — default-deny on the new config tables (service-role writes, matching mig 010) ─
alter table appointment_types     enable row level security;
alter table availability_rules    enable row level security;
alter table availability_blackouts enable row level security;
