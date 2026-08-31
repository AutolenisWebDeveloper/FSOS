-- 135_booking_sms_appointment_notices.sql
-- Turn ON appointment SMS end to end: booking-captured consent that carries its own
-- appointment reference, and the six APPROVED lifecycle SMS templates the send path
-- requires before it will transmit anything.
--
-- WHY THIS EXISTS. P5 shipped the whole booking-SMS path behind three independent holds:
--   1. `booking_reminder_config.sms_enabled`  — already defaults TRUE (this file, mig 093).
--   2. `SMS_A2P_APPROVED`                     — deployment env, set once A2P 10DLC lands.
--   3. an APPROVED `comm_templates` row per (event × sms) source_key.
-- (3) is the one nothing in the repository could satisfy: `scripts/build-sms-templates.ts`
-- deliberately writes DRAFT rows, and `loadApprovedTemplate` (src/lib/booking/notify.ts)
-- requires approval_status='approved'. Unlike email, an SMS leg has NO transactional
-- fallback — a missing approved template means the message is never sent, forever. So the
-- approved rows are seeded here, the same way migration 131 seeded the workshop gate handle.
--
-- The approval governance is UNCHANGED going forward: `npm run templates:build:sms` still
-- resets a row to DRAFT the moment the authored body bytes change (render_sha mismatch), so
-- re-worded copy is re-reviewed before it can send again. The `render_sha` values below are
-- sha256 of the exact body strings in src/lib/booking/sms-templates.ts, so a fresh run of the
-- build script reads "unchanged" rather than re-drafting approved copy on first deploy.
-- tests/booking-sms-templates.test.mjs pins that equality, so the two cannot drift silently.
--
-- ADDITIVE ONLY: three nullable columns and six template rows. No drop, no truncate, no hard
-- delete — a surplus template row is SOFT-archived, the marker every read path already filters
-- on. Idempotent: re-running adds no column, changes no template, and inserts nothing. No
-- securities data (firewall §4.1).

-- ── 1. Consent evidence carries its own booking reference ─────────────────────────
-- TCPA/A2P evidence for a booking opt-in must be reconstructible on its own: WHO consented,
-- WHEN, on WHAT number, to WHICH disclosure — and to which BOOKING. `referral_id` already
-- links an intake-form consent to the lead it came from; these are the same linkage for the
-- booking surface, so an appointment SMS dispute resolves from one row instead of a join
-- through audit_log. Nullable + `on delete set null`: a consent record is evidence and must
-- OUTLIVE the appointment it was captured at, so deleting an appointment must never delete
-- (or orphan-block) the proof that consent was given.
alter table comm_contact_consents
  add column if not exists appointment_id uuid references appointments(id) on delete set null,
  add column if not exists contact_id     uuid references contacts(id)     on delete set null;

comment on column comm_contact_consents.appointment_id is
  'The appointment this consent was captured at (public booking flow). NULL for consent captured anywhere else (intake form, portal, bulk grant). Evidence linkage only — never a send-path input.';
comment on column comm_contact_consents.contact_id is
  'The spine contact resolved at capture time. Lets a consent record be shown on the Contact 360 without re-resolving the phone. NULL when no contact was resolved.';

create index if not exists idx_ccc_appointment on comm_contact_consents (appointment_id)
  where appointment_id is not null;
create index if not exists idx_ccc_contact_id on comm_contact_consents (contact_id)
  where contact_id is not null;

-- ── 2. The delivery ledger records WHY a leg was withheld ─────────────────────────
-- The ledger's `status` column already allows 'blocked', but nothing wrote it: a withheld leg
-- deleted its claim so a later tick would retry. That is right for a self-clearing HOLD (the
-- A2P flag flips, the frequency day rolls over) and wrong for a TERMINAL verdict — a booker
-- who never gave SMS consent re-claimed, re-evaluated the gate and wrote a fresh blocked
-- comm_messages row on every 15-minute tick for the whole reminder window. Recording the
-- terminal verdict on the ledger instead makes the leg fire-once in BOTH directions, and turns
-- "no SMS was sent, and here is exactly why" into a queryable fact per appointment.
alter table booking_notification_deliveries
  add column if not exists block_reason text;

comment on column booking_notification_deliveries.block_reason is
  'Why this leg was terminally withheld (gate step or pre-gate reason, e.g. consent / dnc / no_phone). Set only with status=''blocked''; NULL for a sent leg. A self-clearing deferral deletes its claim instead, so it can be retried.';

