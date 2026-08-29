-- 130_workshop_lifecycle.sql
-- Batch 4 (Gate 1 approval): lifecycle integrity + change-comms plumbing.
--
--   WS-070a  workshops.status was free text — add the CHECK the code already assumes.
--   WS-066   workshop_message_log.kind had NO constraint — pin the full cadence
--            vocabulary (including the D-1(b) kinds Batch 5 activates and the Batch 4
--            change kinds) so a typo'd kind can never silently occupy a claim slot.
--   WS-070b  cancelled/completed are TERMINAL: re-openable only by an explicit reopen
--            to 'draft', and reopening voids the standing compliance-approval pointer
--            so publishing again re-runs the real gate (fresh approval — FINRA 2210).
--   WS-008   any workshop cancellation cascades its scheduled sessions to 'cancelled'
--            (AFTER trigger), which is the signal the engine's change pass turns into
--            event_cancelled notices. Route-independent: a direct SQL cancel behaves.
--   (gap)    the 038 publish gate fired on UPDATE only — a direct INSERT with
--            status='published' bypassed it. Re-created BEFORE INSERT OR UPDATE.
--   WS-029   the send-once claim key (registration_id, channel, kind) could never
--            re-arm after a reschedule. Claims now carry cadence_generation: bumping
--            the session's generation re-arms exactly the re-armable kinds; one-time
--            kinds (confirmation, nurture, cancel_ack) claim at generation 0 forever.
--   WS-007/009  session change columns (change_kind, change_recorded_at) + the
--            registrant cancel timestamp. New template kinds seeded as PLACEHOLDERS
--            (D-5: drafts only; FFS approval is a data change; nothing can send).
--
-- ADDITIVE + idempotent. Seat counting and the duplicate guard already exclude
-- status='cancelled' (mig 128), so a registrant cancel frees the seat and permits
-- re-registration with no changes here.

-- ── 1. WS-070a: workshops.status CHECK ─────────────────────────────────────────
-- Normalize any stray legacy value to 'draft' first (unrecognized = never publishable),
-- then pin the six-state lifecycle the routes/trigger already implement.
update workshops
set status = 'draft'
where status not in ('draft','pending_review','compliance_approved','published','completed','cancelled');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshops_status_chk') then
    alter table workshops add constraint workshops_status_chk
      check (status in ('draft','pending_review','compliance_approved','published','completed','cancelled'));
  end if;
end $$;

-- ── 2. WS-066: the full message-kind vocabulary, pinned on BOTH tables ─────────
-- Includes the Batch 4 change kinds and the D-1(b) cadence kinds Batch 5 activates
-- (reminder_3d, reminder_day_of, nurture_followup) so the constraint is written once.
do $$
declare
  v_con text;
begin
  -- Widen the template-table CHECK (created inline in 040 with the old set).
  select conname into v_con
  from pg_constraint
  where conrelid = 'workshop_message_templates'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%';
  if v_con is not null then
    execute format('alter table workshop_message_templates drop constraint %I', v_con);
  end if;
  alter table workshop_message_templates add constraint wmt_kind_chk check (kind in (
    'confirmation',
    'reminder_7d','reminder_3d','reminder_1d','reminder_day_of','reminder_1h','reminder_starting',
    'change_reschedule','change_venue','event_cancelled','cancel_ack',
    'nurture_attended','nurture_left_early','nurture_no_show','nurture_registered_no_show',
    'nurture_followup'));
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wml_kind_chk') then
    alter table workshop_message_log add constraint wml_kind_chk check (kind in (
      'confirmation',
      'reminder_7d','reminder_3d','reminder_1d','reminder_day_of','reminder_1h','reminder_starting',
      'change_reschedule','change_venue','event_cancelled','cancel_ack',
      'nurture_attended','nurture_left_early','nurture_no_show','nurture_registered_no_show',
      'nurture_followup'));
  end if;
end $$;

-- ── 3. WS-029: generation-scoped claims (the re-arm key) ───────────────────────
-- Sessions carry a cadence generation, bumped by a material reschedule/venue change.
-- The pending change the engine's change pass must announce lives on the session
-- (change_kind + change_recorded_at); registrants who signed up AFTER the change was
-- recorded already saw the new details and are excluded by the pass.
alter table workshop_sessions
  add column if not exists cadence_generation integer not null default 1;
alter table workshop_sessions
  add column if not exists change_kind text
    check (change_kind is null or change_kind in ('change_reschedule','change_venue'));
alter table workshop_sessions
  add column if not exists change_recorded_at timestamptz;

alter table workshop_message_log
  add column if not exists cadence_generation integer not null default 1;

-- One-time kinds claim at generation 0 FOREVER (a reschedule must not re-send a
-- confirmation or a nurture message). Backfill existing rows before the key swap so a
-- deployed system cannot double-send them.
update workshop_message_log
set cadence_generation = 0
where kind in ('confirmation','cancel_ack',
               'nurture_attended','nurture_left_early','nurture_no_show',
               'nurture_registered_no_show','nurture_followup');

-- New 4-part claim key first, then retire the 3-part original (which would otherwise
-- forbid the re-armed second claim). Ordered so there is no window without a key.
create unique index if not exists idx_wml_claim
  on workshop_message_log(registration_id, channel, kind, cadence_generation);

