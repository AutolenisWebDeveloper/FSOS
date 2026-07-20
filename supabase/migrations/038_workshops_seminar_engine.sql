-- 038_workshops_seminar_engine.sql
-- P0 of the Workshop/Seminar lead engine (docs/specs/workshops-seminar-design-spec.md).
-- ADDITIVE ONLY. Extends the existing workshops/workshop_registrations scaffold
-- (migrations 001 + 018) into a compliance-gated lead engine. No drops, no destructive
-- alters. Existing workshops keep their current status (default 'draft'); the current
-- /events render keeps working until the /workshops 301 lands.
--
-- GUARDRAILS honored here:
--  - Guardrail 1 (securities firewall): NO securities account/order/suitability columns.
--    is_security only FLAGS a workshop (auto-set when a third-party/fund presenter is
--    attached) so the automated comms engine can exclude it. Third-party marketing may
--    carry third-party trademarks -> flagged, never asserted as licensed.
--  - Guardrail 3 (no invented Farmers data): disclosure strings are versioned config
--    rows with is_assumption = true and seeded as clearly-marked placeholders. A workshop
--    cannot reach 'published' without referencing an APPROVED (is_assumption=false,
--    approved_by set) disclosure config AND an approved compliance approval row.
--  - Guardrail 4 (audit): every mutation is audited in the API routes (not here).
--
-- RLS: default-deny on every new table; internal-staff/compliance read per role; writes
-- run through the service role after an rbac assertion in the route (getDb bypasses RLS).
-- No anon RLS grant. consent-evidence + approvals read restricted to compliance/fsa/super.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every terminator in
-- this file is a real one (safe for naive SQL splitters), matching the 018 convention.

-- ===========================================================================
-- 1. workshops: delivery mode, slug, host, firewall flag, and the two publish
--    prerequisites (compliance approval + approved disclosure config).
-- ===========================================================================
alter table workshops add column if not exists slug text;
alter table workshops add column if not exists delivery_mode text not null default 'in_person';
alter table workshops add column if not exists host_name text;
alter table workshops add column if not exists is_security boolean not null default false;
alter table workshops add column if not exists agenda text;
alter table workshops add column if not exists hero_image_ref text;
alter table workshops add column if not exists compliance_approval_ref uuid;
alter table workshops add column if not exists disclosure_config_id uuid;

-- slug is the stable public key for /workshops/[slug]. Unique when present.
create unique index if not exists idx_workshops_slug on workshops(slug) where slug is not null;

-- delivery_mode is constrained via a NOT VALID check added additively (won't fail on
-- legacy rows; new writes are validated). Values: in_person | virtual | hybrid.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshops_delivery_mode_chk') then
    alter table workshops add constraint workshops_delivery_mode_chk
      check (delivery_mode in ('in_person','virtual','hybrid')) not valid;
  end if;
end $$;

-- status is a free-text column today (default 'draft'). We DO NOT add a hard CHECK (it
-- would risk legacy rows); the widened value set is enforced by the Zod layer + the
-- publish trigger below. Recognized values now:
--   draft | pending_review | compliance_approved | published | completed | cancelled

-- ===========================================================================
-- 2. workshop_disclosure_configs: versioned, approval-gated disclosure strings.
--    Seeded as PLACEHOLDERS (is_assumption = true) -> can never publish until an
--    approved version exists. Mirrors the gdc_tiers is_assumption pattern (016).
-- ===========================================================================
create table if not exists workshop_disclosure_configs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('sms','recording','seminar_advertising','educational','general')),
  version        integer not null default 1,
  body           text not null,
  is_assumption  boolean not null default true,   -- true = placeholder / unverified
  approved_by    text,                            -- e.g. "Ryan Anderson (FFS)"; NULL until approved
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (kind, version)
);
create index if not exists idx_disclosure_kind_approved on workshop_disclosure_configs(kind)
  where is_assumption = false;

