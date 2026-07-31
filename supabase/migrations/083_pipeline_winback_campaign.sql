-- ─────────────────────────────────────────────────────────
-- Migration: 083_pipeline_winback_campaign
--
-- The Pipeline Win-Back Campaign (spec §4/§5/§5a/§7/§10; ADR-031). A first-class,
-- single-per-OPPORTUNITY, MULTI-CHANNEL timeline layered on the native comms engine — it does
-- NOT replace comm_campaigns/comm_campaign_enrollments (ADR-013), and it is DISTINCT from the
-- existing imported-list win_back opportunity flow (src/lib/opportunities/winback.ts). This
-- module targets STALLED INTERNAL pipeline opportunities (staleness on opportunities.stage),
-- surfaced by the new v_pipeline_winback_due eligibility view.
--
-- Every client-facing send still routes through sendThroughGate() (consent/quiet-hours/DNC/
-- approved-template/recommendation/securities). This schema stores the campaign definition, the
-- 24-touch template, per-opportunity enrollments + cursor, per-touch executions, and the
-- advisor-outreach task state (§9a) the generic work_tasks table does not carry.
--
-- Reuse-first (CLAUDE.md §6): the campaign/enrollment state machine, advisor-touch policy, and
-- conversation timeout/owner logic are reused verbatim from the life-campaign module (ADR-031 §3);
-- audit = append-only audit_log via writeAudit(). No FK crosses into the NIGO island.
--
-- Config defaults (stale_min_days, cooldown, advisor windows, timeout) are is_assumption values
-- (§4.3) — the UI renders the gold "config default — verify" badge from that flag.
--
-- Access model matches migration 081: all app reads/writes go through getDb() (service role,
-- bypasses RLS). RLS is deny-by-default with read policies for internal roles only; anon/
-- authenticated writes are revoked; grant select to authenticated so a stray JWT read denies BY
-- ROW (empty) rather than erroring, keeping the RLS firewall proof meaningful.
--
-- Idempotent; transaction-safe (runs inside the runner's per-file txn — no explicit BEGIN).
-- ─────────────────────────────────────────────────────────

-- ── 1. Campaign definition + operational state (§5a) ────────────────────────
create table if not exists pipeline_winback_campaigns (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null,
  status                          text not null default 'draft'
                                    check (status in ('draft','approval_pending','active','paused','disabled','emergency_stopped','archived')),
  -- Gate config (Slice 7 parity): message purpose + optional delegated-sender (both-or-neither).
  -- Win-back re-engagement is promotional → MARKETING purpose (requires MARKETING consent +
  -- unsubscribe + marketing quiet-hour/frequency treatment at the gate; src/lib/comms/purpose.ts).
  purpose                         text default 'MARKETING',
  represented_agency_owner_id     uuid,
  delegation_id                   uuid,
  -- Operational config defaults — editable, is_assumption (§4.3).
  daily_enrollment_limit          integer not null default 50,
  -- Minimum days of staleness (since the opportunity's last touch) before re-engagement. The
  -- v_pipeline_winback_due floor is 30; raising this above 30 only TIGHTENS enrollment (the
  -- pure eligibility gate enforces it), so the dashboard "eligible" count may be a superset.
  stale_min_days                  integer not null default 30,
  reenroll_cooldown_days          integer not null default 60,
  resume_cooling_off_days         integer not null default 5,
  advisor_due_hours               integer not null default 48,
  advisor_overdue_escalate_hours  integer not null default 72,
  advisor_reassign_after_hours    integer not null default 120,
  conversation_timeout_hours      integer not null default 48,
  advisor_hold_behavior           text not null default 'proceed' check (advisor_hold_behavior in ('proceed','hold')),
  is_assumption                   boolean not null default true,
  -- Activation gate parity (ADR-021): a recent read-only simulation is required to activate.
  simulated_at                    timestamptz,
  last_simulation                 jsonb,
  created_by                      text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ── 2. The 24-touch template (§7) — one row per touch, per campaign ─────────
create table if not exists pipeline_winback_touches (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references pipeline_winback_campaigns(id) on delete cascade,
  touch_no      integer not null,
  day_offset    integer not null,
  kind          text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  -- Sendable touches (email/sms/ai_conversation) reference an APPROVED comm_template at send
  -- time; advisor_outreach has no template (it produces a work_task instead).
  template_id   uuid references comm_templates(id) on delete set null,
  asset_label   text,
  created_at    timestamptz not null default now(),
  unique (campaign_id, touch_no)
);

-- ── 3. Per-opportunity enrollment + timeline cursor (§10) ───────────────────
create table if not exists pipeline_winback_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references pipeline_winback_campaigns(id) on delete cascade,
  -- The stalled opportunity being re-engaged (the natural key + dedup guard).
  opportunity_id     uuid references opportunities(id) on delete cascade,
  household_id       uuid references households(id) on delete cascade,
  member_id          uuid references household_members(id) on delete set null,
  contact_id         uuid references contacts(id) on delete set null,
  agency_id          uuid,
  owner_scope        uuid,
  status             text not null default 'active'
                       check (status in ('active','paused_for_conversation','paused_by_admin','completed','exited','suppressed')),
  baseline_date      date not null,
  current_touch_no   integer not null default 0,
  next_touch_at      timestamptz,
  timezone           text not null default 'America/Chicago',
  stale_days_at_enroll integer,
  winback_category   text,
  pause_reason       text,
  exit_reason        text,
  enrolled_by        text,
  paused_at          timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Idempotent enrollment: one live row per (campaign, opportunity) (§4a duplicate guard).
  unique (campaign_id, opportunity_id)
);

-- ── 4. Per-touch execution record (idempotent — never resend a completed touch) ──
create table if not exists pipeline_winback_executions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references pipeline_winback_enrollments(id) on delete cascade,
  touch_no       integer not null,
  kind           text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  status         text not null check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed')),
  -- For advisor touches: the work_tasks row that fulfils this touch (§5a).
  fulfilling_task_id uuid,
  detail         jsonb,
  executed_at    timestamptz not null default now(),
  unique (enrollment_id, touch_no)
);

-- ── 5. Advisor-outreach task state (§9a) — the escalation/attempt tracking the ──
--    generic work_tasks table does not carry. Companion to a work_tasks row.
create table if not exists pipeline_winback_advisor_touches (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references pipeline_winback_enrollments(id) on delete cascade,
  touch_no       integer not null,
  task_id        uuid,               -- work_tasks.id
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

-- ── Indexes: the tick selects active enrollments with a due touch; controls/dashboard filter
--    by campaign+status; advisor sweep filters by status. ──────────────────────
create index if not exists idx_pwe_due on pipeline_winback_enrollments (next_touch_at) where status = 'active';
create index if not exists idx_pwe_campaign_status on pipeline_winback_enrollments (campaign_id, status);
create index if not exists idx_pwe_opportunity on pipeline_winback_enrollments (opportunity_id);
create index if not exists idx_pwt_campaign on pipeline_winback_touches (campaign_id);
create index if not exists idx_pwx_enrollment on pipeline_winback_executions (enrollment_id);
create index if not exists idx_pwat_status on pipeline_winback_advisor_touches (status);
create index if not exists idx_pwat_enrollment on pipeline_winback_advisor_touches (enrollment_id);

-- ── 6. Eligibility view (spec §0.9 single source of truth) ───────────────────
-- Stalled/lost INTERNAL pipeline opportunities eligible for win-back re-engagement. Follows the
-- v_conversions_due / v_cross_sell_gaps pattern (mig 012). security_invoker=on so the caller's
-- RLS applies to view reads (see mig 015).
--
-- Population separation (ADR-031): excludes source in ('win_back','term_conversion') — those are
-- owned by the Imported Win-Back and Life Conversion modules respectively. Firewall: is_security
-- opportunities are never surfaced. Staleness = current_date − max(opportunity.updated_at, last
-- activity), floored at 30 days. The three soft-suppression signals (do_not_contact,
-- has_active_advisor_opportunity [precedence #1], has_upcoming_appointment) are EXPOSED as
-- columns, not filtered — the pure evaluateWinbackEligibility() applies them, so a signal that
-- appears AFTER enrollment produces an accurate exit reason at the per-touch recheck.
create or replace view v_pipeline_winback_due
  with (security_invoker = on) as
with last_act as (
  select entity_id as opportunity_id, max(created_at) as last_activity_at
  from activities
  where entity_type = 'opportunity'
  group by entity_id
),
opp_touch as (
  select
    o.id,
    o.household_id,
    o.contact_id,
    o.referring_agency_id,
    o.stage,
    o.is_security,
    o.source,
    greatest(o.updated_at, coalesce(la.last_activity_at, o.updated_at)) as last_touch_at
  from opportunities o
  left join last_act la on la.opportunity_id = o.id
  where o.deleted_at is null
),
active_adv as (
  -- Households with a FRESH/active advisor-owned opportunity (precedence #1): any non-terminal
  -- opportunity in late-stage underwriting, or touched within the 30-day staleness floor.
  select distinct household_id
  from opp_touch
  where household_id is not null
    and stage not in ('lost','placed_issued')
    and (stage = 'underwriting_suitability' or (current_date - last_touch_at::date) < 30)
),
appt as (
  select distinct household_id
  from appointments
  where household_id is not null and status = 'scheduled' and scheduled_at >= now()
)
select
  ot.id                                          as opportunity_id,
  ot.household_id,
  ot.contact_id,
  ot.referring_agency_id,
  ot.stage,
  ot.is_security,
  ot.last_touch_at,
  (current_date - ot.last_touch_at::date)        as stale_days,
  case
    when ot.stage = 'lost' then 'lost'
    when ot.stage = 'quoted_proposed' then 'stalled_quote'
    when ot.stage = 'application' then 'abandoned_application'
    when ot.stage in ('prospect','fact_find') then 'inactive'
    else null
  end                                            as winback_category,
  h.primary_name,
  coalesce(h.do_not_contact, false)              as do_not_contact,
  (aa.household_id is not null)                  as has_active_advisor_opportunity,
  (ap.household_id is not null)                  as has_upcoming_appointment
from opp_touch ot
join households h on h.id = ot.household_id and h.deleted_at is null
left join active_adv aa on aa.household_id = ot.household_id
left join appt ap on ap.household_id = ot.household_id
where ot.is_security = false
  and coalesce(ot.source, '') not in ('win_back','term_conversion')
  and ot.stage in ('prospect','fact_find','quoted_proposed','application','lost')
  and (current_date - ot.last_touch_at::date) >= 30;

-- ── RLS: deny-by-default; internal-role reads only; revoke anon/authenticated writes ──
do $$
declare t text;
begin
  foreach t in array array[
    'pipeline_winback_campaigns','pipeline_winback_touches','pipeline_winback_enrollments',
    'pipeline_winback_executions','pipeline_winback_advisor_touches'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);  -- deny BY ROW, not error
  end loop;
end $$;

-- Read policies: FSA/licensed staff + ops/admin/super run the campaign; compliance/supervisor
-- get visibility. Never client/agency_owner (internal ops data).
drop policy if exists pwc_read on pipeline_winback_campaigns;
create policy pwc_read on pipeline_winback_campaigns for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists pwt_read on pipeline_winback_touches;
create policy pwt_read on pipeline_winback_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists pwe_read on pipeline_winback_enrollments;
create policy pwe_read on pipeline_winback_enrollments for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists pwx_read on pipeline_winback_executions;
create policy pwx_read on pipeline_winback_executions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists pwat_read on pipeline_winback_advisor_touches;
create policy pwat_read on pipeline_winback_advisor_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop view if exists v_pipeline_winback_due;
--   drop table if exists pipeline_winback_advisor_touches, pipeline_winback_executions,
--     pipeline_winback_enrollments, pipeline_winback_touches, pipeline_winback_campaigns cascade;
