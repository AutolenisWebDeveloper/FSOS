-- 129_workshop_consent_model.sql
-- Batch 3 (Gate 1 approval — the SETTLED consent model + D-3(a) + D-6 + WS-020).
--
-- THE MODEL (owner directive, verbatim intent): consent is captured ONE TIME, on the
-- signup page. Registering IS consent for that workshop's reminders — no checkbox. One
-- unchecked box on the same form covers POST-EVENT MARKETING only. Both facts live on
-- the registration row; every downstream send just reads them. STOP/DNC and quiet hours
-- are NOT consent — they act on the phone number at dispatch (unchanged).
--
-- ADDITIVE ONLY. The backfill maps the legacy checkboxes faithfully: the old EMAIL box
-- read "Email me about this and future educational workshops" (a marketing grant); the
-- old SMS box was event-reminders-only (NOT a marketing grant).

-- ── 1. The two consent facts + capture evidence on the registration row (D-3.3) ─
alter table workshop_registrations
  add column if not exists marketing_opt_in boolean not null default false;
alter table workshop_registrations
  add column if not exists consent_captured_at timestamptz;
alter table workshop_registrations
  add column if not exists consent_form_version text;

-- Backfill: legacy email-box grant → marketing_opt_in; capture time = registration time.
update workshop_registrations
set marketing_opt_in = ('email' = any(coalesce(consent_channels, '{}'))),
    consent_captured_at = coalesce(consent_captured_at, registered_at),
    consent_form_version = coalesce(consent_form_version, 'legacy-v1')
where consent_form_version is null;

-- ── 2. Senior-focused flag + disclosure slot (D-6 — schema now, default false;
--       copy/activation is the FFS lead-time question, not code) ─────────────────
alter table workshops
  add column if not exists senior_focused boolean not null default false;
alter table workshops
  add column if not exists senior_disclosure_config_id uuid references workshop_disclosure_configs(id) on delete set null;

-- ── 3. WS-020: a workshop with registrations can no longer be hard-deleted ──────
-- The 001 FK cascaded: deleting a workshop deleted its registrations AND (via their
-- cascade) the TCPA consent-evidence rows — destroying the record of what a person
-- signed up for. RESTRICT makes the registration record durable; cancellation (status)
-- is the operational path. Evidence (workshop_consent_events, workshop_message_log)
-- still follows its registration, which is now protected.
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'workshop_registrations'::regclass
    and confrelid = 'workshops'::regclass
    and contype = 'f';
  if v_con is not null then
    execute format('alter table workshop_registrations drop constraint %I', v_con);
  end if;
  alter table workshop_registrations
    add constraint workshop_registrations_workshop_id_fkey
    foreign key (workshop_id) references workshops(workshop_id) on delete restrict;
end $$;