-- ── 3. The six APPROVED booking lifecycle SMS templates ───────────────────────────
-- source_key MUST equal notify-events.ts sourceKeyFor(event,'sms'); body MUST equal the
-- authored string in src/lib/booking/sms-templates.ts byte for byte (render_sha proves it).
-- Every body leads with {{agency_name}} (sender identity, a blocking merge token), carries
-- STOP inline (so messaging.ts does not append a second opt-out footer), and is transactional
-- appointment content only — no product nudge, cross-sell or referral ask, which would make
-- it marketing needing separate consent (§4.2 / twilio-a2p-compliance). Every body is GSM-7:
-- one non-GSM character (an em dash) would switch the message to UCS-2 and cut the per-segment
-- budget from 153 characters to 67, so a 3-segment reminder would bill as 5.
--
-- ADOPT-THEN-INSERT, not a plain INSERT. `comm_templates.source_key` has NO unique constraint,
-- and `scripts/build-sms-templates.ts` may already have been run against this database — which
-- would have created six DRAFT rows with random ids. A plain `on conflict (id) do nothing`
-- would then leave TWO live rows per source_key: sends would still be correct (the draft is not
-- approved, so loadApprovedTemplate skips it), but the build script's own
-- `.eq('source_key', …).is('archived_at', null).maybeSingle()` lookup would start erroring on
-- multiple rows, and the approval console would show duplicates. So: archive any surplus live
-- rows, adopt the surviving one in place, and insert only where nothing lives yet.
with authored (source_key, name, body, render_sha) as (
  values
    ('appointment-confirmation-sms', 'Appointment confirmation (SMS)',
     '{{agency_name}}: You''re confirmed for {{appointment_time}}. Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out, HELP for help.',
     '13796433abc491cc2c3d67697c4d97903d074dd6960497236139521181a279e8'),
    ('appointment-reminder-sms', 'Appointment reminder (SMS)',
     '{{agency_name}}: Reminder - your appointment is {{appointment_time}}. Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out.',
     '90abe988d0206b06043a7f80d8cfbefba37a169d447c7a317d6368aa68df8f75'),
    ('appointment-rescheduled-sms', 'Appointment rescheduled (SMS)',
     '{{agency_name}}: Your appointment has been moved to {{appointment_time}}. Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out.',
     'a17c629c43d1c1acf5623c8c0266909914284ae02e504b88bb928a05382408e9'),
    ('appointment-cancellation-sms', 'Appointment cancellation (SMS)',
     '{{agency_name}}: Your appointment for {{appointment_time}} has been cancelled. Rebook anytime: {{scheduling_link}} Reply STOP to opt out.',
     'ef2c6c9afde80a0da5a988a0eefe9135dea7c680334cdc190196cd6c25c2e24d'),
    ('appointment-noshow-sms', 'No-show follow-up (SMS)',
     '{{agency_name}}: Sorry we missed you for your appointment on {{appointment_time}}. Rebook anytime: {{scheduling_link}} Reply STOP to opt out.',
     '37ca183f574fd53136dbdaf0790922d5398483e1829d4ef4ab4a4c7ecf1cdf23'),
    ('appointment-recap-sms', 'Appointment recap / thank-you (SMS)',
     '{{agency_name}}: Thanks for meeting with us today, {{first_name}}. Questions? Just reply. Reply STOP to opt out.',
     'f33a1f9ebe2d43048cc0ea2b1ca5a609904d36b0c0905ce4b964a0692d47bafd')
)

-- 3a. Archive surplus live rows, keeping the newest per source_key. Soft (archived_at), never a
--     delete: an earlier draft is history the approval console should keep showing.
, ranked as (
  select t.id, row_number() over (partition by t.source_key order by t.version desc, t.created_at desc) as rn
  from comm_templates t
  join authored a on a.source_key = t.source_key
  where t.archived_at is null
)
, archived as (
  update comm_templates set archived_at = now(), updated_by = 'migration:135_booking_sms_appointment_notices'
  where id in (select id from ranked where rn > 1)
  returning id
)

-- 3b. Adopt the surviving live row in place: same bytes, approved. Re-running is a no-op (the
--     body already matches, so the version-history trigger's WHEN clause does not even fire).
, adopted as (
  update comm_templates t
  set name = a.name, channel = 'sms', category = 'appointment', body = a.body, render_sha = a.render_sha,
      approval_status = 'approved', approved_at = coalesce(t.approved_at, now()),
      approved_by = 'migration:135_booking_sms_appointment_notices',
      updated_by = 'migration:135_booking_sms_appointment_notices', updated_at = now()
  from authored a
  where t.source_key = a.source_key
    and t.archived_at is null
    and t.id not in (select id from ranked where rn > 1)
    and (t.body is distinct from a.body or t.approval_status is distinct from 'approved' or t.render_sha is distinct from a.render_sha)
  returning t.source_key
)

-- 3c. Insert only the source_keys that have no live row at all (the ordinary first-deploy case).
insert into comm_templates (name, channel, category, body, render_sha, source_key,
                            approval_status, version, approved_at, approved_by, updated_by)
select a.name, 'sms', 'appointment', a.body, a.render_sha, a.source_key,
       'approved', 1, now(),
       'migration:135_booking_sms_appointment_notices', 'migration:135_booking_sms_appointment_notices'
from authored a
where not exists (
  select 1 from comm_templates t where t.source_key = a.source_key and t.archived_at is null
);

-- Rollback:
--   update comm_templates set approval_status = 'draft', approved_at = null, approved_by = null
--    where source_key like 'appointment-%-sms';
--   alter table comm_contact_consents drop column if exists appointment_id;
--   alter table comm_contact_consents drop column if exists contact_id;
