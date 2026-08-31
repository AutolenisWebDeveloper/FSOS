-- 136_comm_appointment_frequency_policy.sql
-- A third frequency-cap row, scoped to APPOINTMENT sends — the same shape migration 103
-- established for conversation replies, and for the same reason.
--
-- THE DEFECT. The 'global' caps (migration 054) bound proactive OUTREACH: min_interval_minutes
-- 60, max_combined_touches_per_day 3. Booking notices are not outreach, and they are delivered
-- on two channels at once. For a booker who resolves to an existing household member — the
-- frequency caps are member-keyed, so this is exactly the established-client case — the sequence
-- is: the confirmation EMAIL sends, then seconds later the confirmation SMS asks the gate for
-- permission and is told "minimum interval not met (0m < 60m)". The client asked to be texted
-- about this appointment and the text is held for an hour. The daily cap compounds it: a
-- confirmation on two channels plus a reminder on two channels is four touches against a
-- ceiling of three.
--
-- Migration 103 met this exact problem for replies ("answering someone who just texted you is
-- not the mass-outreach case the interval cap exists to bound") and solved it with a scoped row
-- rather than by weakening the control. This does the same: the interval drops to 0 because a
-- confirmation and its companion text are ONE notification on two channels the client chose,
-- while the per-day and per-7-day maxima stay real, auditable ceilings.
--
-- The send path SELECTS the row (src/lib/comms/dispatch-policy.ts) from the purpose the message
-- already carries, so this cannot be reached by campaign or drip traffic: those carry MARKETING
-- and keep using 'global'. A deployment that has not applied this migration falls back to
-- 'global' automatically (policy-resolver.ts loadFrequencyCaps), i.e. to today's behavior.
--
-- Config defaults (§4.3): is_assumption = true → the gold "verify" badge. These are FSOS
-- operating settings, not carrier or Farmers figures; the FSA sets the real numbers.
--
-- Additive, forward-only, idempotent. No schema change, no RLS change (the caps table's existing
-- policy already governs reads); one INSERT ... ON CONFLICT DO NOTHING.

insert into comm_frequency_policy (
  id,
  enabled,
  min_interval_minutes,
  max_sms_per_day,
  max_sms_per_7_days,
  max_marketing_emails_per_day,
  max_marketing_emails_per_7_days,
  max_combined_touches_per_day,
  is_assumption,
  note
)
values (
  'appointment',
  true,
  0,   -- a confirmation and its companion text are ONE notification on two channels
  4,   -- config default — confirmation + reschedule/cancel + reminders for one appointment
  12,  -- config default — per-7-day ceiling across appointments
  1,   -- appointment notices are never marketing; kept at the outreach value
  3,
  8,   -- combined touches/day: two channels × (confirmation + a change + reminders)
  true,
  'Config default — VERIFY. Appointment-scoped caps: applied ONLY to a send classified ' ||
  'purpose=APPOINTMENT (booking confirmation, reminder, reschedule, cancellation, recap, ' ||
  'no-show), never to campaign/drip outreach, which keeps using the ''global'' row. ' ||
  'min_interval is 0 because the email and SMS legs of one appointment notice are sent ' ||
  'together by design; the per-day/per-7-day maxima are the real bound. A capped send is a ' ||
  'non-escalating deferral, retried by the booking cron, never silently dropped.'
)
on conflict (id) do nothing;

comment on table comm_frequency_policy is
  'Editable per-recipient frequency caps (§9). Enforced at the send gate (step frequency) as a non-escalating deferral; counts derived from comm_messages. THREE rows: ''global'' bounds proactive campaign/drip outreach; ''reply'' bounds inbound-triggered conversation replies (ADR-017 amendment, migration 103); ''appointment'' bounds booking lifecycle notices (migration 136), whose two channels are sent together and would otherwise cap each other. The send path selects the row from the message''s own purpose, so none can be bypassed. Config defaults (is_assumption) — the FSA sets real caps.';

-- Rollback:
--   delete from comm_frequency_policy where id = 'appointment';
