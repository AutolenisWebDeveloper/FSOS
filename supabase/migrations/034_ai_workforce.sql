-- FSOS — AI Workforce Orchestrator
-- Migration: 034_ai_workforce
--
-- Turns the (already-defined) green-zone agent roster into an operating workforce:
-- each morning the orchestrator builds a PRIORITIZED OUTREACH QUEUE from the existing
-- detection signals (cross-sell gaps, term-conversion windows, untouched referrals,
-- win-back households), gives each outreach agent a DAILY CONTACT QUOTA, and — via
-- the durable agent-runner — drafts a green-zone message and sends it ONLY through
-- the 7-step compliance gate (sendThroughGate). Nothing here bypasses consent,
-- quiet-hours, DNC, the recommendation red-line, or the securities firewall.
--
-- GUARDRAILS honored by this schema:
--   • §2.1 Securities firewall — securities-flagged work is never queued (the
--     builder excludes is_security rows; a CHECK keeps the channel non-securities).
--   • §2.3 No invented Farmers data — daily targets ship as CONFIG DEFAULTS with
--     is_assumption = true so the UI renders the "config default — verify" badge and
--     the FSA can edit them.
--   • Append-only audit — writes route through the app's writeAudit(); this file
--     adds no destructive grants to audit_log.

-- ─────────────────────────────────────────────────────────
-- 1. Daily contact quotas (per agent). CONFIG DEFAULT — editable, assumption-flagged.
-- ─────────────────────────────────────────────────────────
create table if not exists agent_daily_targets (
  agent_key       text primary key,
  daily_target    integer not null default 0 check (daily_target >= 0 and daily_target <= 1000),
  channel         text not null default 'sms' check (channel in ('sms','email')),
  enabled         boolean not null default true,
  is_assumption   boolean not null default true,   -- renders "config default — verify"
  note            text,
  updated_at      timestamptz not null default now()
);

comment on table agent_daily_targets is
  'Per-agent daily outreach quota. daily_target/channel are CONFIG DEFAULTS (is_assumption=true) — the FSA verifies/edits them; the orchestrator never exceeds daily_target contacts/agent/day.';

-- Seed the outreach agents with conservative defaults (assumption-flagged). Only
-- these four agents proactively contact clients; every other agent is detection/
-- internal-only and is intentionally absent here.
insert into agent_daily_targets (agent_key, daily_target, channel, enabled, note) values
  ('cross_sell',         10, 'sms',  true,  'Coverage-gap review invitations (green-zone). Config default — verify cadence with compliance.'),
  ('term_conversion',     8, 'sms',  true,  'Educational term-conversion cadence. Config default — verify window + volume.'),
  ('referral_followup',  15, 'sms',  true,  'First-touch on untouched referrals within SLA. Config default — verify.'),
  -- Paused by default: the win-back → member/consent mapping is a pending config
  -- (§2.3), so this agent has no candidate source yet. Enable once mapped + verified.
  ('marketing_automation',12,'email', false, 'Win-back / lead-nurture for former life households. Pending win-back mapping. Config default — verify.')
on conflict (agent_key) do nothing;

-- ─────────────────────────────────────────────────────────
-- 2. Outreach queue — the prioritized daily work list each agent draws from.
-- ─────────────────────────────────────────────────────────
create table if not exists outreach_queue (
  id            uuid primary key default gen_random_uuid(),
  queue_date    date not null default current_date,
  agent_key     text not null,
  source        text not null,                     -- cross_sell | term_conversion | referral_followup | win_back
  -- What the outreach is about (household/policy/referral/contact).
  entity_type   text not null,
  entity_id     uuid not null,
  household_id  uuid references households(id) on delete cascade,
  member_id     uuid references household_members(id) on delete set null,
  channel       text not null default 'sms' check (channel in ('sms','email')),
  priority      integer not null default 0,        -- higher = contact sooner (pure scorer)
  reason        text,                              -- human-readable "why this, why now"
  is_security   boolean not null default false,    -- firewall: MUST be false to dispatch
  status        text not null default 'queued'
                  check (status in ('queued','drafted','sent','blocked','escalated','skipped','held')),
  run_id        uuid references agent_runs(id) on delete set null,
  message_id    uuid,                              -- comm_messages.id once dispatched
  block_reason  text,                              -- gate step that blocked (if blocked)
  outcome       text,                              -- responded | booked | converted | none (closed-loop)
  drafted_at    timestamptz,
  dispatched_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One queue item per (agent, target, day): idempotent re-runs, no double-contact.
  unique (queue_date, agent_key, entity_type, entity_id)
);

