-- 040_workshop_comms_engine.sql
-- P2 of the Workshop/Seminar lead engine (docs/specs/workshops-seminar-design-spec.md
-- §2.3, §2.4, §7, §9-P2): the FSOS-side pre-event REMINDER engine + segmented post-event
-- NURTURE engine. ADDITIVE ONLY. No drops, no destructive alters. Extends the P0/P1 spine
-- (018 + 038 + 039). Every automated send still runs through the existing dispatcher/gate
-- (src/lib/comms/*) — this migration adds only the templates, the config defaults, and the
-- idempotency send-log the engine needs. It sends NOTHING on its own.
--
-- GUARDRAILS honored here:
--  - Guardrail 1 (securities firewall): NO securities account/order/suitability columns.
--    is_security workshops are excluded from the engine in the selection query AND at the
--    send gate (step 6); their registrants route to the FFS-supervised path. Nothing here
--    changes that — no column, table, or seed references securities data.
--  - Guardrail 2.2 (green-zone): templates are transactional reminders + green-zone nurture
--    (thank-you / re-engage / consult INVITE). No template body makes an individualized
--    product/investment recommendation; the gate's recommendation check (step 5) is the
--    backstop. Placeholder bodies carry NO marketing/disclosure copy (that is REQUIRES-
--    APPROVAL and cannot be authored by the app — guardrail 3).
--  - Guardrail 3 (no invented Farmers data): reminder OFFSETS, lead-score DELTAS, the
--    sender physical address, and the replay window are shipped as CONFIG DEFAULTS with
--    is_assumption = true (assumption-badged, editable). Message templates seed as
--    PLACEHOLDERS (is_assumption = true, status = 'placeholder') and CANNOT activate until
--    approved copy + an approved disclosure config are attached — mirrors the 038 publish
--    gate + gdc_tiers (016) pattern.
--  - Guardrail 4 (audit): every mutation the engine performs is audited in the API/engine
--    layer (not here).
--
-- RLS: default-deny on every new table; internal-staff/compliance read per role; writes run
-- through the service role after an rbac assertion in the route/cron (getDb bypasses RLS).
-- NO anon grant anywhere. The public register route never reads these tables.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every terminator in
-- this file is a real one (safe for naive SQL splitters), matching the 038/039 convention.

-- ===========================================================================
-- 1. workshop_comms_config: the single, editable, assumption-badged config row for
--    the reminder cadence + post-event lead-score deltas + CAN-SPAM sender identity +
--    the post-event nurture trigger delay. Singleton (id = 'global'). Every value is a
--    CONFIG DEFAULT (is_assumption = true) — a planning choice, never a Farmers-published
--    fact (guardrail 3). The engine reads this at run time; the UI renders the gold
--    "config default — verify" badge.
-- ===========================================================================
create table if not exists workshop_comms_config (
  id                       text primary key default 'global',
  -- Pre-event reminder offsets in MINUTES-BEFORE session start (the reminder_* stages).
  -- Task P2 default set: 7d (10080) + 1d (1440) + 1h (60). Editable — a workshop booked
  -- <7d out simply has no due 7d reminder (the registrant registered after that fire-time,
  -- so the engine never schedules it — spec §2.3 "skip if booked <7d out"). The optional
  -- "starting now" stage is offset 0; add it here to enable it. Confirmation is NOT an
  -- offset — it fires on registration (see confirmation_enabled).
  reminder_offsets_minutes integer[] not null default '{10080, 1440, 60}',
  -- Confirmation (immediate on registration) is a distinct stage, always-on by default.
  confirmation_enabled     boolean not null default true,
  -- Post-event nurture fires this many minutes AFTER session end (or start when end is
  -- unknown). Spec §2.4: ~2–4h. Default 180 (3h).
  nurture_delay_minutes    integer not null default 180,
  -- Lead-score deltas pushed to GHL lead_score by the post-event nurture (spec §7). Signed.
  score_attended           integer not null default 15,
  score_engaged            integer not null default 25,
  score_no_show            integer not null default -5,
  score_registered_no_show integer not null default -2,
  score_replay_viewed      integer not null default 10,
  -- CAN-SPAM commercial-email identity. Physical address is business data, NOT a Farmers
  -- fact — ship as a clearly-marked placeholder until the FSA supplies the real address.
  sender_physical_address  text not null default '[PLACEHOLDER - set the FSA business mailing address before enabling commercial workshop email]',
  -- Finite replay window default (spec §9-P3 uses it; stored here so P3 reuses the config).
  replay_window_days       integer not null default 14,
  is_assumption            boolean not null default true,
  enabled                  boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

insert into workshop_comms_config (id) values ('global') on conflict (id) do nothing;

-- ===========================================================================
-- 2. workshop_message_templates: versioned reminder/nurture message records, tied to an
--    approved disclosure config. Seeded as PLACEHOLDERS (status = 'placeholder',
--    is_assumption = true) so the engine can never send real copy that was not approved.
--
--    A template becomes SENDABLE only when ALL hold (enforced in code + the partial index
--    below + the gate):
--      (a) status = 'approved' AND active = true,
--      (b) comm_template_id points at an APPROVED comm_templates row (gate step 4 handle),
--      (c) for SMS: disclosure_config_id points at an APPROVED (is_assumption=false)
--          workshop_disclosure_configs row.
--    Placeholder rows fail (a)+(b), so the engine skips them and — even if forced — the
--    dispatcher's approved-template gate (step 4) blocks the send. Defense in depth.
--
--    body is the source-of-truth copy for the approval record; the actual gate approval
--    lives on the referenced comm_templates row (so the existing send-time gate is reused
--    unchanged). subject applies to email only.
-- ===========================================================================
create table if not exists workshop_message_templates (
  id                  uuid primary key default gen_random_uuid(),
  -- The moment in the cadence this template serves.
  kind                text not null check (kind in (
                        'confirmation',
                        'reminder_7d','reminder_1d','reminder_1h','reminder_starting',
                        'nurture_attended','nurture_left_early','nurture_no_show',
                        'nurture_registered_no_show')),
  channel             text not null check (channel in ('sms','email')),
  subject             text,
  body                text not null,
  -- Approved disclosure this template is bound to (REQUIRES-APPROVAL to be non-placeholder).
  disclosure_config_id uuid references workshop_disclosure_configs(id) on delete set null,
  -- The gate handle: an approved comm_templates row satisfies gate step 4 at send time.
  comm_template_id     uuid references comm_templates(id) on delete set null,
  status              text not null default 'placeholder'
                        check (status in ('placeholder','draft','approved')),
  is_assumption       boolean not null default true,
  active              boolean not null default false,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (kind, channel, version)
);
create index if not exists idx_wmt_kind_channel on workshop_message_templates(kind, channel);
-- Partial index over the SENDABLE set only (approved + active + gate handle present). The
-- engine selects from this shape; a placeholder/draft row is invisible to it.
create index if not exists idx_wmt_sendable on workshop_message_templates(kind, channel)
  where status = 'approved' and active = true and comm_template_id is not null;

-- Placeholder seeds — CLEARLY MARKED, status = 'placeholder', active = false, no gate
-- handle, no disclosure binding. These give the UI a row to show per (kind, channel) but
-- the engine can never send them. Bodies contain NO marketing/disclosure copy (that is
-- REQUIRES-APPROVAL). One email row per stage; SMS only for the stages the cadence uses
-- SMS on (spec §2.3): 1d, 1h, starting, and the three nurture segments.
insert into workshop_message_templates (kind, channel, subject, body) values
  ('confirmation','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Registration confirmation copy. Merge tokens available: {{name}} {{workshop_title}} {{starts_local}} {{join_url}} {{venue}} {{ics_url}} {{confirmed_url}}. Educational event; no product recommendation. Do not activate with this placeholder.'),
  ('reminder_7d','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 7-day value/agenda reminder copy. Tokens: {{name}} {{workshop_title}} {{starts_local}} {{join_url}} {{venue}} {{ics_url}}. Do not activate with this placeholder.'),
  ('reminder_1d','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 1-day logistics reminder copy (prominent join link). Tokens: {{name}} {{workshop_title}} {{starts_local}} {{join_url}} {{venue}} {{ics_url}}. Do not activate with this placeholder.'),
  ('reminder_1d','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 1-day SMS reminder copy. Tokens: {{name}} {{starts_local}} {{join_url}}. STOP/opt-out footer is auto-appended by the dispatcher. Do not activate with this placeholder.'),
  ('reminder_1h','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 1-hour reminder copy. Tokens: {{name}} {{starts_local}} {{join_url}}. Do not activate with this placeholder.'),
  ('reminder_1h','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] 1-hour SMS reminder copy (one CTA, one link). Tokens: {{name}} {{starts_local}} {{join_url}}. Do not activate with this placeholder.'),
  ('reminder_starting','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] "Starting now" SMS copy. Tokens: {{join_url}}. Quiet-hours law still applies at the gate. Do not activate with this placeholder.'),
  ('nurture_attended','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Attended thank-you + book-a-consult INVITE copy (no recommendation). Tokens: {{name}} {{workshop_title}} {{consult_url}} {{replay_url}}. Do not activate with this placeholder.'),
  ('nurture_attended','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Attended thank-you SMS + consult invite. Tokens: {{name}} {{consult_url}}. Do not activate with this placeholder.'),
  ('nurture_left_early','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Left-early "what you missed" + replay copy. Tokens: {{name}} {{replay_url}} {{consult_url}}. Do not activate with this placeholder.'),
  ('nurture_no_show','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] No-show "sorry we missed you" + re-engage + consult INVITE copy. Tokens: {{name}} {{workshop_title}} {{replay_url}} {{consult_url}}. Do not activate with this placeholder.'),
  ('nurture_no_show','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] No-show re-engage SMS. Tokens: {{name}} {{replay_url}}. Do not activate with this placeholder.'),
  ('nurture_registered_no_show','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Registered-never-checked-in recapture copy. Tokens: {{name}} {{workshop_title}} {{replay_url}} {{consult_url}}. Do not activate with this placeholder.')
  on conflict (kind, channel, version) do nothing;

-- ===========================================================================
-- 3. workshop_message_log: the IDEMPOTENCY send-log. One row per
--    (registration_id, channel, kind) — the UNIQUE key is what prevents a double-send
--    across overlapping cron ticks and retries (task P2: "a send-log row per
--    registration+channel+offset; never double-send"). The engine CLAIMS a row before
--    dispatch; a conflicting insert on a second tick means "already handled" → skip. A
--    'deferred' row (quiet-hours / business-hours hold) is the ONLY status the engine
--    re-attempts on a later tick. 'sent' and 'blocked' are terminal.
-- ===========================================================================
create table if not exists workshop_message_log (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references workshop_registrations(reg_id) on delete cascade,
  session_id       uuid references workshop_sessions(id) on delete set null,
  channel          text not null check (channel in ('sms','email')),
  -- Same value-set as workshop_message_templates.kind (the cadence moment / segment).
  kind             text not null,
  status           text not null default 'sending'
                     check (status in ('sending','sent','blocked','deferred','skipped')),
  -- The gate's blocking step when status = 'blocked'/'deferred' (consent/quiet_hours/…).
  gate_blocked_step text,
  reason           text,
  -- Link to the comm_messages row the dispatcher wrote (full history), when a send fired.
  comm_message_id  uuid,
  attempts         integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (registration_id, channel, kind)
);
create index if not exists idx_wml_reg on workshop_message_log(registration_id);
create index if not exists idx_wml_status on workshop_message_log(status);

-- ===========================================================================
-- 4. workshop_registrations: post-event nurture bookkeeping so the nurture pass is itself
--    idempotent at the segment level and records the score delta it pushed. (The per-send
--    idempotency is workshop_message_log; this marks that the SEGMENT routing ran.)
-- ===========================================================================
alter table workshop_registrations add column if not exists nurture_segment text;
alter table workshop_registrations add column if not exists nurtured_at timestamptz;
alter table workshop_registrations add column if not exists lead_score_delta integer;

-- ===========================================================================
-- 5. RLS — default-deny; staff/compliance read per role; writes via service role.
--    Mirrors the 038 policy shape exactly. NO anon grant. NO insert/update/delete policy
--    (all writes go through getDb / the service role after an rbac assertion in the
--    cron/route; getDb bypasses RLS).
-- ===========================================================================
alter table workshop_comms_config       enable row level security;
alter table workshop_message_templates  enable row level security;
alter table workshop_message_log         enable row level security;

drop policy if exists wcomms_config_staff_read on workshop_comms_config;
create policy wcomms_config_staff_read on workshop_comms_config for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

drop policy if exists wmt_staff_read on workshop_message_templates;
create policy wmt_staff_read on workshop_message_templates for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- Send-log holds comms metadata (no PII beyond FK) — restrict to compliance/fsa/super +
-- admin/ops for the ops dashboard, matching the attendance-read policy shape.
drop policy if exists wml_staff_read on workshop_message_log;
create policy wml_staff_read on workshop_message_log for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
