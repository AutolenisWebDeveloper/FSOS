-- ═══════════════════════════════════════════════════════════════════
-- FSOS — P1 (professional launch) support
-- Migration: 012_p1_reviews_comms_commission
--
-- Adds what the P1 modules need on top of the aggregate-root spine (009),
-- RLS/guardrails (010), and P0 support (011):
--   • the computed views the specs reference (v_cross_sell_gaps, v_crosssell_targets,
--     v_conversions_due, v_pipeline_by_engagement, v_commission_by_agency) so every
--     cross-sell / conversion / pipeline / commission badge is DB-derived and cannot
--     drift from the UI;
--   • config-default tables (cross_sell_basket, review_types, appointment_types,
--     ops_config) — all assumption-flagged where Farmers-specific, editable, never invented;
--   • template approval + versioning columns (only approved templates are sendable);
--   • send-time gate telemetry on comm_messages (consent_at_send, blocked_step, block_reason)
--     so the comms timeline shows the gate result at send time;
--   • commission reconciliation surfaces (receipts, adjustments, chargebacks);
--   • case service requests + review follow-ups + document scan/retention columns.
-- Idempotent: safe to re-run. Nothing here drops or renames a legacy object.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Template approval + versioning (only approved templates are sendable)
-- ─────────────────────────────────────────────────────────
alter table comm_templates add column if not exists submitted_at  timestamptz;
alter table comm_templates add column if not exists approved_at   timestamptz;
alter table comm_templates add column if not exists approved_by   text;
alter table comm_templates add column if not exists updated_by    text;
alter table comm_templates add column if not exists archived_at   timestamptz;
-- A template is education/invitation only for these categories (green-zone).
alter table comm_templates add column if not exists requires_optout boolean not null default true;

-- ─────────────────────────────────────────────────────────
-- 2. Campaign builder + send-time gate telemetry
-- ─────────────────────────────────────────────────────────
alter table comm_campaigns add column if not exists channel      text;
alter table comm_campaigns add column if not exists category     text;
alter table comm_campaigns add column if not exists audience     jsonb not null default '{}';
alter table comm_campaigns add column if not exists schedule_at   timestamptz;
alter table comm_campaigns add column if not exists quiet_hours_ack boolean not null default false;
alter table comm_campaigns add column if not exists activated_at  timestamptz;
alter table comm_campaigns add column if not exists archived_at   timestamptz;

alter table comm_campaign_enrollments add column if not exists suppressed_reason text;
alter table comm_campaign_enrollments add column if not exists last_sent_at      timestamptz;

alter table comm_messages add column if not exists direction_ok    boolean;
alter table comm_messages add column if not exists consent_at_send boolean;
alter table comm_messages add column if not exists blocked_step    text;
alter table comm_messages add column if not exists block_reason    text;
alter table comm_messages add column if not exists actor           text;
alter table comm_messages add column if not exists provider_id     text;
alter table comm_messages add column if not exists household_id    uuid;
alter table comm_messages add column if not exists updated_at      timestamptz not null default now();

create index if not exists idx_comm_messages_entity on comm_messages(entity_type, entity_id);
create index if not exists idx_comm_messages_status on comm_messages(delivery_status, created_at desc);

-- ─────────────────────────────────────────────────────────
-- 3. Reviews — follow-ups, prep snapshot, replacement flag, assignment
-- ─────────────────────────────────────────────────────────
alter table reviews add column if not exists assigned_user     uuid;
alter table reviews add column if not exists prep_snapshot     jsonb;
alter table reviews add column if not exists replacement_flag  boolean not null default false;
alter table reviews add column if not exists securities_routed boolean not null default false;
alter table reviews add column if not exists archived_at       timestamptz;
alter table reviews add column if not exists deleted_at        timestamptz;

create index if not exists idx_reviews_household on reviews(household_id);
create index if not exists idx_reviews_stage on reviews(stage);
create index if not exists idx_reviews_scheduled on reviews(scheduled_at);

