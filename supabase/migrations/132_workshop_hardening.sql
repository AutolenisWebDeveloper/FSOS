-- 132_workshop_hardening.sql
-- Batch 7 (owner-approved shrunk scope + checkpoint rulings).
--
--   ACK HANDLE   Reverse the migration-seeded approval on the instant-ack gate handle
--                (owner ruling): a migration writing 'approved' with no approver, no
--                timestamp and no copy version is the WS-047 audit-trail defect in a
--                migration. The handle moves to 'submitted' — the FFS review queue —
--                with explicit provenance. Until the firm's principal approves it (a
--                DATA change, recorded by that workflow), gate step 4 blocks the
--                registration receipt; deploy is deferred, and the go-live checklist
--                carries this item FIRST for exactly that reason.
--   D-2 ADD      opportunities.source — the queryable origin marker so district
--                reporting can segment workshop-attendance placements from conversion
--                and cross-sell opportunities sitting in the same native stage.
--   WS-039       workshop_attendance.capture_method gains 'derived' (the nurture pass
--                derives durable no_show rows for ended sessions).
--   WALK-IN RULE workshop_registrations gains the structural consent-capture rule:
--                marketing_opt_in can be TRUE only alongside a capture record
--                (consent_captured_at + consent_form_version). Every creation path
--                already complies (the claim RPC leaves the column at its FALSE
--                default; the public route and the walk-in sheet stamp all three
--                together); the CHECK makes "no path sets it true without a capture
--                record" a database fact rather than a convention.
--
-- ADDITIVE + idempotent.

-- ── 1. Instant-ack gate handle → the FFS queue (owner ruling; reverses 131 §3) ──
-- Guarded TWO ways. The PROVENANCE-marker check makes the migration idempotent, but it
-- does NOT protect a later approval: an approval REMOVES the marker, so on a chain replay
-- the marker test passes and the row is reverted — proven by rehearsal (approved/v3 →
-- submitted/v3), which silently stops the registration receipt with no error anywhere.
-- `approved_by is null` is the guard that actually holds: this migration exists to reverse
-- migration 131's SEEDED approval, which had no approver (the WS-047 defect), and a
-- principal approval always stamps one.
update comm_templates
set approval_status = 'submitted',
    name = 'Workshop registration instant acknowledgment (gate handle — awaiting FFS approval)',
    body = 'PROVENANCE: pre-existing production receipt copy (register route transactional ack), brought under sendThroughGate by Gate-1 decision D-8 — NOT principal-approved. Copy: heading "You''re registered", event details rows (workshop / when / where), educational-event note, .ics calendar attachment; rendered by the route (notifications/transactional renderer). FIRST item in the FFS approval queue: until a firm principal approves this copy (data change recorded by the approval workflow), gate step 4 blocks the registration receipt — which is a DEPLOY BLOCKER noted on the go-live checklist.',
    updated_at = now()
where id = 'eeee0000-0000-4000-8000-00000000ac01'
  and body not like 'PROVENANCE:%'
  and approved_by is null;

-- ── 2. D-2: queryable origin marker for pipeline segmentation ──────────────────
alter table opportunities
  add column if not exists source text;
comment on column opportunities.source is
  'Origin marker for reporting segmentation (e.g. workshop_attendance). Null = manually originated / pre-existing.';
create index if not exists idx_opportunities_source
  on opportunities(source) where source is not null;

-- ── 3. WS-039: 'derived' capture method ────────────────────────────────────────
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'workshop_attendance'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%capture_method%';
  if v_con is not null then
    execute format('alter table workshop_attendance drop constraint %I', v_con);
  end if;
  alter table workshop_attendance add constraint watt_capture_method_chk
    check (capture_method in ('checkin','webhook','manual','derived'));
end $$;

-- ── 4. Walk-in / non-public-form rule: TRUE requires a capture record ──────────
-- Normalize first (129's backfill already stamped every row; belt-and-braces for any
-- row that predates it or arrived sideways), then pin the rule.
update workshop_registrations
set consent_captured_at = coalesce(consent_captured_at, registered_at, now()),
    consent_form_version = coalesce(consent_form_version, 'legacy-v1')
where marketing_opt_in = true
  and (consent_captured_at is null or consent_form_version is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wreg_marketing_capture_chk') then
    alter table workshop_registrations add constraint wreg_marketing_capture_chk
      check (marketing_opt_in = false or (consent_captured_at is not null and consent_form_version is not null));
  end if;
end $$;
