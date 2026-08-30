-- 131_workshop_cadence.sql
-- Batch 5 (Gate 1 decisions D-1(b) + D-8): cadence completion.
--
--   D-1(b) MODE-AWARE CADENCE: 7d email · 3d email+SMS · 1d email+SMS · day-of-AM SMS ·
--   starting SMS (virtual/hybrid only). The T-2h touch is dropped; the 1h mapping stays
--   code-side CAPABILITY only (not in defaults). Day-of-AM is a WALL-CLOCK kind computed
--   per tick in the session's venue zone (engine); it is not an offset.
--
--   D-8: the ENGINE 'confirmation' kind is deleted from the cadence — the register
--   route's instant transactional acknowledgment is the single confirmation of record,
--   now routed through sendThroughGate with the .ics attached (WS-022). The
--   comm_templates row seeded below is that ack's GATE HANDLE (the 040 pattern: body
--   copy lives with the sender, the approval handle satisfies gate step 4). It is
--   seeded APPROVED deliberately: this is the PRE-EXISTING live transactional receipt
--   (register route, in production since P1) being brought UNDER the gate — not a new
--   campaign kind. All genuinely NEW kinds below remain unapproved placeholders (D-5).
--
-- ADDITIVE + idempotent.

-- ── 1. Config: D-1(b) default offsets + the T+2/3d follow-up delay ─────────────
alter table workshop_comms_config
  add column if not exists nurture_followup_delay_minutes integer not null default 2880;

alter table workshop_comms_config
  alter column reminder_offsets_minutes set default '{10080, 4320, 1440, 0}';

-- Move a config row still carrying the OLD shipped default onto the D-1(b) cadence.
-- An operator-edited offset set is left untouched.
update workshop_comms_config
set reminder_offsets_minutes = '{10080, 4320, 1440, 0}'
where id = 'global' and reminder_offsets_minutes = '{10080, 1440, 60}';

-- ── 2. Placeholder template seeds for the D-1(b) kinds (drafts; can never send) ─
insert into workshop_message_templates (kind, channel, subject, body) values
  ('reminder_3d','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 3-day reminder copy (agenda + logistics). Tokens: {{name}} {{workshop_title}} {{starts_local}} {{venue}} {{join_url}} {{ics_url}} {{cancel_url}}. Do not activate with this placeholder.'),
  ('reminder_3d','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 3-day SMS reminder copy. Tokens: {{name}} {{starts_local}} {{cancel_url}}. Opt-out footer auto-appended by the dispatcher. Do not activate with this placeholder.'),
  ('reminder_day_of','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Day-of morning SMS copy (fires 9:00 AM venue time; the dispatcher still defers outside the RECIPIENT''s 9-20 window). Tokens: {{name}} {{starts_local}} {{venue}} {{join_url}}. Do not activate with this placeholder.'),
  ('nurture_followup','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] T+2/3d follow-up copy (recap + consult INVITE, no recommendation). Tokens: {{name}} {{workshop_title}} {{consult_url}} {{replay_url}}. Do not activate with this placeholder.'),
  ('nurture_followup','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] T+2/3d follow-up SMS. Tokens: {{name}} {{consult_url}}. Opt-out footer auto-appended. Do not activate with this placeholder.')
  on conflict (kind, channel, version) do nothing;

-- ── 3. The instant-ack GATE HANDLE (D-8) ───────────────────────────────────────
-- Approval provenance: this is the live production receipt copy (register route),
-- unchanged; the row exists so the EXISTING send now clears gate step 4 while gaining
-- DNC/suppression enforcement. The rendered body remains route-owned (040 pattern).
insert into comm_templates (id, name, channel, body, approval_status)
values (
  'eeee0000-0000-4000-8000-00000000ac01',
  'Workshop registration instant acknowledgment (gate handle)',
  'email',
  'Gate handle for the register route''s transactional receipt: heading "You''re registered", event details rows (workshop / when / where), educational-event note, .ics calendar attachment. Copy is rendered by the route (notifications/transactional renderer) — pre-existing live production content.',
  'approved')
on conflict (id) do nothing;
