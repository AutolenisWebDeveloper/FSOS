-- 137_booking_reminder_cadence.sql
-- Add a 12-hour and a 1-hour appointment reminder to the shipped cadence, and give the
-- appointment frequency caps the headroom that cadence needs.
--
-- Migration 093 shipped `offsets_minutes` as '{1440}' — a single 24-hour reminder — and its own
-- comment pointed at the intended shape ("e.g. '{1440,60}' adds a 1h reminder"). A day-ahead
-- notice alone leaves the longest gap exactly where a no-show is decided: the morning of, and
-- the hour before. This moves the shipped default to 24h + 12h + 1h.
--
-- Nothing else has to change for the cadence itself: runBookingReminderPass already sweeps every
-- configured offset and the delivery ledger keys each one independently, so each fires exactly
-- once per schedule_version on each enabled channel. The */15 cron is fine-grained enough that a
-- 60-minute offset lands within a quarter-hour of T-60.
--
-- WHY THE CAPS MOVE WITH IT. Three offsets on two channels is up to six touches inside the
-- trailing 24 hours, plus a confirmation for a same-day booking. Migration 136 sized the
-- appointment row for a single reminder (4 SMS/day, 8 combined), so the new cadence would have
-- run straight into its own ceiling and deferred the last reminder of the sequence — the 1-hour
-- one, the one that matters most. The ceilings stay real, they are just sized for the cadence
-- the product now ships. They remain the operator-editable bound (§4.3, is_assumption).
--
-- GUARDED, like migration 131's cadence move: each UPDATE fires only on a row still carrying the
-- exact value its own migration shipped, so an operator who has already tuned these keeps their
-- numbers and a re-apply is a no-op.
--
-- Additive, forward-only, idempotent. No schema change beyond a column DEFAULT, no RLS change,
-- no securities data (firewall §4.1).

-- ── 1. The shipped cadence: 24h + 12h + 1h ────────────────────────────────────────
alter table booking_reminder_config
  alter column offsets_minutes set default '{1440,720,60}';

-- Move a config row still carrying the ORIGINAL shipped default onto the new cadence.
-- An operator-edited offset set is left untouched.
update booking_reminder_config
set offsets_minutes = '{1440,720,60}', updated_at = now()
where id = 'global' and offsets_minutes = '{1440}';

comment on column booking_reminder_config.offsets_minutes is
  'Minutes-before-start at which a pre-appointment reminder fires, one delivery per offset per channel per schedule_version. Ships as 24h + 12h + 1h. Every value is swept by runBookingReminderPass and keyed independently in booking_notification_deliveries, so adding or removing an offset needs no code change — but keep the count within comm_frequency_policy''s ''appointment'' ceilings, which bound how many touches one recipient can receive in a day.';

-- ── 2. Appointment frequency ceilings sized for that cadence ──────────────────────
-- Worst case inside a trailing 24h: 3 reminders × 2 channels = 6, plus a confirmation on a
-- same-day booking (2) = 8 — exactly migration 136's ceiling, so the eighth touch would have
-- been refused. These leave room for that plus a reschedule notice, and no more.
update comm_frequency_policy
set max_sms_per_day = 6,
    max_combined_touches_per_day = 12,
    note = 'Config default — VERIFY. Appointment-scoped caps: applied ONLY to a send classified ' ||
           'purpose=APPOINTMENT (booking confirmation, reminder, reschedule, cancellation, recap, ' ||
           'no-show), never to campaign/drip outreach, which keeps using the ''global'' row. ' ||
           'min_interval is 0 because the email and SMS legs of one appointment notice are sent ' ||
           'together by design; the per-day/per-7-day maxima are the real bound, sized (mig 137) ' ||
           'for the 24h + 12h + 1h reminder cadence on two channels plus a same-day confirmation. ' ||
           'A capped send is a non-escalating deferral, retried by the booking cron, never ' ||
           'silently dropped.'
where id = 'appointment'
  and max_sms_per_day = 4
  and max_combined_touches_per_day = 8;

-- Rollback:
--   alter table booking_reminder_config alter column offsets_minutes set default '{1440}';
--   update booking_reminder_config set offsets_minutes = '{1440}' where id = 'global';
--   update comm_frequency_policy set max_sms_per_day = 4, max_combined_touches_per_day = 8
--    where id = 'appointment';