-- Placeholder seeds — CLEARLY MARKED, is_assumption = true, no approver. These exist so
-- the UI has something to reference in draft, but the publish gate blocks them.
insert into workshop_disclosure_configs (kind, version, body, is_assumption) values
  ('sms', 1,
   '[PLACEHOLDER - REQUIRES RYAN ANDERSON (FFS) APPROVAL] SMS/A2P consent + opt-out disclosure text goes here. Do not publish with this placeholder.',
   true),
  ('recording', 1,
   '[PLACEHOLDER - REQUIRES RYAN ANDERSON (FFS) APPROVAL] Virtual-event recording-consent disclosure text goes here. Do not publish with this placeholder.',
   true),
  ('seminar_advertising', 1,
   '[PLACEHOLDER - REQUIRES RYAN ANDERSON (FFS) + TX legal APPROVAL] TDI seminar-advertising / "insurance sales presentation" equal-prominence disclosure goes here. Do not publish with this placeholder.',
   true),
  ('educational', 1,
   '[PLACEHOLDER - REQUIRES RYAN ANDERSON (FFS) APPROVAL] Educational-only disclosure (no product recommendation) goes here. Do not publish with this placeholder.',
   true)
  on conflict (kind, version) do nothing;

-- ===========================================================================
-- 3. presenters: REUSABLE across workshops (wholesaler / fund-family model). One
--    wholesaler or fund family can be attached to many workshops through the year.
--    No securities data. Third-party presenters flip the workshop's is_security flag
--    (handled in the authoring route) and are REQUIRES-APPROVAL for their materials.
-- ===========================================================================
create table if not exists presenters (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  title          text,
  firm           text,
  presenter_type text not null default 'internal'
                   check (presenter_type in ('internal','wholesaler','guest')),
  fund_family    text,
  is_third_party boolean not null default false,
  bio            text,
  headshot_ref   text,                            -- storage path in private 'documents' bucket
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_presenters_type on presenters(presenter_type);

-- workshop_presenters: many-to-many join with display order.
create table if not exists workshop_presenters (
  workshop_id    uuid not null references workshops(workshop_id) on delete cascade,
  presenter_id   uuid not null references presenters(id) on delete cascade,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  primary key (workshop_id, presenter_id)
);
create index if not exists idx_wpresenters_workshop on workshop_presenters(workshop_id);

-- ===========================================================================
-- 4. workshop_sessions: one dated occurrence of a workshop. Scaffold is single
--    scheduled_at today; we build sessions with a 1:1 default (backfilled below) so
--    nothing breaks and multi-session is available later.
-- ===========================================================================
create table if not exists workshop_sessions (
  id                   uuid primary key default gen_random_uuid(),
  workshop_id          uuid not null references workshops(workshop_id) on delete cascade,
  starts_at            timestamptz not null,        -- store UTC, render recipient-local
  ends_at              timestamptz,
  timezone             text not null default 'America/Chicago',
  delivery_mode        text not null default 'in_person'
                         check (delivery_mode in ('in_person','virtual','hybrid')),
  venue_name           text,
  venue_address        text,
  capacity_in_person   integer,
  capacity_virtual     integer,
  zoom_meeting_id      text,                        -- provisioning source (no securities data); P3
  ics_uid              text unique,                 -- stable calendar id for updates/cancels
  recording_url        text,                        -- replay (finite window); P3
  recording_expires_at timestamptz,
  status               text not null default 'scheduled'
                         check (status in ('scheduled','live','completed','cancelled')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_wsessions_workshop on workshop_sessions(workshop_id);
create index if not exists idx_wsessions_starts on workshop_sessions(starts_at);

-- Backfill a 1:1 session for every existing workshop that has none, mirroring its
-- scheduled_at + location. Idempotent (skips workshops that already have a session).
insert into workshop_sessions (workshop_id, starts_at, delivery_mode, venue_address)
select w.workshop_id,
       coalesce(w.scheduled_at, now()),
       coalesce(w.delivery_mode, 'in_person'),
       w.location
from workshops w
where not exists (select 1 from workshop_sessions s where s.workshop_id = w.workshop_id);

-- ===========================================================================
-- 5. workshop_registrations: session link, delivery choice, per-registrant join
--    token (Zoom correlation + QR check-in in P1/P3), immutable lead source.
-- ===========================================================================
alter table workshop_registrations add column if not exists session_id uuid references workshop_sessions(id) on delete set null;
alter table workshop_registrations add column if not exists chosen_delivery text;
alter table workshop_registrations add column if not exists join_token text;
alter table workshop_registrations add column if not exists join_url text;
alter table workshop_registrations add column if not exists lead_source text;
alter table workshop_registrations add column if not exists ghl_contact_id text;

create unique index if not exists idx_wreg_join_token on workshop_registrations(join_token) where join_token is not null;
create index if not exists idx_wreg_session on workshop_registrations(session_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wreg_chosen_delivery_chk') then
    alter table workshop_registrations add constraint wreg_chosen_delivery_chk
      check (chosen_delivery is null or chosen_delivery in ('in_person','virtual')) not valid;
  end if;
end $$;

-- Backfill each existing registration onto its workshop's (single) session.
update workshop_registrations r
set session_id = s.id
from workshop_sessions s
where r.session_id is null and s.workshop_id = r.workshop_id;

-- ===========================================================================
-- 6. workshop_attendance: SHELL ONLY. Full check-in UI + Zoom webhooks are P1/P3.
--    Created now so downstream FKs resolve.
-- ===========================================================================
create table if not exists workshop_attendance (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references workshop_registrations(reg_id) on delete cascade,
  session_id      uuid not null references workshop_sessions(id) on delete cascade,
  status          text not null default 'registered'
                    check (status in ('registered','attended','no_show','left_early')),
  capture_method  text check (capture_method in ('checkin','webhook','manual')),
  checked_in_at   timestamptz,
  join_time       timestamptz,
  leave_time      timestamptz,
  duration_min    integer,
  created_at      timestamptz not null default now(),
  unique (registration_id, session_id)
);

-- ===========================================================================
-- 7. workshop_consent_events: durable TCPA/A2P consent EVIDENCE that the staging
--    array (workshop_registrations.consent_channels) cannot hold. One row per
--    channel-consent action captured at registration.
-- ===========================================================================
create table if not exists workshop_consent_events (
  id                 uuid primary key default gen_random_uuid(),
  registration_id    uuid not null references workshop_registrations(reg_id) on delete cascade,
  channel            text not null check (channel in ('sms','email')),
  action             text not null default 'granted' check (action in ('granted','revoked')),
  disclosure_text    text not null,               -- exact copy shown to the registrant
  disclosure_version text not null,               -- version tag for retrieval / recordkeeping
  ip_address         text,
  user_agent         text,
  captured_at        timestamptz not null default now()
);
create index if not exists idx_wconsent_reg on workshop_consent_events(registration_id);

-- ===========================================================================
-- 8. workshop_materials: versioned collateral (invite / landing / slides / handout /
--    presenter bio / presenter headshot / hero image). 2210 classification + filing
--    decision are LEFT NULL for compliance to set (REQUIRES-APPROVAL; never populated
--    by the app).
-- ===========================================================================
create table if not exists workshop_materials (
  id               uuid primary key default gen_random_uuid(),
  workshop_id      uuid not null references workshops(workshop_id) on delete cascade,
  kind             text not null check (kind in
                     ('invitation','landing_page','slides','handout','recording','email','sms',
                      'presenter_bio','presenter_headshot','hero_image')),
  label            text,
  version          integer not null default 1,
  storage_ref      text,                           -- storage path (no securities data)
  content_snapshot text,                           -- text snapshot (e.g. bio) for the approval record
  finra_2210_class text,                           -- retail | institutional | correspondence (compliance sets)
  filing_decision  text,                           -- pre_use | within_10_days | exempt | n_a (compliance sets)
  filing_ref       text,
  created_at       timestamptz not null default now(),
  unique (workshop_id, kind, version)
);
create index if not exists idx_wmaterials_workshop on workshop_materials(workshop_id);

-- ===========================================================================
-- 9. workshop_approvals: the HARD-GATE record. A principal pre-approval snapshot of
--    the exact material versions + presenter bios/headshots + disclosure version.
-- ===========================================================================
create table if not exists workshop_approvals (
  id                uuid primary key default gen_random_uuid(),
  workshop_id       uuid not null references workshops(workshop_id) on delete cascade,
  approver_name     text not null,                 -- e.g. Ryan Anderson (FFS)
  approver_crd      text,                          -- registered principal CRD
  decision          text not null check (decision in ('approved','rejected')),
  notes             text,
  material_versions jsonb,                         -- snapshot: materials + presenters + disclosure version
  decided_at        timestamptz not null default now()
);
create index if not exists idx_wapprovals_workshop on workshop_approvals(workshop_id);

-- workshops.compliance_approval_ref -> workshop_approvals(id) where decision='approved'.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshops_approval_fk') then
    alter table workshops add constraint workshops_approval_fk
      foreign key (compliance_approval_ref) references workshop_approvals(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshops_disclosure_fk') then
    alter table workshops add constraint workshops_disclosure_fk
      foreign key (disclosure_config_id) references workshop_disclosure_configs(id) on delete set null not valid;
  end if;
end $$;

-- ===========================================================================
-- 10. PUBLISH HARD-GATE trigger (defense in depth with the route check). A workshop
--     cannot move to 'published' unless BOTH prerequisites hold:
--       (a) compliance_approval_ref points at an approved workshop_approvals row, AND
--       (b) disclosure_config_id points at an APPROVED (is_assumption=false) config.
--     A direct SQL UPDATE that tries to publish without these RAISES.
-- ===========================================================================
create or replace function enforce_workshop_publish_gate()
returns trigger language plpgsql as $$
declare
  approved_ok boolean;
  disclosure_ok boolean;
begin
  if new.status = 'published' and coalesce(old.status, '') <> 'published' then
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
  before update on workshops
  for each row execute function enforce_workshop_publish_gate();

-- ===========================================================================
-- 11. RLS — default-deny; staff/compliance read per role; writes via service role.
-- ===========================================================================
alter table workshop_disclosure_configs enable row level security;
alter table presenters                  enable row level security;
alter table workshop_presenters         enable row level security;
alter table workshop_sessions           enable row level security;
alter table workshop_attendance         enable row level security;
alter table workshop_consent_events     enable row level security;
alter table workshop_materials          enable row level security;
alter table workshop_approvals          enable row level security;

-- Staff-read (mirrors 018 workshops_staff_read): fsa/licensed_staff/admin/ops + super.
drop policy if exists disclosure_staff_read on workshop_disclosure_configs;
create policy disclosure_staff_read on workshop_disclosure_configs for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

drop policy if exists presenters_staff_read on presenters;
create policy presenters_staff_read on presenters for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops') or has_role('compliance')
);

drop policy if exists wpresenters_staff_read on workshop_presenters;
create policy wpresenters_staff_read on workshop_presenters for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops') or has_role('compliance')
);

drop policy if exists wsessions_staff_read on workshop_sessions;
create policy wsessions_staff_read on workshop_sessions for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops') or has_role('compliance')
);

drop policy if exists wattendance_staff_read on workshop_attendance;
create policy wattendance_staff_read on workshop_attendance for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops') or has_role('compliance')
);

drop policy if exists wmaterials_staff_read on workshop_materials;
create policy wmaterials_staff_read on workshop_materials for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops') or has_role('compliance')
);

-- Consent evidence + approvals: read restricted to compliance / fsa / super only.
drop policy if exists wconsent_read on workshop_consent_events;
create policy wconsent_read on workshop_consent_events for select using (
  is_super() or has_role('compliance') or has_role('supervisor') or has_role('fsa') or has_role('licensed_staff')
);

drop policy if exists wapprovals_read on workshop_approvals;
create policy wapprovals_read on workshop_approvals for select using (
  is_super() or has_role('compliance') or has_role('supervisor') or has_role('fsa') or has_role('licensed_staff')
);

-- No INSERT/UPDATE/DELETE policies and no anon grant: all writes go through the service
-- role in API routes after an rbac assertion (getDb bypasses RLS). Reads for the public
-- landing pages are performed by the service-role server components, scoped in the query
-- to status='published' only (never an anon RLS grant).
