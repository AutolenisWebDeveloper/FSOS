-- ─────────────────────────────────────────────────────────
-- Migration: 081_life_conversion_campaign
--
-- The Life Conversion Campaign (spec §4/§4b/§5/§13). A first-class, single-per-contact,
-- MULTI-CHANNEL timeline layered on the native comms engine — it does NOT replace
-- comm_campaigns/comm_campaign_enrollments (those stay single-channel per ADR-013). Every
-- client-facing send still routes through sendThroughGate() (consent/quiet-hours/DNC/
-- approved-template/recommendation/securities); this schema stores the campaign definition,
-- the 20-touch template, per-contact enrollments + cursor, per-touch executions, and the
-- advisor-outreach task state (§9a) that the generic work_tasks table does not carry.
--
-- Reuse-first (CLAUDE.md §6): eligibility = v_conversions_due + termconversion planner +
-- the Active Opportunity Ownership rule (ADR-029); pause/resume = comm_conversation_mode;
-- audit = append-only audit_log via writeAudit(). No FK crosses into the NIGO island.
--
-- Config defaults (cooldown, timeouts, advisor windows, quiet period) are is_assumption
-- values (§4.3) — the UI renders the gold "config default — verify" badge from that flag.
--
-- Access model matches the repo convention (migration 080): all app reads/writes go through
-- getDb() (service role, bypasses RLS). RLS is enabled deny-by-default with read policies
-- for internal roles only (never client/agency_owner — these are internal ops tables), and
-- anon/authenticated writes are revoked. grant select to authenticated so a stray JWT read
-- denies BY ROW (empty) rather than erroring, keeping the RLS firewall proof meaningful.
--
-- Idempotent; transaction-safe (runs inside the runner's per-file txn — no explicit BEGIN).
-- ─────────────────────────────────────────────────────────

-- ── 1. Campaign definition + operational state (§4b) ────────────────────────
create table if not exists life_campaigns (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null,
  status                          text not null default 'draft'
                                    check (status in ('draft','approval_pending','active','paused','disabled','emergency_stopped','archived')),
  -- Gate config (Slice 7 parity): message purpose + optional delegated-sender (both-or-neither).
  purpose                         text default 'POLICY_DEADLINE',
  represented_agency_owner_id     uuid,
  delegation_id                   uuid,
  -- Operational config defaults — editable, is_assumption (§4.3).
  daily_enrollment_limit          integer not null default 50,
  reenroll_cooldown_days          integer not null default 30,
  resume_cooling_off_days         integer not null default 5,
  advisor_due_hours               integer not null default 48,
  advisor_overdue_escalate_hours  integer not null default 72,
  advisor_reassign_after_hours    integer not null default 120,
  conversation_timeout_hours      integer not null default 48,
  early_enrollment_buffer_days    integer not null default 30,
  advisor_hold_behavior           text not null default 'proceed' check (advisor_hold_behavior in ('proceed','hold')),
  is_assumption                   boolean not null default true,
  -- Activation gate parity (ADR-021): a recent read-only simulation is required to activate.
  simulated_at                    timestamptz,
  last_simulation                 jsonb,
  created_by                      text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ── 2. The 20-touch template (§5) — one row per touch, per campaign ─────────
create table if not exists life_campaign_touches (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references life_campaigns(id) on delete cascade,
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

-- ── 3. Per-contact enrollment + timeline cursor (§13) ───────────────────────
create table if not exists life_campaign_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references life_campaigns(id) on delete cascade,
  household_id       uuid references households(id) on delete cascade,
  member_id          uuid references household_members(id) on delete set null,
  policy_id          uuid references household_policies(id) on delete set null,
  -- Delegation/ownership context supplied to the gate (represented agency).
  agency_id          uuid,
  owner_scope        uuid,
  status             text not null default 'active'
                       check (status in ('active','paused_for_conversation','paused_by_admin','completed','exited','suppressed')),
  baseline_date      date not null,
  current_touch_no   integer not null default 0,
  next_touch_at      timestamptz,
  timezone           text not null default 'America/Chicago',
  -- Verified deadline snapshot (from v_conversions_due) driving §5 deadline language + exposure.
  conversion_deadline date,
  pause_reason       text,
  exit_reason        text,
  enrolled_by        text,
  paused_at          timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Idempotent enrollment: one live row per (campaign, member) (§4a duplicate guard).
  unique (campaign_id, member_id)
);

-- ── 4. Per-touch execution record (idempotent — never resend a completed touch) ──
create table if not exists life_campaign_executions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references life_campaign_enrollments(id) on delete cascade,
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
create table if not exists life_advisor_touches (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references life_campaign_enrollments(id) on delete cascade,
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

-- ── Indexes: the tick selects active enrollments with a due touch; controls/dashboard
--    filter by campaign+status; advisor sweep filters by status. ──────────────
create index if not exists idx_lce_due on life_campaign_enrollments (next_touch_at) where status = 'active';
create index if not exists idx_lce_campaign_status on life_campaign_enrollments (campaign_id, status);
create index if not exists idx_lce_policy on life_campaign_enrollments (policy_id);
create index if not exists idx_lct_campaign on life_campaign_touches (campaign_id);
create index if not exists idx_lcx_enrollment on life_campaign_executions (enrollment_id);
create index if not exists idx_lat_status on life_advisor_touches (status);
create index if not exists idx_lat_enrollment on life_advisor_touches (enrollment_id);

-- ── RLS: deny-by-default; internal-role reads only; revoke anon/authenticated writes ──
do $$
declare t text;
begin
  foreach t in array array[
    'life_campaigns','life_campaign_touches','life_campaign_enrollments',
    'life_campaign_executions','life_advisor_touches'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);  -- deny BY ROW, not error
  end loop;
end $$;

-- Read policies: FSA/licensed staff + ops/admin/super run the campaign; compliance/supervisor
-- get visibility (deadline-sensitive outreach). Never client/agency_owner (internal ops data).
drop policy if exists lc_read on life_campaigns;
create policy lc_read on life_campaigns for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists lct_read on life_campaign_touches;
create policy lct_read on life_campaign_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists lce_read on life_campaign_enrollments;
create policy lce_read on life_campaign_enrollments for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists lcx_read on life_campaign_executions;
create policy lcx_read on life_campaign_executions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists lat_read on life_advisor_touches;
create policy lat_read on life_advisor_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop table if exists life_advisor_touches, life_campaign_executions,
--     life_campaign_enrollments, life_campaign_touches, life_campaigns cascade;