do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'workshop_message_log'::regclass
    and contype = 'u'
    and array_length(conkey, 1) = 3;
  if v_con is not null then
    execute format('alter table workshop_message_log drop constraint %I', v_con);
  end if;
end $$;

-- ── 4. WS-009: registrant-cancel timestamp ─────────────────────────────────────
alter table workshop_registrations
  add column if not exists cancelled_at timestamptz;

-- ── 5. Publish gate: BEFORE INSERT OR UPDATE (closes the INSERT bypass) ────────
create or replace function enforce_workshop_publish_gate()
returns trigger language plpgsql as $$
declare
  approved_ok boolean;
  disclosure_ok boolean;
begin
  if new.status = 'published' then
    -- Not a transition when an UPDATE row was already published.
    if TG_OP = 'UPDATE' and old.status = 'published' then
      return new;
    end if;
    approved_ok := exists (
      select 1 from workshop_approvals a
      where a.id = new.compliance_approval_ref and a.decision = 'approved'
    );
    disclosure_ok := exists (
      select 1 from workshop_disclosure_configs d
      where d.id = new.disclosure_config_id and d.is_assumption = false and d.approved_by is not null
    );
    if not approved_ok then
      raise exception 'workshop % cannot publish: no approved compliance approval (compliance_approval_ref)', new.workshop_id;
    end if;
    if not disclosure_ok then
      raise exception 'workshop % cannot publish: no approved disclosure config (disclosure_config_id)', new.workshop_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_workshop_publish_gate on workshops;
create trigger trg_workshop_publish_gate
  before insert or update on workshops
  for each row execute function enforce_workshop_publish_gate();

-- ── 6. WS-070b: terminal states + the explicit reopen path ─────────────────────
-- cancelled/completed may transition ONLY to 'draft' (the reopen). Reopening voids the
-- workshop's compliance_approval_ref so the publish gate re-runs against a FRESH
-- approval (the approval row itself is history and is never deleted). Everything else
-- out of a terminal state raises.
create or replace function enforce_workshop_terminality()
returns trigger language plpgsql as $$
begin
  if old.status in ('cancelled','completed') and new.status is distinct from old.status then
    if new.status <> 'draft' then
      raise exception 'workshop % is % (terminal): reopen it to draft first — republishing requires fresh compliance approval', old.workshop_id, old.status;
    end if;
    new.compliance_approval_ref := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_workshop_terminality on workshops;
create trigger trg_workshop_terminality
  before update on workshops
  for each row execute function enforce_workshop_terminality();

-- ── 7. WS-008: workshop cancellation cascades to its scheduled sessions ────────
-- The engine's change pass keys event_cancelled notices off SESSION status, so the
-- cascade makes every cancel path (route or direct SQL) produce the same signal.
-- 'live'/'completed' sessions are left alone (the event happened or is happening).
create or replace function cascade_workshop_cancel()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update workshop_sessions
    set status = 'cancelled', updated_at = now()
    where workshop_id = new.workshop_id and status = 'scheduled';
  end if;
  return null;
end $$;

drop trigger if exists trg_workshop_cancel_cascade on workshops;
create trigger trg_workshop_cancel_cascade
  after update on workshops
  for each row execute function cascade_workshop_cancel();

-- ── 8. D-5 placeholder seeds for the new kinds (drafts; can never send) ────────
-- status='placeholder', active=false, no comm_template handle, no disclosure binding —
-- invisible to the engine's sendable-template selector until FFS approval activates
-- them as a DATA change. SMS bodies note the auto-appended STOP footer.
insert into workshop_message_templates (kind, channel, subject, body) values
  ('change_reschedule','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Reschedule notice copy: the workshop a registrant signed up for moved. Tokens: {{name}} {{workshop_title}} {{starts_local}} {{venue}} {{join_url}} {{cancel_url}}. Do not activate with this placeholder.'),
  ('change_reschedule','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Reschedule notice SMS. Tokens: {{workshop_title}} {{starts_local}} {{cancel_url}}. STOP footer auto-appended by the dispatcher. Do not activate with this placeholder.'),
  ('change_venue','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Venue-change notice copy (time unchanged). Tokens: {{name}} {{workshop_title}} {{starts_local}} {{venue}} {{cancel_url}}. Do not activate with this placeholder.'),
  ('change_venue','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Venue-change notice SMS. Tokens: {{workshop_title}} {{venue}} {{cancel_url}}. STOP footer auto-appended. Do not activate with this placeholder.'),
  ('event_cancelled','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Event-cancellation notice copy. Tokens: {{name}} {{workshop_title}} {{starts_local}}. Do not activate with this placeholder.'),
  ('event_cancelled','sms',null,
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Event-cancellation notice SMS. Tokens: {{workshop_title}} {{starts_local}}. STOP footer auto-appended. Do not activate with this placeholder.'),
  ('cancel_ack','email','[PLACEHOLDER - approved subject]',
   '[PLACEHOLDER - REQUIRES OWNER/PRINCIPAL APPROVAL] Registration-cancelled acknowledgment copy (the registrant cancelled; confirm + door stays open). Tokens: {{name}} {{workshop_title}}. Do not activate with this placeholder.')
  on conflict (kind, channel, version) do nothing;
