-- ═══════════════════════════════════════════════════════════════════
-- FSOS — P2 (operational enhancement) support
-- Migration: 013_p2_operational_enhancement
--
-- Adds the tables + DB-derived views the P2 modules need on top of the
-- aggregate-root spine (009), RLS/guardrails (010), P0 support (011), and
-- P1 support (012). Nothing here weakens a P0/P1 guardrail:
--   • automation workflows still dispatch client comms ONLY through the
--     dispatcher gate (§7) — a workflow step never bypasses consent/quiet-hours;
--   • comm sequences carry requires_optout and are green-zone education/invite
--     only — the send path is still the gate;
--   • the AI sandbox persists the guardrail verdict for every trial run so a
--     blocked recommendation is visible (never sent);
--   • legal_holds SUSPEND retention/deletion (they never enable it);
--   • is_security is carried on every derived view so securities rows stay
--     excluded from automated surfaces.
-- Idempotent: safe to re-run. Nothing here drops or renames a legacy object.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Automation workflows (OS-14 workflow builder) + runs
--    A workflow is a trigger + conditions + ordered steps (action|delay|branch).
--    Any step that sends client comms routes through lib/comms/dispatcher — the
--    7-step gate is NOT re-implemented here and is never bypassed.
-- ─────────────────────────────────────────────────────────
create table if not exists automation_workflows (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  trigger_type   text not null default 'manual'
                   check (trigger_type in ('manual','referral_received','review_completed',
                                           'opportunity_stage','policy_x_date','case_status',
                                           'schedule','conversion_window')),
  trigger_config jsonb not null default '{}',
  conditions     jsonb not null default '[]',      -- [{field, op, value}]
  steps          jsonb not null default '[]',      -- [{type:'action'|'delay'|'branch', config}]
  failure_policy jsonb not null default '{"max_retries":3,"backoff":"exponential"}',
  enabled        boolean not null default false,   -- inactive until explicitly turned on
  created_by     text,
  updated_by     text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists automation_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references automation_workflows(id) on delete cascade,
  status        text not null default 'queued'
                  check (status in ('queued','running','waiting','succeeded','failed','cancelled')),
  current_step  integer not null default 0,
  attempts      integer not null default 0,
  context       jsonb not null default '{}',
  last_error    text,
  idempotency_key text unique,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_automation_runs_wf on automation_runs(workflow_id, created_at desc);

-- ─────────────────────────────────────────────────────────
-- 2. Comms — sequences + audience builder (OS-13, P2)
--    Sequences are green-zone education/invitation drips. requires_optout is
--    true by default; every enrolled send still passes the dispatcher gate.
-- ─────────────────────────────────────────────────────────
create table if not exists comm_sequences (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  channel        text not null default 'email' check (channel in ('email','sms')),
  category       text,
  steps          jsonb not null default '[]',    -- [{delay_days, template_id, subject}]
  status         text not null default 'draft' check (status in ('draft','active','archived')),
  requires_optout boolean not null default true,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists comm_audiences (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  definition     jsonb not null default '{}',    -- filter criteria (household/agency/policy)
  estimated_size integer not null default 0,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 3. Reports — saved definitions + scheduled delivery (OS-16, P2)
-- ─────────────────────────────────────────────────────────
create table if not exists report_definitions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  source_key   text not null,                    -- which DB-derived dataset
  columns      jsonb not null default '[]',
  filters      jsonb not null default '{}',
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists scheduled_reports (
  id           uuid primary key default gen_random_uuid(),
  report_key   text not null,
  name         text not null,
  cadence      text not null default 'weekly' check (cadence in ('daily','weekly','monthly')),
  format       text not null default 'csv' check (format in ('csv','pdf')),
  recipients   jsonb not null default '[]',
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 4. Compliance — legal holds, attestations, policies (P-3, P2)
--    A legal hold SUSPENDS retention/deletion for its scope. It never grants
--    access and never enables a delete.
-- ─────────────────────────────────────────────────────────
create table if not exists legal_holds (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  matter_ref   text,
  reason       text not null,
  scope        jsonb not null default '{}',      -- {entity_type, entity_ids|household_ids}
  status       text not null default 'active' check (status in ('active','released')),
  placed_by    text,
  placed_at    timestamptz not null default now(),
  released_by  text,
  released_at  timestamptz
);

create table if not exists attestations (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text not null,
  period         text,
  required_roles jsonb not null default '[]',
  due_at         timestamptz,
  status         text not null default 'open' check (status in ('draft','open','closed')),
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists attestation_responses (
  id             uuid primary key default gen_random_uuid(),
  attestation_id uuid not null references attestations(id) on delete cascade,
  user_id        text not null,
  acknowledged_at timestamptz not null default now(),
  response       text,
  unique (attestation_id, user_id)
);

create table if not exists compliance_policies (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text,
  body         text not null default '',
  version      integer not null default 1,
  status       text not null default 'draft' check (status in ('draft','published','retired')),
  effective_at timestamptz,
  published_by text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 5. Admin — data exports (portability, P2). Duplicate detection is a
--    read-only view (below); no table needed.
-- ─────────────────────────────────────────────────────────
create table if not exists data_exports (
  id           uuid primary key default gen_random_uuid(),
  dataset      text not null,
  format       text not null default 'csv' check (format in ('csv','json')),
  status       text not null default 'requested'
                 check (status in ('requested','processing','ready','failed','expired')),
  row_count    integer,
  file_ref     text,
  notes        text,
  requested_by text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at   timestamptz
);

-- ─────────────────────────────────────────────────────────
-- 6. Partner — training library + completions (P-4, P2)
-- ─────────────────────────────────────────────────────────
create table if not exists partner_training (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  category     text,
  url          text,
  duration_min integer,
  required     boolean not null default false,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists partner_training_completions (
  id           uuid primary key default gen_random_uuid(),
  training_id  uuid not null references partner_training(id) on delete cascade,
  agency_id    uuid references agency_partnerships(id) on delete set null,
  user_id      text not null,
  completed_at timestamptz not null default now(),
  unique (training_id, user_id)
);

-- ─────────────────────────────────────────────────────────
-- 7. Super — AI sandbox runs + webhooks (P2)
--    Sandbox runs persist the guardrail verdict; a blocked recommendation is
--    recorded and never dispatched (§2.2).
-- ─────────────────────────────────────────────────────────
create table if not exists ai_sandbox_runs (
  id             uuid primary key default gen_random_uuid(),
  agent_key      text,
  prompt         text not null,
  input          jsonb not null default '{}',
  output         text,
  model          text,
  tokens         integer,
  guardrail_pass boolean,
  guardrail_reason text,
  blocked        boolean not null default false,
  created_by     text,
  created_at     timestamptz not null default now()
);

create table if not exists webhooks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  target_url   text not null,
  events       jsonb not null default '[]',
  secret       text,
  enabled      boolean not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  webhook_id   uuid not null references webhooks(id) on delete cascade,
  event        text not null,
  payload      jsonb not null default '{}',
  status       text not null default 'pending' check (status in ('pending','success','failed')),
  status_code  integer,
  attempts     integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_wh on webhook_deliveries(webhook_id, created_at desc);

-- ─────────────────────────────────────────────────────────
-- 8. DB-derived views (no drift between UI and data)
-- ─────────────────────────────────────────────────────────

-- Agency leaderboard — ranked production. Used by /app/agencies/leaderboard (A11).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_agency_leaderboard
  with (security_invoker = on) as
select
  ap.id,
  ap.agency_name,
  ap.owner_name,
  ap.status,
  ap.ytd_placed_premium,
  ap.ytd_referrals,
  ap.pc_book_policies,
  ap.life_policies_in_force,
  case when ap.pc_book_policies > 0
       then round(100.0 * ap.life_policies_in_force / ap.pc_book_policies, 1)
       else 0 end                                          as life_penetration_pct,
  rank() over (order by ap.ytd_placed_premium desc)        as premium_rank,
  rank() over (order by ap.ytd_referrals desc)             as referral_rank
from agency_partnerships ap
where ap.deleted_at is null;

-- Agency health — a composite health signal from contact recency + penetration.
-- All thresholds here are operational heuristics (not Farmers-published figures).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_agency_health
  with (security_invoker = on) as
select
  ap.id,
  ap.agency_name,
  ap.owner_name,
  ap.status,
  ap.last_contact_at,
  ap.checkin_interval_days,
  (current_date - coalesce(ap.last_contact_at::date, ap.created_at::date)) as days_since_contact,
  case when ap.pc_book_policies > 0
       then round(100.0 * ap.life_policies_in_force / ap.pc_book_policies, 1)
       else 0 end                                          as life_penetration_pct,
  greatest(0, least(100,
    100
    - (case when (current_date - coalesce(ap.last_contact_at::date, ap.created_at::date))
                 > coalesce(ap.checkin_interval_days, 30)
            then 30 else 0 end)
    - (case when ap.status = 'dormant' then 25 else 0 end)
    - (case when ap.status = 'terminated' then 60 else 0 end)
    - (case when ap.ytd_referrals = 0 then 15 else 0 end)
  ))                                                        as health_score
from agency_partnerships ap
where ap.deleted_at is null;

-- Policy lapse-risk — in-force policies whose renewal is near or that are already
-- flagged lapsed/non-renewed. is_security carried so securities rows stay visible
-- to humans but excluded from any automated outreach. Used by /app/policies/lapse-risk.
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_policy_lapse_risk
  with (security_invoker = on) as
select
  hp.id                              as policy_id,
  hp.household_id,
  h.primary_name,
  hp.carrier_id,
  hp.product_id,
  hp.policy_number,
  hp.status,
  hp.premium,
  hp.renewal_date,
  hp.is_security,
  (hp.renewal_date - current_date)   as days_to_renewal,
  case
    when hp.status = 'lapsed'                                             then 'lapsed'
    when hp.status = 'non_renewed'                                       then 'non_renewed'
    when hp.renewal_date is not null and hp.renewal_date - current_date <= 15 then 'critical'
    when hp.renewal_date is not null and hp.renewal_date - current_date <= 45 then 'high'
    when hp.renewal_date is not null and hp.renewal_date - current_date <= 90 then 'watch'
    else 'ok'
  end                                                                     as risk_band
from household_policies hp
join households h on h.id = hp.household_id
where hp.deleted_at is null
  and hp.is_with_us = true
  and hp.status in ('active','bound','renewed','lapsed','non_renewed');

-- Missing documents — outstanding case requirements + document requests with no
-- linked document. Used by /app/documents/missing (A2).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_missing_documents
  with (security_invoker = on) as
select
  'case_requirement'                 as source,
  cr.id                              as source_id,
  cr.case_id                         as case_id,
  c.household_id                     as household_id,
  cr.requirement                     as requirement,
  cr.status                          as status,
  cr.created_at                      as created_at
from case_requirements cr
join cases c on c.id = cr.case_id
where cr.status = 'outstanding' and cr.document_id is null
union all
select
  'document_request'                 as source,
  dr.id                              as source_id,
  dr.case_id                         as case_id,
  dr.household_id                    as household_id,
  dr.requirement                     as requirement,
  dr.status                          as status,
  dr.created_at                      as created_at
from document_requests dr
where dr.status = 'requested';

-- Referral analytics — funnel counts by engagement + status. Used by
-- /app/referrals/analytics (A11).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_referral_analytics
  with (security_invoker = on) as
select
  r.engagement,
  r.status,
  count(*)                                                  as referral_count,
  count(*) filter (where r.status = 'converted')            as converted_count
from referrals r
where r.deleted_at is null
group by r.engagement, r.status;

-- Duplicate detection — households sharing a normalized name/phone. Read-only,
-- feeds /admin/data/duplicates (A2).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_duplicate_households
  with (security_invoker = on) as
select
  lower(trim(h.primary_name))        as match_key,
  count(*)                           as dup_count,
  array_agg(h.id)                    as household_ids
from households h
where h.deleted_at is null and coalesce(trim(h.primary_name),'') <> ''
group by lower(trim(h.primary_name))
having count(*) > 1;

-- ─────────────────────────────────────────────────────────
-- 9. RLS — default-deny, then role-scoped policies (backstop to route RBAC).
--    Reads/writes still run under the service role AFTER lib/auth/api gating;
--    these policies keep direct anon/authenticated access closed.
-- ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'automation_workflows','automation_runs','comm_sequences','comm_audiences',
    'report_definitions','scheduled_reports','legal_holds','attestations',
    'attestation_responses','compliance_policies','data_exports',
    'partner_training','partner_training_completions','ai_sandbox_runs',
    'webhooks','webhook_deliveries'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- FSA/ops operational tables — internal staff read/write.
do $$
declare t text;
begin
  foreach t in array array[
    'automation_workflows','automation_runs','comm_sequences','comm_audiences',
    'report_definitions','scheduled_reports','data_exports'
  ]
  loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format($p$create policy %I_rw on %I for all using (
      is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
    ) with check (
      is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
    );$p$, t, t);
  end loop;
end $$;

-- Compliance tables — compliance/supervisor + super manage; attestation
-- responders can read their own.
do $$
declare t text;
begin
  foreach t in array array['legal_holds','attestations','compliance_policies']
  loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format($p$create policy %I_rw on %I for all using (
      is_super() or has_role('compliance') or has_role('supervisor')
    ) with check (
      is_super() or has_role('compliance') or has_role('supervisor')
    );$p$, t, t);
    -- published compliance policies + open attestations are readable by all staff.
    execute format('drop policy if exists %I_read_all on %I;', t, t);
  end loop;
end $$;

drop policy if exists compliance_policies_read_all on compliance_policies;
create policy compliance_policies_read_all on compliance_policies for select using (
  status = 'published' or is_super() or has_role('compliance') or has_role('supervisor')
);

drop policy if exists attestations_read_all on attestations;
create policy attestations_read_all on attestations for select using (
  status <> 'draft' or is_super() or has_role('compliance') or has_role('supervisor')
);

drop policy if exists attn_resp_self on attestation_responses;
create policy attn_resp_self on attestation_responses for all using (
  is_super() or has_role('compliance') or has_role('supervisor') or user_id = auth.uid()::text
) with check (
  is_super() or has_role('compliance') or has_role('supervisor') or user_id = auth.uid()::text
);

-- Partner training — published rows readable by agency owners; staff manage.
drop policy if exists pt_read on partner_training;
create policy pt_read on partner_training for select using (
  published = true or is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
drop policy if exists pt_write on partner_training;
create policy pt_write on partner_training for all using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
) with check (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists ptc_rw on partner_training_completions;
create policy ptc_rw on partner_training_completions for all using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
  or (has_role('agency_owner') and agency_id in (select current_user_agencies()))
) with check (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
  or (has_role('agency_owner') and agency_id in (select current_user_agencies()))
);

-- Super-only tables — sandbox + webhooks.
do $$
declare t text;
begin
  foreach t in array array['ai_sandbox_runs','webhooks','webhook_deliveries']
  loop
    execute format('drop policy if exists %I_super on %I;', t, t);
    execute format($p$create policy %I_super on %I for all using (is_super())
      with check (is_super());$p$, t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────
-- 10. Seeds — assumption-flagged partner training defaults (editable, never invented).
-- ─────────────────────────────────────────────────────────
insert into partner_training (title, description, category, duration_min, required, published)
select * from (values
  ('How the FSA partnership works', 'Overview of the warm-handoff, co-sell, and direct engagement models.', 'onboarding', 15, true, true),
  ('Submitting a quality referral', 'What information helps a referral convert, and consent basics.', 'referrals', 10, true, true),
  ('Life insurance conversation starters', 'Green-zone talking points for introducing a life review.', 'sales', 12, false, true)
) as v(title, description, category, duration_min, required, published)
where not exists (select 1 from partner_training);
