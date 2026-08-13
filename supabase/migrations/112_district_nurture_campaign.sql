-- ─────────────────────────────────────────────────────────
-- Migration 112 — District Agent FS Nurture Campaign ("The Second Conversation")
--
-- Schema for the FIRST agent-facing multi-channel campaign (ADR-038). Mirrors the
-- Life Conversion / Pipeline Win-Back shape (081 / 083) but keys enrollment to the
-- AGENCY OWNER (Farmers district agent) instead of a household member — the one
-- structural departure that justifies a new schema. Every enforcement layer (gate,
-- dispatcher, consent, state machine, audit) is reused, not cloned.
--
-- No FK crosses into the securities/NIGO island. RLS is deny-by-default: internal
-- roles read only; writes are service-role only. The population view is
-- security_invoker so a stray client JWT sees nothing.
--
-- Idempotent (create if not exists / or replace). Transaction-safe; no BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Campaign (7-state lifecycle + config defaults) ──────────────────────────
create table if not exists district_nurture_campaigns (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null,
  status                          text not null default 'draft'
                                    check (status in ('draft','approval_pending','active','paused','disabled','emergency_stopped','archived')),
  purpose                         text default 'MARKETING',
  -- Configurable campaign start date (task brief). Enrollment baseline = greatest(start_date, today).
  start_date                      date,
  daily_enrollment_limit          integer not null default 25,
  reenroll_cooldown_days          integer not null default 90,
  resume_cooling_off_days         integer not null default 5,
  -- Live-touchpoint (advisor_outreach) SLA — reuses the shared advisor-touch policy.
  advisor_due_hours               integer not null default 72,
  advisor_overdue_escalate_hours  integer not null default 120,
  advisor_reassign_after_hours    integer not null default 240,
  conversation_timeout_hours      integer not null default 72,
  advisor_hold_behavior           text not null default 'proceed' check (advisor_hold_behavior in ('proceed','hold')),
  is_assumption                   boolean not null default true,
  simulated_at                    timestamptz,
  last_simulation                 jsonb,
  created_by                      text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ── Touch blueprint (40 touches: 24 email + 12 sms + 4 advisor_outreach) ─────
create table if not exists district_nurture_touches (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references district_nurture_campaigns(id) on delete cascade,
  touch_no      integer not null,
  module_no     integer,                        -- curriculum module (1-12); null for cross-module live touches
  day_offset    integer not null,
  kind          text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  template_id   uuid references comm_templates(id) on delete set null,
  asset_label   text,
  created_at    timestamptz not null default now(),
  unique (campaign_id, touch_no)
);

-- ── Enrollment (per agency-owner cursor; reply-pause distinct from admin-pause) ─
create table if not exists district_nurture_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references district_nurture_campaigns(id) on delete cascade,
  agency_id          uuid references agency_partnerships(id) on delete cascade,
  agency_owner_id    uuid references agency_owners(id) on delete cascade,
  contact_id         uuid references contacts(id) on delete set null,
  owner_scope        uuid,
  -- Channel targets snapshotted at enrollment for stable dispatch; refreshable by re-enroll.
  email              text,
  phone              text,
  status             text not null default 'active'
                       check (status in ('active','paused_for_conversation','paused_by_admin','completed','exited','suppressed')),
  baseline_date      date not null,
  current_touch_no   integer not null default 0,
  next_touch_at      timestamptz,
  timezone           text not null default 'America/Chicago',
  pause_reason       text,
  exit_reason        text,
  enrolled_by        text,
  paused_at          timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (campaign_id, agency_owner_id)
);

-- ── Per-touch idempotent execution record ────────────────────────────────────
create table if not exists district_nurture_executions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references district_nurture_enrollments(id) on delete cascade,
  touch_no       integer not null,
  kind           text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  status         text not null check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed')),
  fulfilling_task_id uuid,
  detail         jsonb,
  executed_at    timestamptz not null default now(),
  unique (enrollment_id, touch_no)
);

