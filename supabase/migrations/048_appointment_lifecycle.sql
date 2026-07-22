-- ─────────────────────────────────────────────────────────
-- Migration: 048_appointment_lifecycle
--
-- AI Revenue Command Center — Appointment Generation & Recovery slice (§13.4). The
-- appointments table (mig 009) could only ever be created at status 'scheduled' (via a
-- review); nothing advanced it to completed/cancelled/no_show, linked it to the
-- originating opportunity, or recovered a no-show. This slice adds the lifecycle
-- management + no-show recovery (lib/appointments/recovery.ts + service.ts).
--
-- Adds:
--   • opportunity_id — direct link to the revenue opportunity the appointment advances
--     (§13.4 "link the appointment to its originating opportunity"). Previously an
--     appointment linked to an opportunity only transitively via reviews.generated_opp_ids.
--   • the two indexes the lifecycle/recovery queries need (the table had NONE): one for
--     the overdue/status sweep, one for the opportunity join.
--
-- Additive + idempotent + forward-only. Nullable FK, existing rows stay NULL (no
-- backfill), the review-create insert path is unaffected. RLS is inherited from the
-- table (mig 010, service-role writes); no policy change. No securities data stored.
-- ─────────────────────────────────────────────────────────

alter table appointments
  add column if not exists opportunity_id uuid references opportunities(id) on delete set null;

comment on column appointments.opportunity_id is
  'Optional direct link to the revenue opportunity this appointment advances (§13.4). Nullable; additive (mig 048).';

-- The lifecycle/recovery sweep filters by status + scheduled_at; the table had no index.
create index if not exists idx_appointments_status_scheduled on appointments(status, scheduled_at);
create index if not exists idx_appointments_opportunity on appointments(opportunity_id) where opportunity_id is not null;
