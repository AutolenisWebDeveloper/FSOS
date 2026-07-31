-- ─────────────────────────────────────────────────────────
-- Migration: 085_cross_sell_life_campaign
--
-- The Cross-Sell Life Campaign — a 180-day, 35-touch MULTI-CHANNEL timeline for EXISTING agency
-- clients who hold >=1 non-life product / agency relationship but have NO active life policy,
-- application, or opportunity with us. A first-class module layered on the native comms engine —
-- it does NOT replace comm_campaigns/comm_campaign_enrollments (single-channel, ADR-013). Direct
-- parallel of 081_life_conversion_campaign (ADR-029) and 083_pipeline_winback_campaign (ADR-031);
-- documented in ADR-032.
--
-- Reuse-first (CLAUDE.md §6): eligibility base = v_cross_sell_gaps (has_life=false, gap_count>0)
-- with the Life-Conversion / Win-Back population separation and Active-Opportunity Ownership rule;
-- every client-facing send routes through sendThroughGate() (consent/quiet-hours 9a-8p local/DNC/
-- approved-template/recommendation/securities/data-confidence); pause/resume reuses
-- comm_conversation_mode; audit = append-only audit_log via writeAudit(); booking reuses lib/booking
-- + lib/zoom. NO FK crosses into the NIGO island.
--
-- Distinct namespace (xsell_life_*) from the existing Cross-Sell AGENT (cross-sell-scan job,
-- /api/cross-sell/[id], v_cross_sell_gaps, crosssell_* activities) — the agent identifies/invites a
-- household; THIS is the durable 180-day campaign. They coexist; nothing here duplicates the agent.
--
-- Config defaults (cooldown 365d, daily limit 75, advisor windows, timeouts, weekend/holiday, resume
-- behavior, replay policy) are is_assumption values (§4.3) — the UI renders the gold "config default
-- — verify" badge. Every default is an editable column so admins change behavior without a migration.
--
-- Versioning (§16, owner-approved): a campaign row IS a version. Versions of the same campaign share
-- family_key; enrollments are pinned to the specific version row (campaign_id) + denormalized
-- campaign_version and NEVER migrate. Editing an Active version = insert a NEW version row (Draft);
-- historical executions/touches are immutable.
--
-- Access model matches migration 081/083: all app reads/writes go through getDb() (service role,
-- bypasses RLS). RLS deny-by-default; internal-role reads only (never client/agency_owner);
-- anon/authenticated writes revoked; grant select to authenticated so a stray JWT read denies BY ROW
-- (empty) rather than erroring, keeping the RLS firewall proof meaningful.
--
-- Idempotent; transaction-safe (runs inside the runner's per-file txn — no explicit BEGIN).
-- ─────────────────────────────────────────────────────────

-- ── 1. Campaign definition + operational state + config (immutable-after-activation version) ──
create table if not exists xsell_life_campaigns (
  id                              uuid primary key default gen_random_uuid(),
  -- Version identity (§16). family_key groups all versions of "Cross-Sell Life"; version is 1-based.
  family_key                      uuid not null default gen_random_uuid(),
  version                         integer not null default 1,
  name                            text not null default 'Cross-Sell Life',
  description                     text,
  objective                       text,
  -- Full operational lifecycle (§ Campaign Operational Controls / §15). Only 'active' dispatches.
  status                          text not null default 'draft'
                                    check (status in ('draft','approval_pending','active','paused','disabled','emergency_stopped','archived')),
  -- Gate config (Slice 7 parity): message purpose + optional delegated-sender (both-or-neither).
  purpose                         text default 'CLIENT_CARE_CROSS_SELL',
  represented_agency_owner_id     uuid,
  delegation_id                   uuid,
  -- Enrollment + cadence config defaults — editable, is_assumption (§4.3, §5).
  daily_enrollment_limit          integer not null default 75,      -- §5 default 75 / business day
  reenroll_cooldown_days          integer not null default 365,     -- §3 default 12 months (configurable)
  resume_cooling_off_days         integer not null default 5,
  advisor_due_hours               integer not null default 48,
  advisor_overdue_escalate_hours  integer not null default 72,
  advisor_reassign_after_hours    integer not null default 120,
  conversation_timeout_hours      integer not null default 48,
  advisor_hold_behavior           text not null default 'proceed' check (advisor_hold_behavior in ('proceed','hold')),
  intent_confidence_threshold     numeric(3,2) not null default 0.60, -- below → route to advisor review (§13)
  -- Business-day / weekend / holiday scheduling. Quiet hours (9a-8p local) stay gate-enforced;
  -- these govern which calendar days the tick is allowed to place a proactive touch on.
  send_on_weekends                boolean not null default false,
  send_on_holidays                boolean not null default false,
  holiday_calendar                jsonb not null default '[]',      -- array of ISO dates (config default)
  -- Resume + replay behavior (§ Resume Behavior). Configurable; no auto catch-up by default.
  resume_behavior                 text not null default 'only_admin_paused'
                                    check (resume_behavior in ('all_active','only_admin_paused','restart_day_1','only_new')),
  replay_policy                   text not null default 'skip'
                                    check (replay_policy in ('skip','replay')),  -- missed touches → Skipped unless replay
  is_assumption                   boolean not null default true,
  -- Activation gate parity (ADR-021): a recent read-only simulation is required to activate.
  simulated_at                    timestamptz,
  last_simulation                 jsonb,
  -- Kill switch / emergency-stop bookkeeping (§18).
  emergency_stopped_at            timestamptz,
  emergency_stopped_by            text,
  activated_at                    timestamptz,
  archived_at                     timestamptz,
  created_by                      text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (family_key, version)
);

-- ── 2. The 35-touch template (§6) — one row per touch, per campaign VERSION (immutable) ──
create table if not exists xsell_life_campaign_touches (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references xsell_life_campaigns(id) on delete cascade,
  touch_no      integer not null,                                    -- 1..35
  day_offset    integer not null,                                    -- 1..180 (exact §6 taper, NOT normalized)
  kind          text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  -- Sendable touches reference an APPROVED comm_template at send time; advisor_outreach has none
  -- (it produces a work_task + xsell_life_advisor_touches row instead).
  template_id   uuid references comm_templates(id) on delete set null,
  playbook_key  text,                                                -- ai_conversation → playbooks.ts key
  asset_label   text,
  created_at    timestamptz not null default now(),
  unique (campaign_id, touch_no)
);

-- ── 3. Per-contact enrollment + timeline cursor (full §15 state machine) ──
create table if not exists xsell_life_campaign_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references xsell_life_campaigns(id) on delete cascade,
  campaign_version   integer not null,                               -- pinned version (§16) — never migrates
  household_id       uuid references households(id) on delete cascade,
  member_id          uuid references household_members(id) on delete set null,
  contact_id         uuid,                                           -- reuse contacts spine
  agency_id          uuid,                                           -- represented agency (referring_agency_id)
  owner_scope        uuid,
  assigned_advisor   uuid,
  jurisdiction       text,                                           -- licensed-jurisdiction gate (state)
  qualifying_product text,                                           -- the non-life family/relationship that qualified
  -- Full §15 enrollment lifecycle. 'running' is the live, touch-receiving state; the queue states
  -- (eligible/queued/scheduled/enrolled) precede activation; the rest are pause/handoff/terminal.
  status             text not null default 'queued'
                       check (status in (
                         'eligible','queued','scheduled','enrolled','running',
                         'paused_for_conversation','paused_by_admin','conversation_active',
                         'waiting_for_advisor','advisor_owned','appointment_scheduled',
                         'quote_requested','application_started','policy_issued','purchased_elsewhere',
                         'future_follow_up','completed','suppressed','compliance_hold','cancelled','failed')),
  previous_status    text,                                           -- prior state preserved on transition (§15)
  baseline_date      date not null,
  current_touch_no   integer not null default 0,
  next_touch_at      timestamptz,
  timezone           text not null default 'America/Chicago',
  queue_position     integer,                                        -- daily-limit ordering (§5)
  lead_score         integer,
  pause_reason       text,
  exit_reason        text,                                           -- §15 standardized exit vocabulary
  future_follow_up_at date,                                          -- §9/§13 future follow-up date
  enrolled_by        text,
  enrolled_at        timestamptz,
  paused_at          timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,
  cooldown_until     date,                                           -- §3 re-enroll cooldown (terminal, no-convert)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Idempotent enrollment: one live row per (campaign version, member) (§3 duplicate guard).
  unique (campaign_id, member_id)
);