-- ── Live-touchpoint (advisor_outreach) state — reuses the shared advisor policy ─
create table if not exists district_nurture_advisor_touches (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references district_nurture_enrollments(id) on delete cascade,
  touch_no       integer not null,
  task_id        uuid,
  assignee       uuid,
  due_at         timestamptz not null,
  reminders_sent timestamptz[] not null default '{}',
  escalated_at   timestamptz,
  reassigned_to  uuid,
  attempt_logged boolean not null default false,
  outcome        text,
  status         text not null default 'due'
                   check (status in ('due','overdue','escalate','reassign','fulfilled','missed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (enrollment_id, touch_no)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_dne_due on district_nurture_enrollments (next_touch_at) where status = 'active';
create index if not exists idx_dne_campaign_status on district_nurture_enrollments (campaign_id, status);
create index if not exists idx_dne_agency_owner on district_nurture_enrollments (agency_owner_id);
create index if not exists idx_dne_agency on district_nurture_enrollments (agency_id);
create index if not exists idx_dnt_campaign on district_nurture_touches (campaign_id);
create index if not exists idx_dnx_enrollment on district_nurture_executions (enrollment_id);
create index if not exists idx_dnat_status on district_nurture_advisor_touches (status);
create index if not exists idx_dnat_enrollment on district_nurture_advisor_touches (enrollment_id);

-- ── Eligibility population view (agency owners) ───────────────────────────────
-- One definition read by the scheduler, dashboard, analytics, and manual-enroll API.
-- security_invoker = on → the caller's RLS applies (back-office only; a client sees nothing).
create or replace view v_district_nurture_candidates
  with (security_invoker = on) as
select
  ao.id                                                as agency_owner_id,
  ao.agency_id,
  ao.contact_id,
  ap.agency_name,
  ap.owner_name,
  ap.status                                            as agency_status,
  ap.owner_scope,
  coalesce(c.full_name, ao.full_name)                  as owner_full_name,
  coalesce(c.email, ao.email)                          as email,
  coalesce(c.phone, ao.mobile_phone, ao.phone)         as phone,
  coalesce(ap.interested, false)                       as interested,
  coalesce(ap.existing_leads_user, false)              as existing_leads_user,
  -- Agency directory carries no securities data (mig 051); kept for firewall symmetry.
  false                                                as is_security,
  (
    coalesce(c.email, ao.email) is not null
    or coalesce(c.phone, ao.mobile_phone, ao.phone) is not null
  )                                                    as reachable
from agency_owners ao
join agency_partnerships ap on ap.id = ao.agency_id
left join contacts c on c.id = ao.contact_id and c.deleted_at is null
where ap.status <> 'terminated'
  and (
    coalesce(c.email, ao.email) is not null
    or coalesce(c.phone, ao.mobile_phone, ao.phone) is not null
  );

-- ── RLS: deny-by-default, internal roles read-only, service-role writes ───────
do $$
declare t text;
begin
  foreach t in array array[
    'district_nurture_campaigns','district_nurture_touches','district_nurture_enrollments',
    'district_nurture_executions','district_nurture_advisor_touches'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);  -- deny BY ROW, not error
  end loop;
end $$;

drop policy if exists dnc_read on district_nurture_campaigns;
create policy dnc_read on district_nurture_campaigns for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists dnt_read on district_nurture_touches;
create policy dnt_read on district_nurture_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists dne_read on district_nurture_enrollments;
create policy dne_read on district_nurture_enrollments for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists dnx_read on district_nurture_executions;
create policy dnx_read on district_nurture_executions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists dnat_read on district_nurture_advisor_touches;
create policy dnat_read on district_nurture_advisor_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- ── comm_campaigns registry mirror (migration 109 pattern) ────────────────────
-- comm_messages.campaign_id FKs comm_campaigns; engine sends pass campaignId=null and
-- attribute via source_campaign_key. Mirror the engine campaign as an inert (archived,
-- paused, category 'engine_registry') registry row so any future FK linkage holds.
drop trigger if exists trg_district_nurture_campaigns_registry on public.district_nurture_campaigns;
create trigger trg_district_nurture_campaigns_registry
  after insert or update of name on public.district_nurture_campaigns
  for each row execute function public.sync_engine_campaign_registry();
