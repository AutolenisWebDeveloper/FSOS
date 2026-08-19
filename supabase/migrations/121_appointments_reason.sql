-- 121_appointments_reason.sql
-- Persist the attendee-selected "reason for appointment" (meeting topic) on the appointment.
--
-- WHY: the public scheduler collects a reason so the FSA can prepare for and route the meeting.
-- Before this, the booking form captured no topic at all (free-text "notes" only survived in the
-- activities note + the FSA email, never as a queryable column). This adds a first-class column so
-- the reason is saved WITH the appointment and shown internally on the appointment detail view.
--
-- SCOPE / FIREWALL (CLAUDE.md §9): `reason` is green-zone SCHEDULING metadata — the conversation
-- topic the prospect picked, NOT a securities account/order/holding or a suitability determination.
-- It is stored as a stable slug from a fixed list (see src/lib/booking/config-schemas.ts
-- APPOINTMENT_REASONS). It does NOT set is_security and never routes into a securities workflow.
--
-- Nullable + no default: legacy appointments (and any non-native/manual bookings that don't collect
-- a topic) carry NULL, which the UI renders as "—". No backfill. Additive + forward-only.
--
-- ROLLBACK:
--   alter table appointments drop column if exists reason;

alter table appointments
  add column if not exists reason text;

comment on column appointments.reason is
  'Attendee-selected meeting topic (green-zone scheduling metadata, CLAUDE.md §9). Stable slug from '
  'the fixed APPOINTMENT_REASONS list (e.g. life_insurance, retirement_planning, annuities). NOT a '
  'securities record and does not set is_security. NULL for legacy/manual bookings.';