-- ── 4. Per-touch execution record (idempotent — never resend a completed touch, §6/§16) ──
create table if not exists xsell_life_campaign_executions (
  id                 uuid primary key default gen_random_uuid(),
  enrollment_id      uuid not null references xsell_life_campaign_enrollments(id) on delete cascade,
  touch_no           integer not null,
  kind               text not null check (kind in ('email','sms','ai_conversation','advisor_outreach')),
  status             text not null check (status in ('scheduled','sent','suppressed','skipped','fulfilled','missed','dead_letter')),
  -- Immutable execution record (§16): the exact template + versions used, never overwritten later.
  template_id        uuid,
  template_version   integer,
  campaign_version   integer,
  -- Idempotency (§6): campaignVersion:enrollment:touch:channel — a retried job never double-sends.
  idempotency_key    text,
  fulfilling_task_id uuid,
  attempts           integer not null default 0,                    -- retry accounting (§20)
  next_retry_at      timestamptz,
  detail             jsonb,
  executed_at        timestamptz not null default now(),
  unique (enrollment_id, touch_no)
);

-- ── 5. Advisor-outreach task state (§10) — due/reminder/escalation the generic work_tasks lacks ──
create table if not exists xsell_life_advisor_touches (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references xsell_life_campaign_enrollments(id) on delete cascade,
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

-- ── Indexes: the tick selects live enrollments with a due touch; controls/dashboard filter by
--    campaign+status; advisor sweep filters by status; idempotency lookups by key. ──
create index if not exists idx_xlc_due on xsell_life_campaign_enrollments (next_touch_at) where status = 'running';
create index if not exists idx_xlc_campaign_status on xsell_life_campaign_enrollments (campaign_id, status);
create index if not exists idx_xlc_member on xsell_life_campaign_enrollments (member_id);
create index if not exists idx_xlc_household on xsell_life_campaign_enrollments (household_id);
create index if not exists idx_xlc_cooldown on xsell_life_campaign_enrollments (member_id, cooldown_until);
create index if not exists idx_xlct_campaign on xsell_life_campaign_touches (campaign_id);
create index if not exists idx_xlcx_enrollment on xsell_life_campaign_executions (enrollment_id);
create unique index if not exists idx_xlcx_idem on xsell_life_campaign_executions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_xlcx_deadletter on xsell_life_campaign_executions (status) where status = 'dead_letter';
create index if not exists idx_xlat_status on xsell_life_advisor_touches (status);
create index if not exists idx_xlat_enrollment on xsell_life_advisor_touches (enrollment_id);
create index if not exists idx_xlc_family_version on xsell_life_campaigns (family_key, version);

-- ── RLS: deny-by-default; internal-role reads only; revoke anon/authenticated writes ──
do $$
declare t text;
begin
  foreach t in array array[
    'xsell_life_campaigns','xsell_life_campaign_touches','xsell_life_campaign_enrollments',
    'xsell_life_campaign_executions','xsell_life_advisor_touches'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);  -- deny BY ROW, not error
  end loop;
end $$;

-- Read policies: FSA/licensed staff + ops/admin/super run the campaign; compliance/supervisor get
-- visibility. Never client/agency_owner (internal ops data). Mirrors migration 081/083.
drop policy if exists xlc_read on xsell_life_campaigns;
create policy xlc_read on xsell_life_campaigns for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists xlct_read on xsell_life_campaign_touches;
create policy xlct_read on xsell_life_campaign_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists xlce_read on xsell_life_campaign_enrollments;
create policy xlce_read on xsell_life_campaign_enrollments for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists xlcx_read on xsell_life_campaign_executions;
create policy xlcx_read on xsell_life_campaign_executions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
drop policy if exists xlat_read on xsell_life_advisor_touches;
create policy xlat_read on xsell_life_advisor_touches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop table if exists xsell_life_advisor_touches, xsell_life_campaign_executions,
--     xsell_life_campaign_enrollments, xsell_life_campaign_touches, xsell_life_campaigns cascade;
