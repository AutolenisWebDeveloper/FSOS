-- FSOS — Hours of operation for automated outreach
-- Migration: 035_comm_hours
--
-- The operator's control over WHEN the AI may contact people ("don't text people all
-- day and all night"). A singleton policy read at send time by the compliance gate
-- (step 2b, business_hours) and as a pre-check by the workforce orchestrator.
--
-- GUARDRAIL: this can only ever make sending MORE restrictive. The gate ALWAYS also
-- applies the legal quiet-hours floor (recipient-local 9:00–20:00, TCPA) BEFORE this
-- window, so widening the business window can never push a send past the legal floor.
-- Being outside these hours is a soft DEFERRAL (held for the next in-hours cycle),
-- not a compliance escalation.
--
-- §2.3: the defaults are CONFIG DEFAULTS (is_assumption=true → "config default —
-- verify" badge); the FSA edits them to their real hours.

create table if not exists comm_hours_policy (
  id                     text primary key default 'global',
  enabled                boolean  not null default true,
  -- Business-local window. end_hour is EXCLUSIVE. Kept inside the legal floor by the
  -- gate regardless of what is stored here (belt: CHECK bounds; suspenders: the gate).
  start_hour             smallint not null default 9  check (start_hour between 0 and 23),
  end_hour               smallint not null default 20 check (end_hour   between 1 and 24),
  -- Allowed days of week: 0=Sun … 6=Sat.
  days                   smallint[] not null default '{1,2,3,4,5,6}',
  -- Business timezone offset from UTC in hours (Central floor -6; CDT -5).
  timezone_offset_hours  numeric(4,1) not null default -6,
  is_assumption          boolean  not null default true,
  note                   text,
  updated_at             timestamptz not null default now(),
  check (end_hour > start_hour)
);

comment on table comm_hours_policy is
  'Operator hours of operation for automated outreach (business-local). Enforced at the send gate (step business_hours) as a soft deferral and pre-checked by the workforce orchestrator. Can only tighten the legal recipient-local 9-20 TCPA floor, never widen it.';

-- Seed the singleton: weekdays + Saturday, 9:00–19:00 business-local. CONFIG DEFAULT.
insert into comm_hours_policy (id, start_hour, end_hour, days, note)
values ('global', 9, 19, '{1,2,3,4,5,6}', 'Config default — verify your real hours of operation. Legal quiet-hours floor (recipient-local 9am–8pm) always applies on top of this.')
on conflict (id) do nothing;

-- RLS — FSA/staff/compliance/supervisor/super read; writes are service-role after rbac.
alter table comm_hours_policy enable row level security;
drop policy if exists chp_read on comm_hours_policy;
create policy chp_read on comm_hours_policy for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