-- Review type config (agenda templates + default cadences; Farmers-specific → assumption).
create table if not exists review_types (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  label           text not null,
  agenda          jsonb not null default '[]',
  cadence_days    integer,
  is_assumption   boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 4. Cross-sell basket config (recommended coverage lines, editable)
-- ─────────────────────────────────────────────────────────
create table if not exists cross_sell_basket (
  id              uuid primary key default gen_random_uuid(),
  line            text not null unique,        -- auto | home | umbrella | life | annuity
  priority        integer not null,            -- lower = earlier in the basket
  is_assumption   boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 5. Case service requests + signature verification
-- ─────────────────────────────────────────────────────────
alter table cases add column if not exists signature_verified boolean not null default false;
alter table cases add column if not exists form_version       text;
alter table cases add column if not exists replacement_flag   boolean not null default false;
alter table cases add column if not exists issued_at          timestamptz;
alter table cases add column if not exists archived_at        timestamptz;
alter table cases add column if not exists assigned_user      uuid;

create table if not exists case_service_requests (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases(id) on delete cascade,
  kind          text not null,
  detail        text,
  status        text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table case_requirements add column if not exists source text;   -- checklist | carrier | manual

-- ─────────────────────────────────────────────────────────
-- 6. Commission reconciliation surfaces
-- ─────────────────────────────────────────────────────────
create table if not exists commission_receipts (
  id                uuid primary key default gen_random_uuid(),
  commission_id     uuid references commissions(id) on delete set null,
  amount            numeric(14,2) not null default 0,
  period            text,
  paid_on           date,
  is_trail          boolean not null default false,
  dedupe_key        text unique,               -- policy/period/amount dedupe (WF-7)
  source            text not null default 'manual' check (source in ('manual','import')),
  created_at        timestamptz not null default now()
);

create table if not exists commission_adjustments (
  id                uuid primary key default gen_random_uuid(),
  commission_id     uuid not null references commissions(id) on delete cascade,
  amount            numeric(14,2) not null,    -- negative = chargeback/clawback
  kind              text not null default 'adjustment' check (kind in ('adjustment','chargeback')),
  reason            text not null,
  actor             text,
  created_at        timestamptz not null default now()
);

alter table commissions add column if not exists received_amount numeric(14,2) not null default 0;
alter table commissions add column if not exists period          text;

-- ─────────────────────────────────────────────────────────
-- 7. Documents — virus scan + signed-url support + requests linkage
-- ─────────────────────────────────────────────────────────
alter table documents add column if not exists scan_status   text not null default 'pending'
  check (scan_status in ('pending','clean','infected','error'));
alter table documents add column if not exists file_name     text;
alter table documents add column if not exists mime_type     text;
alter table documents add column if not exists uploaded_by   text;
alter table document_requests add column if not exists document_id uuid references documents(id) on delete set null;

-- ─────────────────────────────────────────────────────────
-- 8. Operational config (tags, statuses, loss reasons, appointment types…)
-- ─────────────────────────────────────────────────────────
create table if not exists ops_config (
  id            uuid primary key default gen_random_uuid(),
  section       text not null,                 -- tags | statuses | loss_reasons | appointment_types | review_types
  key           text not null,
  label         text not null,
  is_assumption boolean not null default false,
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (section, key)
);

-- Support requests (public → admin triage) + data import jobs.
create table if not exists support_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text,
  subject       text,
  body          text,
  status        text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists import_jobs (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null,
  status        text not null default 'preview' check (status in ('preview','committed','rolledback','failed')),
  mapping       jsonb,
  summary       jsonb,
  rollback_token text,
  row_count     integer not null default 0,
  error_count   integer not null default 0,
  actor         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 9. Computed views (DB-derived so UI cannot drift from data)
-- ─────────────────────────────────────────────────────────

-- Pipeline by engagement model (executive + reports).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_pipeline_by_engagement
  with (security_invoker = on) as
select
  o.engagement,
  o.stage,
  count(*)                          as opp_count,
  coalesce(sum(o.premium), 0)       as total_premium,
  coalesce(sum(o.expected_commission), 0) as expected_commission
from opportunities o
where o.deleted_at is null
group by o.engagement, o.stage;

-- Commission attributed by agency (dashboard + partner production).
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_commission_by_agency
  with (security_invoker = on) as
select
  c.referring_agency_id,
  ap.agency_name,
  c.product_family,
  c.is_security,
  count(*)                       as record_count,
  coalesce(sum(c.total_commission), 0) as total_commission,
  coalesce(sum(c.fsa_amount), 0)       as fsa_amount,
  coalesce(sum(c.agency_amount), 0)    as agency_amount,
  coalesce(sum(c.received_amount), 0)  as received_amount
from commissions c
left join agency_partnerships ap on ap.id = c.referring_agency_id
group by c.referring_agency_id, ap.agency_name, c.product_family, c.is_security;

-- Agencies with a large P&C book and low life penetration (the FSA growth thesis).
-- next_best target ranking for cross-sell. Excludes deleted/terminated partnerships.
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_crosssell_targets
  with (security_invoker = on) as
select
  ap.id,
  ap.agency_name,
  ap.owner_name,
  ap.status,
  ap.pc_book_policies,
  ap.life_policies_in_force,
  case when ap.pc_book_policies > 0
       then round(100.0 * ap.life_policies_in_force / ap.pc_book_policies, 1)
       else 0 end                                        as life_penetration_pct,
  -- score: big book + low penetration ranks highest.
  (ap.pc_book_policies * greatest(0, 100 - case when ap.pc_book_policies > 0
       then round(100.0 * ap.life_policies_in_force / ap.pc_book_policies, 1) else 0 end))::numeric as target_score
from agency_partnerships ap
where ap.deleted_at is null
  and ap.status <> 'terminated';

-- Household coverage gaps vs the recommended basket (config-editable).
-- next_best_line is a coverage GAP (highest-priority missing line), NOT a product recommendation.
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_cross_sell_gaps
  with (security_invoker = on) as
with basket as (
  select line, priority from cross_sell_basket
),
held as (
  select
    hp.household_id,
    array_agg(distinct p.family) filter (where p.family is not null) as families,
    bool_or(hp.is_with_us and coalesce(p.family,'') = 'life') as has_life
  from household_policies hp
  left join products p on p.id = hp.product_id
  where hp.deleted_at is null and hp.status in ('active','bound','renewed')
  group by hp.household_id
),
gaps as (
  select
    h.id                             as household_id,
    h.primary_name,
    h.referring_agency_id,
    coalesce(held.families, '{}'::text[])    as families_held,
    coalesce(held.has_life, false)   as has_life,
    (
      select b.line from basket b
      where b.line not in (select unnest(coalesce(held.families, '{}'::text[])))
      order by b.priority
      limit 1
    )                                as next_best_line,
    (
      select count(*) from basket b
      where b.line not in (select unnest(coalesce(held.families, '{}'::text[])))
    )                                as gap_count
  from households h
  left join held on held.household_id = h.id
  where h.deleted_at is null and h.do_not_contact = false
)
select
  household_id,
  primary_name,
  referring_agency_id,
  families_held,
  has_life,
  next_best_line,
  gap_count,
  -- score: no-life households and larger gap counts rank highest.
  (case when has_life then 0 else 50 end) + (gap_count * 10) as score
from gaps
where gap_count > 0;

-- Term policies whose configured conversion window is approaching, tiered by urgency.
-- Window source is a config default (assumption-flagged) — surfaced in the UI badge.
-- security_invoker=on so the caller's RLS applies to view reads (see 015).
create or replace view v_conversions_due
  with (security_invoker = on) as
select
  hp.id                            as policy_id,
  hp.household_id,
  h.primary_name,
  hp.carrier_id,
  hp.product_id,
  hp.policy_number,
  hp.conversion_deadline,
  hp.is_security,
  (hp.conversion_deadline - current_date) as days_remaining,
  case
    when hp.conversion_deadline - current_date <= 30  then '30'
    when hp.conversion_deadline - current_date <= 90  then '90'
    when hp.conversion_deadline - current_date <= 180 then '180'
    when hp.conversion_deadline - current_date <= 365 then '365'
    else 'beyond'
  end                              as urgency_tier
from household_policies hp
join households h on h.id = hp.household_id
where hp.deleted_at is null
  and hp.is_with_us = true
  and hp.conversion_deadline is not null
  and hp.conversion_deadline >= current_date;

-- ─────────────────────────────────────────────────────────
-- 10. RLS on new tables (default-deny; FSA/staff/compliance/super read).
-- ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'review_types','cross_sell_basket','case_service_requests','commission_receipts',
    'commission_adjustments','ops_config','support_requests','import_jobs'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- Config tables: FSA/staff/compliance/super read; writes via service role after rbac.
drop policy if exists rt_read on review_types;
create policy rt_read on review_types for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
drop policy if exists csb_read on cross_sell_basket;
create policy csb_read on cross_sell_basket for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
drop policy if exists csr_read on case_service_requests;
create policy csr_read on case_service_requests for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('case_manager')
);
drop policy if exists crc_read on commission_receipts;
create policy crc_read on commission_receipts for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);
drop policy if exists cadj_read on commission_adjustments;
create policy cadj_read on commission_adjustments for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);
drop policy if exists opc_read on ops_config;
create policy opc_read on ops_config for select using (
  is_super() or has_role('admin') or has_role('ops')
  or has_role('fsa') or has_role('licensed_staff') or has_role('compliance')
);
drop policy if exists sup_read on support_requests;
create policy sup_read on support_requests for select using (
  is_super() or has_role('admin') or has_role('ops')
);
drop policy if exists imp_read on import_jobs;
create policy imp_read on import_jobs for select using (
  is_super() or has_role('admin') or has_role('ops')
);

-- ─────────────────────────────────────────────────────────
-- 11. Seeds — assumption-flagged config defaults (never Farmers-published figures)
-- ─────────────────────────────────────────────────────────
insert into cross_sell_basket (line, priority, is_assumption, note) values
  ('auto',     1, true,  'config default basket order — verify against book strategy'),
  ('home',     2, true,  'config default basket order — verify against book strategy'),
  ('umbrella', 3, true,  'config default basket order — verify against book strategy'),
  ('life',     4, true,  'config default basket order — verify against book strategy')
  on conflict (line) do nothing;

insert into review_types (key, label, cadence_days, is_assumption, agenda) values
  ('annual',          'Annual Review',          365, false, '["Coverage summary","Life events","Goals check-in","Next steps"]'),
  ('policy',          'Policy Review',           0,  false, '["Policy status","Beneficiaries","Coverage adequacy"]'),
  ('coverage',        'Coverage Review',         0,  false, '["Lines held","Gaps observed","Umbrella/life discussion"]'),
  ('term_conversion', 'Term Conversion Review',  0,  true,  '["Term window (config — verify)","Permanent life education (neutral)","Options overview","Next steps"]'),
  ('retirement',      'Retirement Review',       0,  false, '["Goals","Income needs (educational)","Escalate securities to FFS"]')
  on conflict (key) do nothing;

insert into ops_config (section, key, label, is_assumption, sort) values
  ('appointment_types','review','Financial Review', false, 1),
  ('appointment_types','intro','Introduction', false, 2),
  ('appointment_types','followup','Follow-Up', false, 3),
  ('loss_reasons','no_contact','No contact', false, 1),
  ('loss_reasons','not_interested','Not interested', false, 2),
  ('loss_reasons','already_covered','Already covered', false, 3),
  ('loss_reasons','not_a_fit','Not a fit', false, 4),
  ('loss_reasons','other','Other', false, 9)
  on conflict (section, key) do nothing;