-- Never let a securities-flagged item sit in a dispatchable state (defense in depth
-- alongside the builder-level exclusion and the send-time firewall).
alter table outreach_queue drop constraint if exists outreach_queue_firewall;
alter table outreach_queue add constraint outreach_queue_firewall
  check (not (is_security = true and status in ('drafted','sent')));

comment on table outreach_queue is
  'Prioritized daily outreach work list. The orchestrator drafts + sends each item ONLY through sendThroughGate (consent/quiet-hours/DNC/recommendation/securities all enforced at send time). Securities-flagged targets are excluded upstream and cannot reach drafted/sent.';

create index if not exists idx_outreach_queue_day_agent on outreach_queue(queue_date, agent_key, status);
create index if not exists idx_outreach_queue_status on outreach_queue(status) where status in ('queued','escalated','blocked');
create index if not exists idx_outreach_queue_household on outreach_queue(household_id);
create index if not exists idx_outreach_queue_member on outreach_queue(member_id);

-- ─────────────────────────────────────────────────────────
-- 3. Dashboard rollup — "the workforce today": per-agent quota vs. work done.
--    security_invoker=on so the caller's RLS applies (consistent with 015).
-- ─────────────────────────────────────────────────────────
create or replace view v_workforce_today
  with (security_invoker = on) as
with today as (
  select agent_key,
         count(*)                                             as queued_total,
         count(*) filter (where status = 'sent')              as sent,
         count(*) filter (where status = 'blocked')           as blocked,
         count(*) filter (where status = 'escalated')         as escalated,
         count(*) filter (where status = 'skipped')           as skipped,
         count(*) filter (where status = 'queued')            as pending,
         count(*) filter (where status = 'drafted')           as drafted,
         count(*) filter (where outcome in ('responded','booked','converted')) as engaged
  from outreach_queue
  where queue_date = current_date
  group by agent_key
)
select
  coalesce(dt.agent_key, td.agent_key) as agent_key,
  coalesce(a.enabled, false)      as agent_enabled,
  coalesce(dt.daily_target, 0)    as daily_target,
  coalesce(dt.channel, 'sms')     as channel,
  coalesce(dt.enabled, false)     as target_enabled,
  coalesce(dt.is_assumption, true) as is_assumption,
  coalesce(td.queued_total, 0)    as queued_total,
  coalesce(td.sent, 0)            as sent,
  coalesce(td.blocked, 0)         as blocked,
  coalesce(td.escalated, 0)       as escalated,
  coalesce(td.skipped, 0)         as skipped,
  coalesce(td.pending, 0)         as pending,
  coalesce(td.drafted, 0)         as drafted,
  coalesce(td.engaged, 0)         as engaged,
  greatest(coalesce(dt.daily_target, 0) - coalesce(td.sent, 0), 0) as remaining
from agent_daily_targets dt
full outer join today td on td.agent_key = dt.agent_key
left join ai_agents a on a.key = coalesce(dt.agent_key, td.agent_key);

-- ─────────────────────────────────────────────────────────
-- 4. RLS — default-deny; FSA/staff/compliance/supervisor/super read. Writes are
--    service-role (the orchestrator runs server-side after rbac), mirroring the
--    established pattern in 010/012.
-- ─────────────────────────────────────────────────────────
alter table agent_daily_targets enable row level security;
alter table outreach_queue enable row level security;

drop policy if exists adt_read on agent_daily_targets;
create policy adt_read on agent_daily_targets for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists oq_read on outreach_queue;
create policy oq_read on outreach_queue for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
